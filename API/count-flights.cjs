#!/usr/bin/env node
/**
 * Count how many flights the FR24 API returns for a given registration,
 * using cached flight IDs + flight-summary(light) by flight_ids.
 *
 * Usage:
 *   PORT=4616 node API/server.cjs
 *   node API/count-flights.cjs --base http://localhost:4616 --reg ZT-HOT
 *
 * Notes:
 * - This avoids date-range queries (which currently appear to return empty data).
 * - It relies on locally cached IDs under API/cache/.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    base: process.env.BASE_URL || 'http://localhost:4599',
    reg: '',
    maxIds: 2000
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').trim();
    else if (a === '--reg') out.reg = String(argv[++i] || '').trim();
    else if (a === '--max-ids') out.maxIds = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else out.unknown = (out.unknown || []).concat(a);
  }
  return out;
}

function normalizeIdForMatch(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function safeReadJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchJson(url, { method = 'GET', body } = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { ok: false, error: 'Non-JSON response', raw: text };
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function minIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return String(a) < String(b) ? a : b;
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return String(a) > String(b) ? a : b;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node API/count-flights.cjs --base http://localhost:4599 --reg ZT-HOT [--max-ids 2000]');
    process.exitCode = 0;
    return;
  }
  if (args.unknown?.length) {
    console.error('Unknown args:', args.unknown.join(' '));
    process.exitCode = 2;
    return;
  }
  if (!args.reg) {
    console.error('Missing --reg');
    process.exitCode = 2;
    return;
  }

  const targetNorm = normalizeIdForMatch(args.reg);
  const cacheDir = path.join(__dirname, 'cache');
  const flightMetaDir = path.join(cacheDir, 'fr24-flight-meta');
  const trackMetaDir = path.join(cacheDir, 'fr24-track-meta');

  if (!fs.existsSync(flightMetaDir)) {
    console.error('Missing cache dir:', flightMetaDir);
    process.exitCode = 2;
    return;
  }

  // Collect candidate flight IDs from locally cached flight-meta (registration)
  // and track-meta (callsign). Track-meta tends to be more complete when we've
  // fetched tracks/violations already.
  const idsFromFlightMeta = [];
  for (const f of fs.readdirSync(flightMetaDir)) {
    if (!f.endsWith('.json')) continue;
    const id = f.replace(/\.json$/i, '');
    const meta = safeReadJson(path.join(flightMetaDir, f));
    if (!meta || typeof meta !== 'object') continue;
    const rn = meta.registration_norm || (meta.registration ? normalizeIdForMatch(meta.registration) : '');
    if (rn && rn === targetNorm) idsFromFlightMeta.push(id);
  }

  const idsFromTrackMeta = [];
  if (fs.existsSync(trackMetaDir)) {
    for (const f of fs.readdirSync(trackMetaDir)) {
      if (!f.endsWith('.json')) continue;
      const id = f.replace(/\.json$/i, '');
      const meta = safeReadJson(path.join(trackMetaDir, f));
      if (!meta || typeof meta !== 'object') continue;
      const callsignNorm = meta.callsign ? normalizeIdForMatch(meta.callsign) : '';
      if (callsignNorm && callsignNorm === targetNorm) idsFromTrackMeta.push(id);
    }
  }

  // De-dupe and cap.
  const ids = Array.from(new Set([...idsFromFlightMeta, ...idsFromTrackMeta])).slice(
    0,
    Number.isFinite(args.maxIds) ? Math.max(1, args.maxIds) : 2000
  );
  console.log(`[count] registration=${args.reg} (norm=${targetNorm})`);
  console.log(`[count] cached flight-meta matches: ${idsFromFlightMeta.length}`);
  console.log(`[count] cached track-meta (callsign) matches: ${idsFromTrackMeta.length}`);
  console.log(`[count] unique candidate flight ids: ${ids.length}`);
  if (ids.length === 0) return;

  // Ask the API for those IDs (10 max per query) and count how many come back as the target reg.
  let totalReturned = 0;
  let totalMatched = 0;
  let minTakeoff = null;
  let maxLanded = null;

  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const json = await fetchJson(`${args.base}/api/fr24/flight-summary/light`, {
      method: 'POST',
      body: { flight_ids: batch.join(',') }
    }, 60000);

    if (!json.ok) {
      console.error('[count] flight-summary by ids failed:', json);
      process.exitCode = 3;
      return;
    }

    const data = Array.isArray(json?.response?.data) ? json.response.data : [];
    totalReturned += data.length;

    for (const r of data) {
      const reg = String(r?.reg || r?.registration || '').trim();
      const rn = reg ? normalizeIdForMatch(reg) : '';
      if (rn === targetNorm) {
        totalMatched++;
        minTakeoff = minIso(minTakeoff, r?.datetime_takeoff || r?.first_seen || null);
        maxLanded = maxIso(maxLanded, r?.datetime_landed || r?.last_seen || null);
      }
    }
  }

  console.log(`[count] API returned records (all ids): ${totalReturned}`);
  console.log(`[count] API returned records matching ${args.reg}: ${totalMatched}`);
  console.log(`[count] range (min takeoff/first_seen): ${minTakeoff || '—'}`);
  console.log(`[count] range (max landed/last_seen): ${maxLanded || '—'}`);
}

main().catch((e) => {
  console.error('[count] fatal:', e);
  process.exitCode = 1;
});

