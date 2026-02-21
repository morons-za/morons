#!/usr/bin/env node
/**
 * One-off scan: find *unknown* aircraft that entered TMNP in a time window
 * using FR24 Historic Flight Positions (light) + our local TMNP polygon test.
 *
 * Notes:
 * - This script does NOT store raw FR24 responses on disk (complies with FR24 storage rules).
 * - It only prints a summary of candidates, and can optionally confirm via /api/fr24/violations.
 *
 * Requirements:
 * - API server running (for TMNP geojson + optional confirmation):
 *     PORT=4599 node API/server.cjs
 * - API/credentials.json contains FR24_API_KEY.
 *
 * Usage examples:
 *   # Quick sanity scan: last 6 hours, 5-minute interval, daytime only
 *   node API/scan-tmnp-historic.cjs --hours 6 --interval 300
 *
 *   # Last 30 days, 10-minute interval, daytime-only (SAST 06:00–20:00), just discovery
 *   node API/scan-tmnp-historic.cjs --days 30 --interval 600
 *
 *   # Confirm candidates by fetching tracks and computing TMNP violations (slow)
 *   node API/scan-tmnp-historic.cjs --days 30 --interval 600 --confirm
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CREDS_PATH = path.join(ROOT, 'credentials.json');

const DEFAULT_SERVER_BASE = process.env.BASE_URL || 'http://localhost:4599';
const FR24_API_BASE = 'https://fr24api.flightradar24.com/api';
// Optional pacing between FR24 historic calls to reduce 429s.
const FR24_HISTORIC_MIN_INTERVAL_MS = Number(process.env.FR24_HISTORIC_MIN_INTERVAL_MS || 6500);
let lastHistoricCallAtMs = 0;

function usage(exitCode = 1) {
  console.log(
    [
      'Usage:',
      '  node API/scan-tmnp-historic.cjs [--from ISO] [--to ISO] [--days N | --hours N] [--interval SECONDS] [--no-daytime] [--confirm]',
      '',
      'Options:',
      '  --from ISO      Window start (UTC). Example: 2026-01-01T00:00:00Z',
      '  --to ISO        Window end (UTC, exclusive). Example: 2026-01-11T00:00:00Z',
      '  --days N         How many days back from now (default: 1)',
      '  --hours N        How many hours back from now (overrides --days)',
      '  --interval S     Sampling interval in seconds (default: 600)',
      '  --no-daytime     Scan all hours (default is SAST daytime only: 06:00–20:00)',
      '  --confirm        Confirm candidates via local /api/fr24/violations (slow)',
      ''
    ].join('\n')
  );
  process.exitCode = exitCode;
}

function parseIsoUtcToMs(s) {
  const raw = String(s || '').trim();
  if (!raw) return NaN;
  // Accept either explicit Z, or treat as UTC if no offset is specified.
  const withZ = /[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const ms = Date.parse(withZ);
  return Number.isFinite(ms) ? ms : NaN;
}

function readFr24TokenFromCredentials() {
  try {
    const raw = fs.readFileSync(CREDS_PATH, 'utf8');
    const json = JSON.parse(raw);
    const token = String(json?.FR24_API_KEY || json?.token || '').trim();
    return token || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(headers) {
  const h = headers && typeof headers === 'object' ? headers : null;
  const ra = h ? (h.get ? h.get('retry-after') : (h['retry-after'] || h['Retry-After'])) : null;
  const s = ra == null ? '' : String(ra).trim();
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return Math.min(10 * 60 * 1000, Math.max(0, Math.floor(n * 1000)));
  return 0;
}

async function fetchJson(url, { headers = {}, method = 'GET', body } = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { ok: resp.ok, status: resp.status, statusText: resp.statusText, headers: resp.headers, json };
  } finally {
    clearTimeout(t);
  }
}

function toSastHour(isoOrDate) {
  // SAST is UTC+2 (no DST).
  const dt = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  const ms = dt.getTime();
  if (!Number.isFinite(ms)) return NaN;
  const sast = new Date(ms + 2 * 60 * 60 * 1000);
  return sast.getUTCHours();
}

function computeBBoxFromGeoJson(geo) {
  // returns { north, south, west, east }
  let north = -90;
  let south = 90;
  let west = 180;
  let east = -180;

  const walkCoords = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lon = coords[0];
      const lat = coords[1];
      if (lat > north) north = lat;
      if (lat < south) south = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) walkCoords(c);
  };

  const feats = Array.isArray(geo?.features) ? geo.features : [];
  for (const f of feats) walkCoords(f?.geometry?.coordinates);

  if (!(north >= south && east >= west)) return null;
  return { north, south, west, east };
}

function bufferBBoxKm(b, km) {
  const latMid = (b.north + b.south) / 2;
  const degLat = km / 111.0;
  const degLon = km / (111.0 * Math.cos((latMid * Math.PI) / 180));
  return {
    north: b.north + degLat,
    south: b.south - degLat,
    west: b.west - degLon,
    east: b.east + degLon
  };
}

function pointInRing(lon, lat, ring) {
  // Ray casting. ring: [[lon,lat], ...]
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, polygon) {
  // polygon: [outerRing, hole1, hole2...]
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  const outer = polygon[0];
  if (!pointInRing(lon, lat, outer)) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

function pointInGeoJson(lon, lat, geo) {
  const feats = Array.isArray(geo?.features) ? geo.features : [];
  for (const f of feats) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      if (pointInPolygon(lon, lat, g.coordinates)) return true;
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates || []) {
        if (pointInPolygon(lon, lat, poly)) return true;
      }
    }
  }
  return false;
}

function parseArgs(argv) {
  const out = {
    base: DEFAULT_SERVER_BASE,
    from: null,
    to: null,
    days: 1,
    hours: null,
    intervalSec: 600,
    daytimeOnly: true,
    confirm: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').trim();
    else if (a === '--from') out.from = String(argv[++i] || '').trim();
    else if (a === '--to') out.to = String(argv[++i] || '').trim();
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a === '--hours') out.hours = Number(argv[++i]);
    else if (a === '--interval') out.intervalSec = Number(argv[++i]);
    else if (a === '--no-daytime') out.daytimeOnly = false;
    else if (a === '--confirm') out.confirm = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage(0);
  if (!Number.isFinite(args.intervalSec) || args.intervalSec < 10) {
    console.error('Invalid --interval');
    return usage(2);
  }

  const token = readFr24TokenFromCredentials();
  if (!token) {
    console.error('Missing FR24 token in API/credentials.json (FR24_API_KEY)');
    process.exitCode = 2;
    return;
  }

  // Fetch TMNP geojson from local server (no extra parsing required here)
  const tmnpResp = await fetchJson(`${args.base}/api/tmnp.geojson`, {}, 20000);
  if (!tmnpResp.ok || !tmnpResp.json?.ok) {
    console.error('Failed to load TMNP geojson from local server:', tmnpResp.status, tmnpResp.json);
    process.exitCode = 2;
    return;
  }
  const tmnpGeo = tmnpResp.json.data;
  const bbox = computeBBoxFromGeoJson(tmnpGeo);
  if (!bbox) {
    console.error('Failed to compute TMNP bbox');
    process.exitCode = 2;
    return;
  }
  const bbox2 = bufferBBoxKm(bbox, 5); // small buffer so we don't miss boundary points
  const boundsStr = `${bbox2.north.toFixed(6)},${bbox2.south.toFixed(6)},${bbox2.west.toFixed(6)},${bbox2.east.toFixed(6)}`; // N,S,W,E

  const nowMs = Date.now();

  let startMs;
  let endMs;

  if (args.from || args.to) {
    startMs = args.from ? parseIsoUtcToMs(args.from) : NaN;
    endMs = args.to ? parseIsoUtcToMs(args.to) : NaN;
    if (!Number.isFinite(startMs)) {
      console.error('Invalid --from (expected ISO datetime, e.g. 2026-01-01T00:00:00Z)');
      return usage(2);
    }
    if (!Number.isFinite(endMs)) {
      console.error('Invalid --to (expected ISO datetime, e.g. 2026-01-11T00:00:00Z)');
      return usage(2);
    }
  } else {
    startMs = args.hours != null
      ? nowMs - Math.max(0, args.hours) * 60 * 60 * 1000
      : nowMs - Math.max(0, args.days) * 24 * 60 * 60 * 1000;
    endMs = nowMs;
  }

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    console.error('Invalid time window (end must be after start).');
    return usage(2);
  }

  // Align to interval
  const startSec = Math.floor(startMs / 1000);
  // Treat end as exclusive; include samples strictly before endMs.
  const endSec = Math.floor((endMs - 1) / 1000);
  const alignedStart = startSec - (startSec % args.intervalSec);

  const totalSamples = Math.max(0, Math.floor((endSec - alignedStart) / args.intervalSec) + 1);
  console.log('[scan] bounds (N,S,W,E):', boundsStr);
  console.log('[scan] window:', new Date(alignedStart * 1000).toISOString(), '→', new Date((endSec + 1) * 1000).toISOString());
  console.log('[scan] interval:', args.intervalSec, 'seconds; samples:', totalSamples, '; daytimeOnly:', args.daytimeOnly ? 'yes (SAST 06–20)' : 'no');
  console.log('[scan] note: this can take a long time and consumes credits.');

  const candidates = new Map(); // fr24_id -> { hits, firstSeen, lastSeen, callsigns:Set, hexes:Set }
  let calls = 0;
  let errors = 0;
  let rateLimited = 0;
  let skippedNight = 0;
  const progressEvery = 20;

  for (let ts = alignedStart; ts <= endSec; ts += args.intervalSec) {
    // Daytime filtering in SAST
    if (args.daytimeOnly) {
      const hr = toSastHour(new Date(ts * 1000));
      if (!(hr >= 6 && hr <= 20)) {
        skippedNight++;
        continue;
      }
    }

    calls++;
    if (FR24_HISTORIC_MIN_INTERVAL_MS > 0) {
      const now = Date.now();
      const waitMs = Math.max(0, lastHistoricCallAtMs + FR24_HISTORIC_MIN_INTERVAL_MS - now);
      if (waitMs) await sleep(waitMs);
      lastHistoricCallAtMs = Date.now();
    }
    const url = new URL(`${FR24_API_BASE}/historic/flight-positions/light`);
    url.searchParams.set('timestamp', String(ts));
    url.searchParams.set('bounds', boundsStr);
    url.searchParams.set('limit', '5000');

    let attempt = 0;
    while (true) {
      attempt++;
      const resp = await fetchJson(
        url.toString(),
        {
          headers: {
            Accept: 'application/json',
            'Accept-Version': 'v1',
            Authorization: `Bearer ${token}`
          }
        },
        30000
      );

      if (resp.ok && Array.isArray(resp.json?.data)) {
        const rows = resp.json.data;
        for (const r of rows) {
          const lon = Number(r?.lon);
          const lat = Number(r?.lat);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          if (!pointInGeoJson(lon, lat, tmnpGeo)) continue;
          const id = String(r?.fr24_id || '').trim();
          if (!id) continue;

          const tsIso = String(r?.timestamp || '').trim();
          const call = String(r?.callsign || '').trim();
          const hex = String(r?.hex || '').trim();

          const existing = candidates.get(id) || { hits: 0, firstSeen: tsIso || null, lastSeen: tsIso || null, callsigns: new Set(), hexes: new Set() };
          existing.hits++;
          if (tsIso) {
            if (!existing.firstSeen || tsIso < existing.firstSeen) existing.firstSeen = tsIso;
            if (!existing.lastSeen || tsIso > existing.lastSeen) existing.lastSeen = tsIso;
          }
          if (call) existing.callsigns.add(call);
          if (hex) existing.hexes.add(hex);
          candidates.set(id, existing);
        }
        break;
      }

      const status = Number(resp.status || 0);
      if (status === 429 && attempt < 6) {
        rateLimited++;
        const waitMs = parseRetryAfterMs(resp.headers) || 1500;
        // Make rate limiting visible in logs (but not too noisy).
        if (rateLimited <= 10 || rateLimited % 50 === 0) {
          console.log(`[scan] 429 rate limit (retry ${attempt}/5); waiting ${Math.round(waitMs / 1000)}s…`);
        }
        await sleep(waitMs + Math.floor(Math.random() * 250));
        continue;
      }

      errors++;
      if (errors <= 3) console.error('[scan] error', status, resp.statusText, resp.json);
      // keep going; this is a best-effort scan
      break;
    }

    // progress
    if (calls % progressEvery === 0) {
      console.log(`[scan] progress: calls=${calls}, candidates=${candidates.size}, rateLimited=${rateLimited}, errors=${errors}, skippedNight=${skippedNight}`);
    }
  }

  const list = Array.from(candidates.entries()).map(([fr24_id, v]) => ({
    fr24_id,
    hits: v.hits,
    firstSeen: v.firstSeen,
    lastSeen: v.lastSeen,
    callsigns: Array.from(v.callsigns).slice(0, 5),
    hexes: Array.from(v.hexes).slice(0, 5)
  }));
  list.sort((a, b) => b.hits - a.hits);

  console.log('');
  console.log(`[scan] done. calls=${calls}, candidates=${list.length}, rateLimited=${rateLimited}, errors=${errors}`);
  console.log('[scan] top candidates (fr24_id):');
  for (const r of list.slice(0, 50)) {
    console.log(
      `  ${r.fr24_id}  hits=${r.hits}  ${r.firstSeen || ''} → ${r.lastSeen || ''}  callsigns=${r.callsigns.join(',') || '—'}  hex=${r.hexes.join(',') || '—'}`
    );
  }

  if (!args.confirm || list.length === 0) return;

  console.log('');
  console.log('[scan] confirming candidates via local /api/fr24/violations (slow)…');

  const ids = list.map((x) => x.fr24_id);
  const confirmed = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const body = JSON.stringify({ flight_ids: batch });
    const resp = await fetchJson(
      `${args.base}/api/fr24/violations`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      30 * 60 * 1000
    );
    if (!resp.ok || !resp.json?.ok || !Array.isArray(resp.json?.results)) {
      console.error('[scan] confirm failed for batch:', batch, resp.status, resp.json);
      continue;
    }
    confirmed.push(...resp.json.results);
  }

  const yes = confirmed.filter((r) => r.violation === true);
  const no = confirmed.filter((r) => r.violation === false);
  const unk = confirmed.filter((r) => r.violation == null);

  console.log('');
  console.log(`[scan] confirm summary: yes=${yes.length}, no=${no.length}, unknown=${unk.length}`);
  if (yes.length) {
    console.log('[scan] confirmed violators:');
    for (const r of yes) console.log('  ', r.flight_id, r.reason || '');
  }
}

main().catch((e) => {
  console.error('[scan] fatal:', e);
  process.exitCode = 1;
});

