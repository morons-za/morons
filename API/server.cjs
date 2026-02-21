#!/usr/bin/env node
/**
 * Tiny local server for API pages.
 *
 * Why: Browsers block direct calls to OpenSky auth (CORS) from file:// pages.
 * This server serves the HTML and proxies token requests server-side.
 *
 * Usage:
 *   node API/server.cjs
 *   open http://localhost:4599/opensky.html
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4599);
const ROOT = __dirname;
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const TMNP_KML_PATH = path.join(ROOT, '..', 'static-site', 'tmnp.kml');

// Persistent on-disk cache (to reduce FR24 quota usage across restarts)
const CACHE_DIR = path.join(ROOT, 'cache');
const FR24_TRACKS_DIR = path.join(CACHE_DIR, 'fr24-tracks');
const FR24_TRACK_META_DIR = path.join(CACHE_DIR, 'fr24-track-meta');
const FR24_FLIGHT_META_DIR = path.join(CACHE_DIR, 'fr24-flight-meta');
const FR24_VIOLATIONS_DIR = path.join(CACHE_DIR, 'fr24-violations');
const FR24_SYNC_STATE_DIR = path.join(CACHE_DIR, 'fr24-sync-state');
const FR24_DISK_CACHE_TTL_MS = Number(process.env.FR24_DISK_CACHE_TTL_MS || 0); // 0 = never expire

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(obj, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > 2 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    // ignore
  }
}

function safeFileKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 200);
}

function readJsonFileIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(p, obj) {
  try {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2));
    return true;
  } catch {
    return false;
  }
}

function readCredentialsJsonFromFile() {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    if (!raw || !raw.trim()) return null;
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

function isExpired(tsMs) {
  if (!FR24_DISK_CACHE_TTL_MS) return false;
  if (!Number.isFinite(tsMs)) return true;
  return Date.now() - tsMs > FR24_DISK_CACHE_TTL_MS;
}

// In-memory cache for FR24 track responses (avoid re-fetch + reduce rate limits)
const FR24_TRACK_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const fr24TrackCache = new Map(); // flightId -> { ts, result }

// Simple global rate limiter for FR24 flight-tracks
let lastFr24TrackRequestAtMs = 0;
// Defaults are conservative. Override for backfills to respect plan limits.
// Explorer tier is ~10 req/min => ~6000ms per request.
const FR24_TRACK_MIN_INTERVAL_MS = Number(process.env.FR24_TRACK_MIN_INTERVAL_MS || 1200);
const FR24_VIOLATIONS_LOOP_DELAY_MS = Number(process.env.FR24_VIOLATIONS_LOOP_DELAY_MS || 120);

ensureDir(CACHE_DIR);
ensureDir(FR24_TRACKS_DIR);
ensureDir(FR24_TRACK_META_DIR);
ensureDir(FR24_FLIGHT_META_DIR);
ensureDir(FR24_VIOLATIONS_DIR);
ensureDir(FR24_SYNC_STATE_DIR);

function readOpenSkyCredentialsFromFile() {
  const json = readCredentialsJsonFromFile();
  if (!json) return null;

  // Allow either flat keys:
  // - clientId/clientSecret (existing)
  // - client_id/client_secret (existing)
  // Or nested:
  // - opensky: { clientId, clientSecret }
  const opensky = json?.opensky && typeof json.opensky === 'object' ? json.opensky : null;
  const clientId = String(opensky?.clientId || opensky?.client_id || json?.clientId || json?.client_id || '').trim();
  const clientSecret = String(opensky?.clientSecret || opensky?.client_secret || json?.clientSecret || json?.client_secret || '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function sanitiseHeaderValue(s) {
  return String(s || '').replace(/[\x00-\x1f\x7f]+/g, '').trim();
}

function readFR24TokenFromFile() {
  const fromEnv = sanitiseHeaderValue(process.env.FR24_TOKEN || process.env.FR24_API_KEY);
  if (fromEnv) return fromEnv;

  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8').trim();
  if (!raw) return null;

  // Allow either:
  // - raw token string (possibly containing '|')
  // - JSON containing token fields (legacy) or FR24_API_KEY (preferred)
  try {
    const json = JSON.parse(raw);
    const token = sanitiseHeaderValue(
      json?.FR24_API_KEY ||
        json?.FR24_TOKEN ||
        json?.fr24Token ||
        json?.apiToken ||
        json?.token ||
        ''
    );
    return token || null;
  } catch {
    return sanitiseHeaderValue(raw) || null;
  }
}

function readSendGridApiKeyFromFile() {
  const json = readCredentialsJsonFromFile();
  if (!json) return null;
  const key = String(json?.SENDGRID_API_KEY || json?.sendgridApiKey || '').trim();
  return key || null;
}

function sendSendGridEmail({ apiKey, from, to, subject, text, html, openTracking = true }) {
  return new Promise((resolve, reject) => {
    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject: subject || 'Heli Map alert',
      content: [],
      tracking_settings: openTracking ? { open_tracking: { enable: true } } : undefined
    };

    if (text) payload.content.push({ type: 'text/plain', value: String(text) });
    if (html) payload.content.push({ type: 'text/html', value: String(html) });
    if (payload.content.length === 0) payload.content.push({ type: 'text/plain', value: '(no content)' });

    const body = JSON.stringify(payload);
    const req2 = https.request(
      {
        method: 'POST',
        hostname: 'api.sendgrid.com',
        path: '/v3/mail/send',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const textResp = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: resp.statusCode || 0,
            statusText: resp.statusMessage,
            body: textResp
          });
        });
      }
    );
    req2.on('error', reject);
    req2.write(body);
    req2.end();
  });
}

function tmnpPolygonsToGeoJson(polygons) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'TMNP' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: (polygons || []).map((p) => {
            const outer = p.outer; // already [lon,lat]
            const holes = Array.isArray(p.inner) ? p.inner : [];
            return [outer, ...holes];
          })
        }
      }
    ]
  };
}

function buildKmlLineString({ name, coordinatesLonLat }) {
  const coordsText = (coordinatesLonLat || [])
    .map(([lon, lat]) => `${lon},${lat},0`)
    .join(' ');

  const safeName = (name || 'Flight track').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n` +
    `  <Document>\n` +
    `    <name>${safeName}</name>\n` +
    `    <Placemark>\n` +
    `      <name>${safeName}</name>\n` +
    `      <Style><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>\n` +
    `      <LineString>\n` +
    `        <tessellate>1</tessellate>\n` +
    `        <coordinates>${coordsText}</coordinates>\n` +
    `      </LineString>\n` +
    `    </Placemark>\n` +
    `  </Document>\n` +
    `</kml>\n`;
}

function pickFr24Headers(headers) {
  const h = headers || {};
  const pick = (k) => {
    const v = h[k] ?? h[String(k).toLowerCase()] ?? h[String(k).toUpperCase()];
    if (v == null) return undefined;
    return Array.isArray(v) ? v.join(', ') : String(v);
  };
  return {
    date: pick('date'),
    'content-type': pick('content-type'),
    'retry-after': pick('retry-after'),
    'x-ratelimit-limit': pick('x-ratelimit-limit'),
    'x-ratelimit-remaining': pick('x-ratelimit-remaining'),
    'x-ratelimit-reset': pick('x-ratelimit-reset')
  };
}

function computeFileHashSha1(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha1').update(buf).digest('hex');
  } catch {
    return null;
  }
}

const TMNP_KML_SHA1 = computeFileHashSha1(TMNP_KML_PATH);

function normalizeIdForMatch(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function parseUtcIsoToMs(iso) {
  const s = String(iso || '').trim();
  if (!s) return NaN;
  const withZ = /Z$/i.test(s) ? s : `${s}Z`;
  const ms = Date.parse(withZ);
  return Number.isFinite(ms) ? ms : NaN;
}

function toFr24DateTimeUtc(ms) {
  const dt = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

function extractTrackMetaFromFr24TrackResponse(trackResponse) {
  const maybeTracks =
    trackResponse?.tracks ||
    trackResponse?.data?.tracks ||
    (Array.isArray(trackResponse) ? trackResponse?.[0]?.tracks : null) ||
    (Array.isArray(trackResponse?.data) ? trackResponse?.data?.[0]?.tracks : null);

  if (!Array.isArray(maybeTracks) || maybeTracks.length === 0) return null;

  const first = maybeTracks[0] || {};
  const last = maybeTracks[maybeTracks.length - 1] || {};
  const first_seen = typeof first.timestamp === 'string' ? first.timestamp : null;
  const last_seen = typeof last.timestamp === 'string' ? last.timestamp : null;
  const callsign = typeof first.callsign === 'string' ? first.callsign : (typeof last.callsign === 'string' ? last.callsign : null);
  return {
    first_seen,
    last_seen,
    callsign,
    points: maybeTracks.length
  };
}

function readFr24TrackFromDisk(flightId) {
  const key = safeFileKey(flightId);
  const p = path.join(FR24_TRACKS_DIR, `${key}.json`);
  const cached = readJsonFileIfExists(p);
  if (!cached || typeof cached !== 'object') return null;
  if (isExpired(Number(cached.ts))) return null;
  return cached.result || null;
}

function writeFr24TrackToDisk(flightId, result) {
  // Only persist successful track responses (avoid “pinning” 429s).
  if (!result || result.status < 200 || result.status >= 300) return false;
  const key = safeFileKey(flightId);
  const p = path.join(FR24_TRACKS_DIR, `${key}.json`);
  return writeJsonFile(p, { ts: Date.now(), result });
}

function readFr24TrackMetaFromDisk(flightId) {
  const key = safeFileKey(flightId);
  const p = path.join(FR24_TRACK_META_DIR, `${key}.json`);
  const cached = readJsonFileIfExists(p);
  if (!cached || typeof cached !== 'object') return null;
  if (isExpired(Number(cached.ts))) return null;
  if (!('first_seen' in cached) && !('last_seen' in cached) && !('callsign' in cached)) return null;
  return {
    first_seen: cached.first_seen || null,
    last_seen: cached.last_seen || null,
    callsign: cached.callsign || null,
    points: Number.isFinite(Number(cached.points)) ? Number(cached.points) : null
  };
}

function writeFr24TrackMetaToDisk(flightId, meta) {
  if (!meta || typeof meta !== 'object') return false;
  const key = safeFileKey(flightId);
  const p = path.join(FR24_TRACK_META_DIR, `${key}.json`);
  return writeJsonFile(p, {
    ts: Date.now(),
    first_seen: meta.first_seen || null,
    last_seen: meta.last_seen || null,
    callsign: meta.callsign || null,
    points: Number.isFinite(Number(meta.points)) ? Number(meta.points) : null
  });
}

function readFr24FlightMetaFromDisk(flightId) {
  const key = safeFileKey(flightId);
  const p = path.join(FR24_FLIGHT_META_DIR, `${key}.json`);
  const cached = readJsonFileIfExists(p);
  if (!cached || typeof cached !== 'object') return null;
  if (isExpired(Number(cached.ts))) return null;
  return {
    registration: cached.registration || null,
    registration_norm: cached.registration_norm || (cached.registration ? normalizeIdForMatch(cached.registration) : null),
    first_seen: cached.first_seen || null,
    last_seen: cached.last_seen || null
  };
}

function writeFr24FlightMetaToDisk(flightId, meta) {
  if (!meta || typeof meta !== 'object') return false;
  const key = safeFileKey(flightId);
  const p = path.join(FR24_FLIGHT_META_DIR, `${key}.json`);
  const registration = meta.registration ? String(meta.registration).trim() : '';
  return writeJsonFile(p, {
    ts: Date.now(),
    registration: registration || null,
    registration_norm: registration ? normalizeIdForMatch(registration) : null,
    first_seen: meta.first_seen || null,
    last_seen: meta.last_seen || null
  });
}

function ensureFr24TrackMetaFromDiskIfPossible(flightId) {
  const existing = readFr24TrackMetaFromDisk(flightId);
  if (existing) return existing;

  const key = safeFileKey(flightId);
  const p = path.join(FR24_TRACKS_DIR, `${key}.json`);
  const cached = readJsonFileIfExists(p);
  const result = cached && typeof cached === 'object' ? cached.result : null;
  const meta = result ? extractTrackMetaFromFr24TrackResponse(result.response) : null;
  if (!meta) return null;
  writeFr24TrackMetaToDisk(flightId, meta);
  return meta;
}

function readFr24ViolationFromDisk(flightId) {
  const key = safeFileKey(flightId);
  const p = path.join(FR24_VIOLATIONS_DIR, `${key}.json`);
  const cached = readJsonFileIfExists(p);
  if (!cached || typeof cached !== 'object') return null;
  if (isExpired(Number(cached.ts))) return null;
  if (TMNP_KML_SHA1 && cached.tmnpKmlSha1 && cached.tmnpKmlSha1 !== TMNP_KML_SHA1) return null;
  if (!('violation' in cached) || !('reason' in cached)) return null;
  return { violation: cached.violation, reason: cached.reason };
}

function writeFr24ViolationToDisk(flightId, { violation, reason }) {
  const key = safeFileKey(flightId);
  const p = path.join(FR24_VIOLATIONS_DIR, `${key}.json`);
  return writeJsonFile(p, {
    ts: Date.now(),
    tmnpKmlSha1: TMNP_KML_SHA1 || null,
    violation,
    reason
  });
}

function readFr24SyncState(registration) {
  const key = safeFileKey(normalizeIdForMatch(registration));
  const p = path.join(FR24_SYNC_STATE_DIR, `${key}.json`);
  const state = readJsonFileIfExists(p);
  if (!state || typeof state !== 'object') return null;
  if (isExpired(Number(state.ts))) return null;
  return {
    last_synced_to: state.last_synced_to || null
  };
}

function writeFr24SyncState(registration, { last_synced_to }) {
  const key = safeFileKey(normalizeIdForMatch(registration));
  const p = path.join(FR24_SYNC_STATE_DIR, `${key}.json`);
  return writeJsonFile(p, {
    ts: Date.now(),
    last_synced_to: last_synced_to || null
  });
}

function findMaxLastSeenMsFromFlightMeta(regNorm) {
  if (!regNorm) return NaN;
  let files = [];
  try {
    files = fs.existsSync(FR24_FLIGHT_META_DIR) ? fs.readdirSync(FR24_FLIGHT_META_DIR) : [];
  } catch {
    files = [];
  }
  let best = NaN;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const meta = readJsonFileIfExists(path.join(FR24_FLIGHT_META_DIR, f));
    if (!meta || typeof meta !== 'object') continue;
    const rn = meta.registration_norm || (meta.registration ? normalizeIdForMatch(meta.registration) : '');
    if (!rn || rn !== regNorm) continue;
    const ms = parseUtcIsoToMs(meta.last_seen);
    if (Number.isFinite(ms) && (!Number.isFinite(best) || ms > best)) best = ms;
  }
  return best;
}

function findMaxLastSeenMsFromTrackMeta(regNorm) {
  if (!regNorm) return NaN;
  let files = [];
  try {
    files = fs.existsSync(FR24_TRACK_META_DIR) ? fs.readdirSync(FR24_TRACK_META_DIR) : [];
  } catch {
    files = [];
  }
  let best = NaN;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const meta = readJsonFileIfExists(path.join(FR24_TRACK_META_DIR, f));
    if (!meta || typeof meta !== 'object') continue;
    const callsignNorm = meta.callsign ? normalizeIdForMatch(meta.callsign) : '';
    if (!callsignNorm || callsignNorm !== regNorm) continue;
    const ms = parseUtcIsoToMs(meta.last_seen);
    if (Number.isFinite(ms) && (!Number.isFinite(best) || ms > best)) best = ms;
  }
  return best;
}

async function fetchFr24FlightSummaryLight({ token, registrations, from, to, limit = 5000 }) {
  const qs = new URLSearchParams({
    registrations: String(registrations || ''),
    flight_datetime_from: String(from || ''),
    flight_datetime_to: String(to || ''),
    limit: String(Math.max(1, Math.min(20000, Number(limit || 5000)))),
    sort: 'asc'
  });

  return await new Promise((resolve, reject) => {
    const req2 = https.request(
      {
        method: 'GET',
        hostname: 'fr24api.flightradar24.com',
        path: `/api/flight-summary/light?${qs.toString()}`,
        headers: {
          Accept: 'application/json',
          'Accept-Version': 'v1',
          Authorization: `Bearer ${token}`
        }
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { json = { raw: text }; }
          resolve({
            status: resp.statusCode || 0,
            statusText: resp.statusMessage,
            headers: pickFr24Headers(resp.headers),
            response: json
          });
        });
      }
    );
    req2.on('error', reject);
    req2.end();
  });
}

async function fetchFr24FlightTracks({ token, flightId }) {
  const qs = new URLSearchParams({ flight_id: String(flightId) });
  return await new Promise((resolve, reject) => {
    const req2 = https.request(
      {
        method: 'GET',
        hostname: 'fr24api.flightradar24.com',
        path: `/api/flight-tracks?${qs.toString()}`,
        headers: {
          Accept: 'application/json',
          'Accept-Version': 'v1',
          Authorization: `Bearer ${token}`
        }
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { json = { raw: text }; }
          resolve({
            status: resp.statusCode || 0,
            statusText: resp.statusMessage,
            headers: pickFr24Headers(resp.headers),
            response: json
          });
        });
      }
    );
    req2.on('error', reject);
    req2.end();
  });
}

async function fetchFr24FlightTracksWithRetry({ token, flightId, maxAttempts = 4 }) {
  const cacheKey = String(flightId);
  const cached = fr24TrackCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FR24_TRACK_CACHE_TTL_MS && cached.result?.status >= 200 && cached.result?.status < 300) {
    return cached.result;
  }
  const diskCached = readFr24TrackFromDisk(cacheKey);
  if (diskCached && diskCached?.status >= 200 && diskCached?.status < 300) {
    fr24TrackCache.set(cacheKey, { ts: Date.now(), result: diskCached });
    // Ensure we have lightweight meta for fast “cached flights” listing.
    const meta = extractTrackMetaFromFr24TrackResponse(diskCached.response);
    if (meta) writeFr24TrackMetaToDisk(cacheKey, meta);
    return diskCached;
  }

  // Simple retry for transient errors / rate limits.
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Global pacing to avoid FR24 rate limiting
    const now = Date.now();
    const waitMs = Math.max(0, lastFr24TrackRequestAtMs + FR24_TRACK_MIN_INTERVAL_MS - now);
    if (waitMs) await sleep(waitMs);
    lastFr24TrackRequestAtMs = Date.now();

    const result = await fetchFr24FlightTracks({ token, flightId });

    // OK
    if (result.status >= 200 && result.status < 300) {
      fr24TrackCache.set(cacheKey, { ts: Date.now(), result });
      writeFr24TrackToDisk(cacheKey, result);
      const meta = extractTrackMetaFromFr24TrackResponse(result.response);
      if (meta) writeFr24TrackMetaToDisk(cacheKey, meta);
      return result;
    }

    // Retry on common transient statuses
    const retryable = result.status === 429 || result.status === 500 || result.status === 502 || result.status === 503 || result.status === 504;
    if (!retryable || attempt === maxAttempts) return result;

    // Backoff (and a little jitter)
    const backoff = (result.status === 429 ? 1500 : 400) * attempt + Math.floor(Math.random() * 250);
    await sleep(backoff);
  }

  // Should never reach
  return { status: 0, statusText: 'retry-loop-exhausted', response: null };
}

function extractLonLatFromFr24TrackResponse(trackResponse) {
  const maybeTracks =
    trackResponse?.tracks ||
    trackResponse?.data?.tracks ||
    (Array.isArray(trackResponse) ? trackResponse?.[0]?.tracks : null) ||
    (Array.isArray(trackResponse?.data) ? trackResponse?.data?.[0]?.tracks : null);

  const lonLat = Array.isArray(maybeTracks)
    ? maybeTracks
        .map((p) => [Number(p?.lon), Number(p?.lat)])
        .filter(([lon, lat]) => Number.isFinite(lat) && Number.isFinite(lon))
    : [];

  return lonLat;
}

function parseKmlCoordinatesText(coordsText) {
  const points = [];
  const cleaned = String(coordsText || '').trim();
  if (!cleaned) return points;

  const tokens = cleaned.split(/\s+/);
  for (const tok of tokens) {
    const parts = tok.split(',');
    if (parts.length < 2) continue;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push([lon, lat]); // [lon, lat]
  }

  // Close ring if needed
  if (points.length > 2) {
    const [lon0, lat0] = points[0];
    const [lonn, latn] = points[points.length - 1];
    if (lon0 !== lonn || lat0 !== latn) points.push([lon0, lat0]);
  }

  return points;
}

function loadTMNPCoordinatesFromKml() {
  if (!fs.existsSync(TMNP_KML_PATH)) return [];
  const xml = fs.readFileSync(TMNP_KML_PATH, 'utf8');

  const polygons = [];
  const polygonMatches = xml.matchAll(/<Polygon[\s\S]*?<\/Polygon>/g);

  for (const m of polygonMatches) {
    const polyText = m[0];

    const outerMatch = polyText.match(
      /<outerBoundaryIs[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i
    );
    if (!outerMatch) continue;
    const outer = parseKmlCoordinatesText(outerMatch[1]);
    if (outer.length < 4) continue;

    const inner = [];
    const innerMatches = polyText.matchAll(
      /<innerBoundaryIs[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi
    );
    for (const im of innerMatches) {
      const hole = parseKmlCoordinatesText(im[1]);
      if (hole.length >= 4) inner.push(hole);
    }

    polygons.push({ outer, inner });
  }

  return polygons;
}

// Ray casting point-in-polygon (expects [x=lon,y=lat])
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInTMNP(lat, lon, tmnpPolygons) {
  for (const polygon of tmnpPolygons) {
    const inOuter = pointInPolygon([lon, lat], polygon.outer);
    if (!inOuter) continue;
    if (polygon.inner && polygon.inner.length > 0) {
      let inHole = false;
      for (const hole of polygon.inner) {
        if (pointInPolygon([lon, lat], hole)) {
          inHole = true;
          break;
        }
      }
      if (inHole) continue;
    }
    return true;
  }
  return false;
}

function orient(a, b, c) {
  // a,b,c are [lon,lat]
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, c) {
  // c on segment ab
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function segmentIntersectsRing(a, b, ring) {
  for (let i = 0; i < ring.length - 1; i++) {
    const c = ring[i];
    const d = ring[i + 1];
    if (segmentsIntersect(a, b, c, d)) return true;
  }
  return false;
}

function trackViolatesTMNP(trackPath, tmnpPolygons) {
  // trackPath: array of [time, lat, lon, ...]
  const pts = (trackPath || [])
    .map((p) => ({ lat: Number(p?.[1]), lon: Number(p?.[2]) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (pts.length === 0) return { violation: null, reason: 'no-track-points' };

  // Point check
  for (const p of pts) {
    if (pointInTMNP(p.lat, p.lon, tmnpPolygons)) return { violation: true, reason: 'point-in-tmnp' };
  }

  // Segment + midpoint check for sparse tracks
  for (let i = 0; i < pts.length - 1; i++) {
    const a = [pts[i].lon, pts[i].lat];
    const b = [pts[i + 1].lon, pts[i + 1].lat];
    for (const poly of tmnpPolygons) {
      if (!segmentIntersectsRing(a, b, poly.outer)) continue;
      const midLat = (pts[i].lat + pts[i + 1].lat) / 2;
      const midLon = (pts[i].lon + pts[i + 1].lon) / 2;
      if (pointInTMNP(midLat, midLon, tmnpPolygons)) return { violation: true, reason: 'segment-cross-midpoint-in-tmnp' };
    }
  }

  return { violation: false, reason: 'no-intersection-detected' };
}

const TMNP_POLYGONS = (() => {
  try {
    const polys = loadTMNPCoordinatesFromKml();
    if (!polys || polys.length === 0) {
      console.warn('⚠️ TMNP polygons not loaded (tmnp.kml parse returned empty).');
      return [];
    }
    console.log(`🗺️ Loaded ${polys.length} TMNP polygon(s) from tmnp.kml`);
    return polys;
  } catch (e) {
    console.warn('⚠️ Failed to load TMNP polygons:', e.message);
    return [];
  }
})();

function proxyOpenSkyToken({ clientId, clientSecret }) {
  return new Promise((resolve, reject) => {
    const tokenUrl = new URL(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
    );

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    }).toString();

    const req = https.request(
      {
        method: 'POST',
        hostname: tokenUrl.hostname,
        path: tokenUrl.pathname,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
          resolve({ status: resp.statusCode || 0, statusText: resp.statusMessage, response: json });
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function proxyOpenSkyApi({ path, token, query }) {
  return new Promise((resolve, reject) => {
    const base = new URL('https://opensky-network.org/api/');
    const url = new URL(path.replace(/^\//, ''), base);
    for (const [k, v] of Object.entries(query || {})) {
      if (v == null) continue;
      url.searchParams.set(k, String(v));
    }

    const req = https.request(
      {
        method: 'GET',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
          resolve({
            status: resp.statusCode || 0,
            statusText: resp.statusMessage,
            url: url.toString(),
            response: json
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Basic CORS for convenience when developing (same-origin is still preferred).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204, {}, '');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/opensky' || url.pathname === '/opensky.html')) {
      const p = path.join(ROOT, 'opensky.html');
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, fs.readFileSync(p));
    }
    if (req.method === 'GET' && (url.pathname === '/fr24' || url.pathname === '/fr24.html')) {
      const p = path.join(ROOT, 'fr24.html');
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, fs.readFileSync(p));
    }
    if (req.method === 'GET' && (url.pathname === '/fr24-track' || url.pathname === '/fr24-track.html')) {
      const p = path.join(ROOT, 'fr24-track.html');
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, fs.readFileSync(p));
    }

    if (req.method === 'GET' && url.pathname === '/api/tmnp.geojson') {
      if (!TMNP_POLYGONS || TMNP_POLYGONS.length === 0) return sendJson(res, 500, { ok: false, error: 'TMNP polygon not available' });
      return sendJson(res, 200, { ok: true, data: tmnpPolygonsToGeoJson(TMNP_POLYGONS) });
    }

    if (req.method === 'POST' && url.pathname === '/api/opensky/token') {
      const buf = await readBody(req);
      let input;
      try {
        input = JSON.parse(buf.toString('utf8'));
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      }

      let clientId = String(input?.clientId || '').trim();
      let clientSecret = String(input?.clientSecret || '').trim();
      if (!clientId || !clientSecret) {
        const creds = readOpenSkyCredentialsFromFile();
        clientId = creds?.clientId || '';
        clientSecret = creds?.clientSecret || '';
      }
      if (!clientId || !clientSecret) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Missing OpenSky credentials (provide in request or create API/credentials.json)'
        });
      }

      const result = await proxyOpenSkyToken({ clientId, clientSecret });
      if (result.status < 200 || result.status >= 300) {
        return sendJson(res, 502, { ok: false, proxied: true, ...result });
      }

      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    // --- SendGrid (test) ---
    if (req.method === 'POST' && url.pathname === '/api/sendgrid/test') {
      const buf = await readBody(req);
      let input;
      try {
        input = buf.length ? JSON.parse(buf.toString('utf8')) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      }

      const apiKey = String(input?.apiKey || '').trim() || readSendGridApiKeyFromFile();
      if (!apiKey) return sendJson(res, 400, { ok: false, error: 'Missing SENDGRID_API_KEY in API/credentials.json (or provide apiKey)' });

      const to = String(input?.to || '').trim();
      const from = String(input?.from || '').trim();
      if (!to) return sendJson(res, 400, { ok: false, error: 'Missing to' });
      if (!from) return sendJson(res, 400, { ok: false, error: 'Missing from (must be a verified sender in SendGrid)' });

      const subject = String(input?.subject || 'Heli Map test email').trim();
      const text = input?.text != null ? String(input.text) : `Test email sent at ${new Date().toISOString()}`;
      const html = input?.html != null ? String(input.html) : `<p>${text}</p>`;
      const openTracking = input?.openTracking === false ? false : true;

      const result = await sendSendGridEmail({ apiKey, from, to, subject, text, html, openTracking });

      if (result.status < 200 || result.status >= 300) {
        return sendJson(res, 502, { ok: false, proxied: true, ...result });
      }

      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    // --- FR24 proxies ---
    if (req.method === 'GET' && url.pathname === '/api/fr24/status') {
      const token = readFR24TokenFromFile();
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing FR24 token in API/credentials.json' });

      const result = await new Promise((resolve, reject) => {
        const req2 = https.request(
          {
            method: 'GET',
            hostname: 'fr24api.flightradar24.com',
            path: '/api/static/airlines/afl/light',
            headers: {
              Accept: 'application/json',
              'Accept-Version': 'v1',
              Authorization: `Bearer ${token}`
            }
          },
          (resp) => {
            const chunks = [];
            resp.on('data', (c) => chunks.push(c));
            resp.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let json;
              try { json = JSON.parse(text); } catch { json = { raw: text }; }
              resolve({
                status: resp.statusCode || 0,
                statusText: resp.statusMessage,
                headers: pickFr24Headers(resp.headers),
                response: json
              });
            });
          }
        );
        req2.on('error', reject);
        req2.end();
      });

      if (result.status < 200 || result.status >= 300) return sendJson(res, 502, { ok: false, proxied: true, ...result });
      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    // List locally cached flights + violation status (no upstream calls).
    // Useful for showing “everything we already know” on page load.
    if (req.method === 'GET' && url.pathname === '/api/fr24/cache/flights') {
      const registration = String(url.searchParams.get('registration') || '').trim();
      const regNorm = registration ? normalizeIdForMatch(registration) : '';

      let files = [];
      try {
        files = fs.existsSync(FR24_VIOLATIONS_DIR) ? fs.readdirSync(FR24_VIOLATIONS_DIR) : [];
      } catch {
        files = [];
      }

      const flights = [];
      let yes = 0, no = 0, unknown = 0;
      let maxLastSeenMs = NaN;

      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const flight_id = f.replace(/\.json$/i, '');

        const v = readFr24ViolationFromDisk(flight_id);
        if (!v) continue;

        const flightMeta = readFr24FlightMetaFromDisk(flight_id);
        let meta = readFr24TrackMetaFromDisk(flight_id) || ensureFr24TrackMetaFromDiskIfPossible(flight_id);
        if (regNorm) {
          const regFromFlightMeta = flightMeta?.registration_norm || '';
          if (regFromFlightMeta) {
            if (regFromFlightMeta !== regNorm) continue;
          } else {
            const callsignNorm = meta?.callsign ? normalizeIdForMatch(meta.callsign) : '';
            // FR24 callsigns often omit punctuation, e.g. "ZTHOT" for "ZT-HOT"
            if (!callsignNorm || callsignNorm !== regNorm) continue;
          }
        }

        if (v.violation === true) yes++;
        else if (v.violation === false) no++;
        else unknown++;

        const effectiveFirstSeen = meta?.first_seen || flightMeta?.first_seen || null;
        const effectiveLastSeen = meta?.last_seen || flightMeta?.last_seen || null;
        const ms = parseUtcIsoToMs(effectiveLastSeen);
        if (Number.isFinite(ms) && (!Number.isFinite(maxLastSeenMs) || ms > maxLastSeenMs)) maxLastSeenMs = ms;

        flights.push({
          fr24_id: flight_id,
          first_seen: effectiveFirstSeen,
          last_seen: effectiveLastSeen,
          callsign: meta?.callsign || null,
          points: meta?.points || null,
          registration: flightMeta?.registration || null,
          violation: v.violation,
          reason: v.reason
        });
      }

      // Sort newest first (if timestamps available)
      flights.sort((a, b) => String(b.first_seen || '').localeCompare(String(a.first_seen || '')));

      return sendJson(res, 200, {
        ok: true,
        cached: true,
        registration: registration || null,
        summary: { yes, no, unknown, total: flights.length },
        latest_last_seen: Number.isFinite(maxLastSeenMs) ? new Date(maxLastSeenMs).toISOString() : null,
        flights
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/fr24/flight-summary/light') {
      const token = readFR24TokenFromFile();
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing FR24 token in API/credentials.json' });

      const buf = await readBody(req);
      let input;
      try { input = JSON.parse(buf.toString('utf8')); } catch { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' }); }

      const registrations = String(input?.registrations || '').trim();
      const from = String(input?.flight_datetime_from || '').trim();
      const to = String(input?.flight_datetime_to || '').trim();
      const limit = Math.max(1, Math.min(20000, Number(input?.limit || 5000)));
      if (!registrations) return sendJson(res, 400, { ok: false, error: 'Missing registrations' });
      if (!from || !to) return sendJson(res, 400, { ok: false, error: 'Missing flight_datetime_from/to' });

      const result = await fetchFr24FlightSummaryLight({ token, registrations, from, to, limit });

      if (result.status < 200 || result.status >= 300) return sendJson(res, 502, { ok: false, proxied: true, ...result });
      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    // Sync new flights since last sync and compute violations.
    // Server-side so the browser doesn’t need to handle 14-day windows or rate limits.
    if (req.method === 'POST' && url.pathname === '/api/fr24/sync') {
      const token = readFR24TokenFromFile();
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing FR24 token in API/credentials.json' });
      if (!TMNP_POLYGONS || TMNP_POLYGONS.length === 0) {
        return sendJson(res, 500, { ok: false, error: 'TMNP polygon not available (tmnp.kml parse failed)' });
      }

      const buf = await readBody(req);
      let input;
      try { input = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' }); }

      const registration = String(input?.registration || '').trim();
      if (!registration) return sendJson(res, 400, { ok: false, error: 'Missing registration' });
      const regNorm = normalizeIdForMatch(registration);
      if (!regNorm) return sendJson(res, 400, { ok: false, error: 'Invalid registration' });

      // Determine where to start:
      // - Prefer explicit sync state
      // - Else use last_seen from cached meta (flight-meta, then track-meta)
      // - Else default to last 14 days (FR24 max per query)
      const state = readFr24SyncState(registration);
      let fromMs = state?.last_synced_to ? parseUtcIsoToMs(state.last_synced_to) : NaN;
      if (!Number.isFinite(fromMs)) fromMs = findMaxLastSeenMsFromFlightMeta(regNorm);
      if (!Number.isFinite(fromMs)) fromMs = findMaxLastSeenMsFromTrackMeta(regNorm);

      const nowMs = Date.now();
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(fromMs)) fromMs = nowMs - fourteenDaysMs;

      // Overlap a bit to avoid missing late-arriving flights. Duplicate results are fine (cached).
      const overlapMs = 60 * 60 * 1000; // 1 hour
      fromMs = Math.max(0, fromMs - overlapMs);

      const windows = [];
      const discoveredIds = new Set();
      let maxSeenMs = NaN;

      // Cap windows to avoid accidental huge backfills from the UI.
      const MAX_WINDOWS = 120;
      let cursorMs = fromMs;
      while (cursorMs < nowMs && windows.length < MAX_WINDOWS) {
        const endMs = Math.min(cursorMs + fourteenDaysMs - 1000, nowMs);
        const fromStr = toFr24DateTimeUtc(cursorMs);
        const toStr = toFr24DateTimeUtc(endMs);

        const result = await fetchFr24FlightSummaryLight({
          token,
          registrations: registration,
          from: fromStr,
          to: toStr,
          limit: 5000
        });

        windows.push({
          from: fromStr,
          to: toStr,
          status: result.status,
          retry_after: result.headers?.['retry-after'] || null
        });

        if (result.status < 200 || result.status >= 300) {
          return sendJson(res, 502, { ok: false, proxied: true, stage: 'flight-summary', registration, ...result, windows });
        }

        const flights = Array.isArray(result?.response?.data) ? result.response.data : [];
        for (const f of flights) {
          const id = String(f?.fr24_id || '').trim();
          if (!id) continue;
          discoveredIds.add(id);
          writeFr24FlightMetaToDisk(id, {
            registration,
            first_seen: f?.first_seen || null,
            last_seen: f?.last_seen || null
          });
          const lsMs = parseUtcIsoToMs(f?.last_seen);
          if (Number.isFinite(lsMs) && (!Number.isFinite(maxSeenMs) || lsMs > maxSeenMs)) maxSeenMs = lsMs;
        }

        cursorMs = endMs + 1000;
      }

      const allIds = Array.from(discoveredIds);
      const toCheck = allIds.filter((id) => !readFr24ViolationFromDisk(id));

      const results = [];
      let rateLimited = 0;
      let trackErrors = 0;
      let cachedAlready = allIds.length - toCheck.length;

      for (const flight_id of toCheck) {
        const loopStartedAt = Date.now();
        const cachedV = readFr24ViolationFromDisk(flight_id);
        if (cachedV) {
          results.push({ flight_id, violation: cachedV.violation, reason: cachedV.reason, cached: true });
          continue;
        }

        const track = await fetchFr24FlightTracksWithRetry({ token, flightId: flight_id });
        if (track.status < 200 || track.status >= 300) {
          const reason = `track-http-${track.status}`;
          results.push({ flight_id, violation: null, reason });
          if (track.status === 429) rateLimited++;
          else trackErrors++;
          const waitMs = Math.max(0, FR24_VIOLATIONS_LOOP_DELAY_MS - (Date.now() - loopStartedAt));
          if (waitMs) await sleep(waitMs);
          continue;
        }

        const lonLat = extractLonLatFromFr24TrackResponse(track.response);
        const coords = lonLat.map(([lon, lat], idx) => [idx, lat, lon]); // [time, lat, lon]
        const v = trackViolatesTMNP(coords, TMNP_POLYGONS);
        results.push({ flight_id, violation: v.violation, reason: v.reason });
        writeFr24ViolationToDisk(flight_id, { violation: v.violation, reason: v.reason });

        // Ensure we have per-aircraft flight meta for listing/filtering.
        const meta = extractTrackMetaFromFr24TrackResponse(track.response);
        if (meta) {
          writeFr24TrackMetaToDisk(flight_id, meta);
          writeFr24FlightMetaToDisk(flight_id, {
            registration,
            first_seen: meta.first_seen || null,
            last_seen: meta.last_seen || null
          });
          const lsMs = parseUtcIsoToMs(meta.last_seen);
          if (Number.isFinite(lsMs) && (!Number.isFinite(maxSeenMs) || lsMs > maxSeenMs)) maxSeenMs = lsMs;
        }

        const waitMs = Math.max(0, FR24_VIOLATIONS_LOOP_DELAY_MS - (Date.now() - loopStartedAt));
        if (waitMs) await sleep(waitMs);
      }

      const lastSyncedTo = Number.isFinite(maxSeenMs) ? new Date(maxSeenMs).toISOString() : new Date(nowMs).toISOString();
      writeFr24SyncState(registration, { last_synced_to: lastSyncedTo });

      return sendJson(res, 200, {
        ok: true,
        proxied: true,
        registration,
        from: new Date(fromMs).toISOString(),
        to: new Date(nowMs).toISOString(),
        windows,
        discovered_flights: allIds.length,
        checked_flights: toCheck.length,
        cached_already: cachedAlready,
        rate_limited: rateLimited,
        track_errors: trackErrors,
        last_synced_to: lastSyncedTo,
        // Keep results for debugging, but it’s safe: cached yes/no prevents re-hitting quota.
        results
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/fr24/flight-tracks') {
      const token = readFR24TokenFromFile();
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing FR24 token in API/credentials.json' });

      const buf = await readBody(req);
      let input;
      try { input = JSON.parse(buf.toString('utf8')); } catch { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' }); }

      const flight_id = String(input?.flight_id || '').trim();
      if (!flight_id) return sendJson(res, 400, { ok: false, error: 'Missing flight_id' });

      const result = await fetchFr24FlightTracks({ token, flightId: flight_id });

      if (result.status < 200 || result.status >= 300) return sendJson(res, 502, { ok: false, proxied: true, ...result });
      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    if (req.method === 'GET' && url.pathname === '/api/fr24/flight-tracks') {
      const token = readFR24TokenFromFile();
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing FR24 token in API/credentials.json' });
      const flight_id = String(url.searchParams.get('flight_id') || '').trim();
      if (!flight_id) return sendJson(res, 400, { ok: false, error: 'Missing flight_id' });

      const result = await fetchFr24FlightTracks({ token, flightId: flight_id });
      if (result.status < 200 || result.status >= 300) return sendJson(res, 502, { ok: false, proxied: true, ...result });
      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    if (req.method === 'GET' && url.pathname === '/api/fr24/flight-tracks.kml') {
      const token = readFR24TokenFromFile();
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing FR24 token in API/credentials.json' });
      const flight_id = String(url.searchParams.get('flight_id') || '').trim();
      if (!flight_id) return sendJson(res, 400, { ok: false, error: 'Missing flight_id' });

      const result = await fetchFr24FlightTracks({ token, flightId: flight_id });
      if (result.status < 200 || result.status >= 300) return sendJson(res, 502, { ok: false, proxied: true, ...result });

      const lonLat = extractLonLatFromFr24TrackResponse(result.response);
      const kml = buildKmlLineString({ name: `FR24 ${flight_id}`, coordinatesLonLat: lonLat });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.google-earth.kml+xml; charset=utf-8',
        'Content-Disposition': `attachment; filename=\"${flight_id}.kml\"`
      });
      res.end(kml);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fr24/violations') {
      const token = readFR24TokenFromFile();
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing FR24 token in API/credentials.json' });
      if (!TMNP_POLYGONS || TMNP_POLYGONS.length === 0) {
        return sendJson(res, 500, { ok: false, error: 'TMNP polygon not available (tmnp.kml parse failed)' });
      }

      const buf = await readBody(req);
      let input;
      try { input = JSON.parse(buf.toString('utf8')); } catch { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' }); }

      const flight_ids = Array.isArray(input?.flight_ids) ? input.flight_ids : [];
      if (flight_ids.length === 0) return sendJson(res, 400, { ok: false, error: 'Missing flight_ids[]' });

      const results = [];
      for (const flight_id of flight_ids) {
        const loopStartedAt = Date.now();
        // If we already computed a violation for this flight (same TMNP KML), return it without using quota.
        const cachedV = readFr24ViolationFromDisk(flight_id);
        if (cachedV) {
          results.push({ flight_id, violation: cachedV.violation, reason: cachedV.reason });
          continue;
        }

        const track = await fetchFr24FlightTracksWithRetry({ token, flightId: flight_id });

        if (track.status < 200 || track.status >= 300) {
          results.push({ flight_id, violation: null, reason: `track-http-${track.status}` });
          // Avoid hammering in error scenarios
          const waitMs = Math.max(0, FR24_VIOLATIONS_LOOP_DELAY_MS - (Date.now() - loopStartedAt));
          if (waitMs) await sleep(waitMs);
          continue;
        }

        const lonLat = extractLonLatFromFr24TrackResponse(track.response);
        const coords = lonLat.map(([lon, lat], idx) => [idx, lat, lon]); // [time, lat, lon]

        const v = trackViolatesTMNP(coords, TMNP_POLYGONS);
        results.push({ flight_id, violation: v.violation, reason: v.reason });
        // Persist derived result (tiny, and saves quota on re-check).
        writeFr24ViolationToDisk(flight_id, { violation: v.violation, reason: v.reason });

        // Small pacing helps avoid rate limiting when checking many flights
        const waitMs = Math.max(0, FR24_VIOLATIONS_LOOP_DELAY_MS - (Date.now() - loopStartedAt));
        if (waitMs) await sleep(waitMs);
      }

      return sendJson(res, 200, { ok: true, proxied: true, results });
    }

    if (req.method === 'POST' && url.pathname === '/api/opensky/flights/aircraft') {
      const buf = await readBody(req);
      let input;
      try {
        input = JSON.parse(buf.toString('utf8'));
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      }

      const token = String(input?.token || '').trim();
      const icao24 = String(input?.icao24 || '').trim().toLowerCase();
      const begin = Number(input?.begin);
      const end = Number(input?.end);
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing token' });
      if (!icao24) return sendJson(res, 400, { ok: false, error: 'Missing icao24' });
      if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) {
        return sendJson(res, 400, { ok: false, error: 'Invalid begin/end (unix seconds)' });
      }

      const result = await proxyOpenSkyApi({
        path: '/flights/aircraft',
        token,
        query: { icao24, begin: Math.floor(begin), end: Math.floor(end) }
      });

      if (result.status === 404) return sendJson(res, 200, { ok: true, proxied: true, empty: true, ...result });
      if (result.status < 200 || result.status >= 300) return sendJson(res, 502, { ok: false, proxied: true, ...result });
      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/opensky/tracks/all') {
      const buf = await readBody(req);
      let input;
      try {
        input = JSON.parse(buf.toString('utf8'));
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      }

      const token = String(input?.token || '').trim();
      const icao24 = String(input?.icao24 || '').trim().toLowerCase();
      const time = Number(input?.time);
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing token' });
      if (!icao24) return sendJson(res, 400, { ok: false, error: 'Missing icao24' });
      if (!Number.isFinite(time) || time <= 0) return sendJson(res, 400, { ok: false, error: 'Invalid time (unix seconds)' });

      const result = await proxyOpenSkyApi({
        path: '/tracks/all',
        token,
        query: { icao24, time: Math.floor(time) }
      });

      if (result.status === 404) return sendJson(res, 200, { ok: true, proxied: true, empty: true, ...result });
      if (result.status < 200 || result.status >= 300) return sendJson(res, 502, { ok: false, proxied: true, ...result });
      return sendJson(res, 200, { ok: true, proxied: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/opensky/violations') {
      const buf = await readBody(req);
      let input;
      try {
        input = JSON.parse(buf.toString('utf8'));
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      }

      const token = String(input?.token || '').trim();
      const icao24 = String(input?.icao24 || '').trim().toLowerCase();
      const flights = Array.isArray(input?.flights) ? input.flights : [];
      if (!token) return sendJson(res, 400, { ok: false, error: 'Missing token' });
      if (!icao24) return sendJson(res, 400, { ok: false, error: 'Missing icao24' });
      if (!Array.isArray(flights) || flights.length === 0) return sendJson(res, 400, { ok: false, error: 'Missing flights[]' });
      if (!TMNP_POLYGONS || TMNP_POLYGONS.length === 0) {
        return sendJson(res, 500, { ok: false, error: 'TMNP polygon not available (tmnp.kml parse failed)' });
      }

      const results = [];

      // Sequential to keep it simple and API-friendly
      for (const f of flights) {
        const firstSeen = Number(f.firstSeen);
        const lastSeen = Number(f.lastSeen);
        const timeHint =
          Number.isFinite(firstSeen) && Number.isFinite(lastSeen)
            ? Math.floor((firstSeen + lastSeen) / 2)
            : (Number.isFinite(firstSeen) ? Math.floor(firstSeen) : 0);

        if (!timeHint) {
          results.push({ key: f.key, firstSeen, lastSeen, violation: null, reason: 'missing-timehint' });
          continue;
        }

        const trackResp = await proxyOpenSkyApi({
          path: '/tracks/all',
          token,
          query: { icao24, time: timeHint }
        });

        if (trackResp.status === 404) {
          results.push({ key: f.key, firstSeen, lastSeen, timeHint, violation: null, reason: 'no-track-404' });
          continue;
        }
        if (trackResp.status < 200 || trackResp.status >= 300) {
          results.push({ key: f.key, firstSeen, lastSeen, timeHint, violation: null, reason: `track-http-${trackResp.status}` });
          continue;
        }

        const path = trackResp?.response?.path;
        const v = trackViolatesTMNP(path, TMNP_POLYGONS);
        results.push({ key: f.key, firstSeen, lastSeen, timeHint, violation: v.violation, reason: v.reason });
      }

      return sendJson(res, 200, { ok: true, proxied: true, icao24, results });
    }

    sendJson(res, 404, { ok: false, error: 'Not found', path: url.pathname });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}/opensky.html`);
});

