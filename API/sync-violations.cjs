#!/usr/bin/env node
/**
 * Standalone FR24 sync + TMNP violation detection.
 * Designed to run headless on a VPS via cron — no HTTP server required.
 *
 * For each registration in helicopters.json, fetches recent flights from
 * FR24, downloads their tracks, checks for TMNP violations, and writes
 * results to the local cache (same format as API/server.cjs).
 *
 * Usage:
 *   node API/sync-violations.cjs                     # sync all helicopters
 *   node API/sync-violations.cjs ZS-HBO ZT-REG       # sync specific registrations
 *
 * Requires:
 *   API/credentials.json          – FR24_API_KEY
 *   backend/scripts/helicopters.json – list of registrations to track
 *   static-site/tmnp.kml         – TMNP boundary polygons
 *
 * Writes to:
 *   API/cache/fr24-violations/    API/cache/fr24-flight-meta/
 *   API/cache/fr24-track-meta/    API/cache/fr24-tracks/
 *   API/cache/fr24-sync-state/
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = __dirname;
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const HELICOPTERS_PATH = path.join(ROOT, '..', 'backend', 'scripts', 'helicopters.json');
const TMNP_KML_PATH = path.join(ROOT, '..', 'static-site', 'tmnp.kml');

const CACHE_DIR = path.join(ROOT, 'cache');
const FR24_TRACKS_DIR = path.join(CACHE_DIR, 'fr24-tracks');
const FR24_TRACK_META_DIR = path.join(CACHE_DIR, 'fr24-track-meta');
const FR24_FLIGHT_META_DIR = path.join(CACHE_DIR, 'fr24-flight-meta');
const FR24_VIOLATIONS_DIR = path.join(CACHE_DIR, 'fr24-violations');
const FR24_SYNC_STATE_DIR = path.join(CACHE_DIR, 'fr24-sync-state');

const FR24_TRACK_MIN_INTERVAL_MS = Number(process.env.FR24_TRACK_MIN_INTERVAL_MS || 6500);
let lastFr24TrackRequestAtMs = 0;

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

function readJsonFile(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
}

function writeJsonFile(p, obj) {
  try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); return true; } catch { return false; }
}

function safeFileKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 200);
}

function normalizeIdForMatch(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

function readFR24Token() {
  const json = readJsonFile(CREDENTIALS_PATH);
  if (!json) return null;
  return String(json?.FR24_API_KEY || json?.FR24_TOKEN || json?.fr24Token || json?.token || '').trim() || null;
}

// ---------------------------------------------------------------------------
// TMNP KML parsing + point-in-polygon (extracted from server.cjs)
// ---------------------------------------------------------------------------

function parseKmlCoordinatesText(coordsText) {
  const points = [];
  const cleaned = String(coordsText || '').trim();
  if (!cleaned) return points;
  for (const tok of cleaned.split(/\s+/)) {
    const parts = tok.split(',');
    if (parts.length < 2) continue;
    const lon = Number(parts[0]), lat = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lon, lat]);
  }
  if (points.length > 2) {
    const [lon0, lat0] = points[0], [lonn, latn] = points[points.length - 1];
    if (lon0 !== lonn || lat0 !== latn) points.push([lon0, lat0]);
  }
  return points;
}

function loadTMNPPolygons() {
  if (!fs.existsSync(TMNP_KML_PATH)) return [];
  const xml = fs.readFileSync(TMNP_KML_PATH, 'utf8');
  const polygons = [];
  for (const m of xml.matchAll(/<Polygon[\s\S]*?<\/Polygon>/g)) {
    const polyText = m[0];
    const outerMatch = polyText.match(/<outerBoundaryIs[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
    if (!outerMatch) continue;
    const outer = parseKmlCoordinatesText(outerMatch[1]);
    if (outer.length < 4) continue;
    const inner = [];
    for (const im of polyText.matchAll(/<innerBoundaryIs[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi)) {
      const hole = parseKmlCoordinatesText(im[1]);
      if (hole.length >= 4) inner.push(hole);
    }
    polygons.push({ outer, inner });
  }
  return polygons;
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInTMNP(lat, lon, polys) {
  for (const p of polys) {
    if (!pointInPolygon([lon, lat], p.outer)) continue;
    let inHole = false;
    for (const h of p.inner) { if (pointInPolygon([lon, lat], h)) { inHole = true; break; } }
    if (!inHole) return true;
  }
  return false;
}

function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSeg(a, b, c) {
  return Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
         Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
}
function segIntersect(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 === 0 && onSeg(a, b, c)) return true;
  if (o2 === 0 && onSeg(a, b, d)) return true;
  if (o3 === 0 && onSeg(c, d, a)) return true;
  if (o4 === 0 && onSeg(c, d, b)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function trackViolatesTMNP(trackPath, polys) {
  const pts = (trackPath || [])
    .map((p) => ({ lat: Number(p?.[1]), lon: Number(p?.[2]) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length === 0) return { violation: null, reason: 'no-track-points' };
  for (const p of pts) {
    if (pointInTMNP(p.lat, p.lon, polys)) return { violation: true, reason: 'point-in-tmnp' };
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = [pts[i].lon, pts[i].lat], b = [pts[i + 1].lon, pts[i + 1].lat];
    for (const poly of polys) {
      let hit = false;
      for (let j = 0; j < poly.outer.length - 1; j++) {
        if (segIntersect(a, b, poly.outer[j], poly.outer[j + 1])) { hit = true; break; }
      }
      if (!hit) continue;
      const midLat = (pts[i].lat + pts[i + 1].lat) / 2, midLon = (pts[i].lon + pts[i + 1].lon) / 2;
      if (pointInTMNP(midLat, midLon, polys)) return { violation: true, reason: 'segment-cross-midpoint-in-tmnp' };
    }
  }
  return { violation: false, reason: 'no-intersection-detected' };
}

// ---------------------------------------------------------------------------
// FR24 API
// ---------------------------------------------------------------------------

function httpsJson(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
        const pick = (k) => resp.headers[k] || resp.headers[String(k).toLowerCase()] || undefined;
        resolve({
          status: resp.statusCode || 0,
          headers: { 'retry-after': pick('retry-after'), 'x-ratelimit-remaining': pick('x-ratelimit-remaining') },
          response: json
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function fetchFlightSummary({ token, registrations, from, to, limit = 5000 }) {
  const qs = new URLSearchParams({ registrations, flight_datetime_from: from, flight_datetime_to: to, limit: String(limit), sort: 'asc' });
  return httpsJson({
    method: 'GET', hostname: 'fr24api.flightradar24.com',
    path: `/api/flight-summary/light?${qs}`,
    headers: { Accept: 'application/json', 'Accept-Version': 'v1', Authorization: `Bearer ${token}` }
  });
}

function fetchFlightTracks({ token, flightId }) {
  const qs = new URLSearchParams({ flight_id: flightId });
  return httpsJson({
    method: 'GET', hostname: 'fr24api.flightradar24.com',
    path: `/api/flight-tracks?${qs}`,
    headers: { Accept: 'application/json', 'Accept-Version': 'v1', Authorization: `Bearer ${token}` }
  });
}

async function fetchFlightTracksWithRetry({ token, flightId, maxAttempts = 4 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const now = Date.now();
    const waitMs = Math.max(0, lastFr24TrackRequestAtMs + FR24_TRACK_MIN_INTERVAL_MS - now);
    if (waitMs) await sleep(waitMs);
    lastFr24TrackRequestAtMs = Date.now();

    const result = await fetchFlightTracks({ token, flightId });
    if (result.status >= 200 && result.status < 300) return result;
    const retryable = [429, 500, 502, 503, 504].includes(result.status);
    if (!retryable || attempt === maxAttempts) return result;
    await sleep((result.status === 429 ? 1500 : 400) * attempt + Math.floor(Math.random() * 250));
  }
  return { status: 0, response: null };
}

function extractLonLat(trackResponse) {
  const maybeTracks = trackResponse?.tracks || trackResponse?.data?.tracks ||
    (Array.isArray(trackResponse) ? trackResponse?.[0]?.tracks : null) ||
    (Array.isArray(trackResponse?.data) ? trackResponse?.data?.[0]?.tracks : null);
  return Array.isArray(maybeTracks)
    ? maybeTracks.map((p) => [Number(p?.lon), Number(p?.lat)]).filter(([lo, la]) => Number.isFinite(la) && Number.isFinite(lo))
    : [];
}

function extractTrackMeta(trackResponse) {
  const maybeTracks = trackResponse?.tracks || trackResponse?.data?.tracks ||
    (Array.isArray(trackResponse) ? trackResponse?.[0]?.tracks : null) ||
    (Array.isArray(trackResponse?.data) ? trackResponse?.data?.[0]?.tracks : null);
  if (!Array.isArray(maybeTracks) || maybeTracks.length === 0) return null;
  const first = maybeTracks[0] || {}, last = maybeTracks[maybeTracks.length - 1] || {};
  return {
    first_seen: typeof first.timestamp === 'string' ? first.timestamp : null,
    last_seen: typeof last.timestamp === 'string' ? last.timestamp : null,
    callsign: typeof first.callsign === 'string' ? first.callsign : (typeof last.callsign === 'string' ? last.callsign : null),
    points: maybeTracks.length
  };
}

// ---------------------------------------------------------------------------
// Cache read/write (same format as server.cjs)
// ---------------------------------------------------------------------------

const TMNP_KML_SHA1 = (() => {
  try { return crypto.createHash('sha1').update(fs.readFileSync(TMNP_KML_PATH)).digest('hex'); } catch { return null; }
})();

function parseUtcIsoToMs(iso) {
  const s = String(iso || '').trim();
  if (!s) return NaN;
  const withZ = /Z$/i.test(s) ? s : `${s}Z`;
  const ms = Date.parse(withZ);
  return Number.isFinite(ms) ? ms : NaN;
}

function toFr24DateTimeUtc(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function readViolation(flightId) {
  const p = path.join(FR24_VIOLATIONS_DIR, `${safeFileKey(flightId)}.json`);
  const c = readJsonFile(p);
  if (!c || typeof c !== 'object') return null;
  if (TMNP_KML_SHA1 && c.tmnpKmlSha1 && c.tmnpKmlSha1 !== TMNP_KML_SHA1) return null;
  if (!('violation' in c) || !('reason' in c)) return null;
  return { violation: c.violation, reason: c.reason };
}

function writeViolation(flightId, { violation, reason }) {
  writeJsonFile(path.join(FR24_VIOLATIONS_DIR, `${safeFileKey(flightId)}.json`), {
    ts: Date.now(), tmnpKmlSha1: TMNP_KML_SHA1 || null, violation, reason
  });
}

function writeFlightMeta(flightId, meta) {
  const reg = meta.registration ? String(meta.registration).trim() : '';
  writeJsonFile(path.join(FR24_FLIGHT_META_DIR, `${safeFileKey(flightId)}.json`), {
    ts: Date.now(), registration: reg || null,
    registration_norm: reg ? normalizeIdForMatch(reg) : null,
    first_seen: meta.first_seen || null, last_seen: meta.last_seen || null
  });
}

function writeTrackMeta(flightId, meta) {
  writeJsonFile(path.join(FR24_TRACK_META_DIR, `${safeFileKey(flightId)}.json`), {
    ts: Date.now(), first_seen: meta.first_seen || null, last_seen: meta.last_seen || null,
    callsign: meta.callsign || null, points: Number.isFinite(Number(meta.points)) ? Number(meta.points) : null
  });
}

function writeTrackToDisk(flightId, result) {
  if (!result || result.status < 200 || result.status >= 300) return;
  writeJsonFile(path.join(FR24_TRACKS_DIR, `${safeFileKey(flightId)}.json`), { ts: Date.now(), result });
}

function readSyncState(registration) {
  const p = path.join(FR24_SYNC_STATE_DIR, `${safeFileKey(normalizeIdForMatch(registration))}.json`);
  const s = readJsonFile(p);
  return s?.last_synced_to ? { last_synced_to: s.last_synced_to } : null;
}

function writeSyncState(registration, { last_synced_to }) {
  writeJsonFile(path.join(FR24_SYNC_STATE_DIR, `${safeFileKey(normalizeIdForMatch(registration))}.json`), {
    ts: Date.now(), last_synced_to: last_synced_to || null
  });
}

// ---------------------------------------------------------------------------
// Sync one registration (mirrors /api/fr24/sync logic)
// ---------------------------------------------------------------------------

async function syncRegistration({ token, registration, tmnpPolygons }) {
  const regNorm = normalizeIdForMatch(registration);
  const state = readSyncState(registration);
  let fromMs = state?.last_synced_to ? parseUtcIsoToMs(state.last_synced_to) : NaN;

  const nowMs = Date.now();
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(fromMs)) fromMs = nowMs - fourteenDaysMs;

  const overlapMs = 60 * 60 * 1000;
  fromMs = Math.max(0, fromMs - overlapMs);

  const discoveredIds = new Set();
  let maxSeenMs = NaN;
  let cursorMs = fromMs;

  while (cursorMs < nowMs) {
    const endMs = Math.min(cursorMs + fourteenDaysMs - 1000, nowMs);
    const result = await fetchFlightSummary({
      token, registrations: registration,
      from: toFr24DateTimeUtc(cursorMs), to: toFr24DateTimeUtc(endMs)
    });

    if (result.status < 200 || result.status >= 300) {
      console.error(`  ⚠️  flight-summary ${result.status} for ${registration}`);
      break;
    }

    const flights = Array.isArray(result?.response?.data) ? result.response.data : [];
    for (const f of flights) {
      const id = String(f?.fr24_id || '').trim();
      if (!id) continue;
      discoveredIds.add(id);
      writeFlightMeta(id, { registration, first_seen: f?.first_seen, last_seen: f?.last_seen });
      const lsMs = parseUtcIsoToMs(f?.last_seen);
      if (Number.isFinite(lsMs) && (!Number.isFinite(maxSeenMs) || lsMs > maxSeenMs)) maxSeenMs = lsMs;
    }

    cursorMs = endMs + 1000;
  }

  const toCheck = Array.from(discoveredIds).filter((id) => !readViolation(id));
  let newViolations = 0, rateLimited = 0, errors = 0;

  for (const flightId of toCheck) {
    const track = await fetchFlightTracksWithRetry({ token, flightId });
    if (track.status < 200 || track.status >= 300) {
      if (track.status === 429) rateLimited++;
      else errors++;
      continue;
    }

    writeTrackToDisk(flightId, track);
    const lonLat = extractLonLat(track.response);
    const coords = lonLat.map(([lon, lat], idx) => [idx, lat, lon]);
    const v = trackViolatesTMNP(coords, tmnpPolygons);
    writeViolation(flightId, v);
    if (v.violation) newViolations++;

    const meta = extractTrackMeta(track.response);
    if (meta) {
      writeTrackMeta(flightId, meta);
      writeFlightMeta(flightId, { registration, first_seen: meta.first_seen, last_seen: meta.last_seen });
      const lsMs = parseUtcIsoToMs(meta.last_seen);
      if (Number.isFinite(lsMs) && (!Number.isFinite(maxSeenMs) || lsMs > maxSeenMs)) maxSeenMs = lsMs;
    }
  }

  const lastSyncedTo = Number.isFinite(maxSeenMs) ? new Date(maxSeenMs).toISOString() : new Date(nowMs).toISOString();
  writeSyncState(registration, { last_synced_to: lastSyncedTo });

  return {
    discovered: discoveredIds.size,
    checked: toCheck.length,
    newViolations,
    rateLimited,
    errors
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(CACHE_DIR);
  ensureDir(FR24_TRACKS_DIR);
  ensureDir(FR24_TRACK_META_DIR);
  ensureDir(FR24_FLIGHT_META_DIR);
  ensureDir(FR24_VIOLATIONS_DIR);
  ensureDir(FR24_SYNC_STATE_DIR);

  const token = readFR24Token();
  if (!token) { console.error('❌ Missing FR24_API_KEY in API/credentials.json'); process.exit(1); }

  const tmnpPolygons = loadTMNPPolygons();
  if (tmnpPolygons.length === 0) { console.error('❌ Failed to load TMNP polygons from tmnp.kml'); process.exit(1); }
  console.log(`🗺️  Loaded ${tmnpPolygons.length} TMNP polygon(s)`);

  const helicopters = readJsonFile(HELICOPTERS_PATH) || {};
  const allRegs = Object.keys(helicopters);

  const argRegs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const registrations = argRegs.length > 0 ? argRegs : allRegs;
  console.log(`🚁 Syncing ${registrations.length} registration(s): ${registrations.join(', ')}`);

  let totalNew = 0;
  for (const reg of registrations) {
    console.log(`\n📡 ${reg}…`);
    try {
      const r = await syncRegistration({ token, registration: reg, tmnpPolygons });
      console.log(`   discovered: ${r.discovered}, checked: ${r.checked}, new violations: ${r.newViolations}${r.rateLimited ? `, rate-limited: ${r.rateLimited}` : ''}${r.errors ? `, errors: ${r.errors}` : ''}`);
      totalNew += r.newViolations;
    } catch (err) {
      console.error(`   ❌ ${err.message}`);
    }
  }

  console.log(`\n✅ Sync complete. New violations found: ${totalNew}`);
  process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
