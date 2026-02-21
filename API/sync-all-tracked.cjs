#!/usr/bin/env node
/**
 * Sync new flights for all tracked aircraft since last sync, compute violations,
 * and persist to cache (same as "Fetch new flights" for all aircraft in fr24.html).
 *
 * Throttles by waiting between each aircraft so FR24 rate limits (e.g. 10 req/min
 * Explorer) are not exceeded. Use --delay to set seconds between aircraft.
 *
 * Requires: API server running (e.g. PORT=4599 node API/server.cjs) and
 *           API/credentials.json with FR24_API_KEY.
 *
 * Usage: node API/sync-all-tracked.cjs
 *        node API/sync-all-tracked.cjs --only ZS-RTG ZT-REG ZT-RMS --delay 90
 *        SYNC_DELAY_BETWEEN_AIRCRAFT_MS=90000 node API/sync-all-tracked.cjs
 */

const REGISTRATIONS = [
  'ZT-HOT', 'ZT-RNW', 'ZT-RPG', 'ZT-RUM',
  'ZS-HIM', 'ZS-HIE', 'ZS-HBO', 'ZS-HGD', 'ZS-HMB', 'ZS-RLC', 'ZS-RTG',
  'ZT-REG', 'ZT-RMS'
];

const BASE_URL = process.env.BASE_URL || 'http://localhost:4599';

function parseArgs(argv) {
  const out = {
    only: null,
    delayMs: Number(process.env.SYNC_DELAY_BETWEEN_AIRCRAFT_MS || 0) || 90000
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') {
      out.only = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out.only.push(argv[++i].trim());
      }
    } else if (argv[i] === '--delay' && i + 1 < argv.length) {
      out.delayMs = Math.max(0, Number(argv[++i]) || 0) * 1000;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncOne(registration) {
  const res = await fetch(`${BASE_URL}/api/fr24/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registration })
  });
  const json = await res.json().catch(() => ({}));
  return { registration, ok: res.ok && json.ok, status: res.status, json };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = args.only && args.only.length
    ? args.only
        .map((s) => {
          const t = String(s).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          return REGISTRATIONS.find((r) => r.replace(/-/g, '') === t || r === s.trim().toUpperCase());
        })
        .filter(Boolean)
    : REGISTRATIONS;
  if (args.only && args.only.length && list.length === 0) {
    console.error('[sync] --only did not match any known registration. Known:', REGISTRATIONS.join(', '));
    process.exitCode = 2;
    return;
  }
  const delayMs = args.delayMs;
  if (delayMs > 0) {
    console.log(`[sync] Throttle: waiting ${Math.round(delayMs / 1000)}s between each aircraft.`);
  }
  console.log(`[sync] Syncing ${list.length} aircraft: ${list.join(', ')}\n`);

  let totalFlights = 0;
  let totalViolations = 0;
  const perAircraft = [];

  for (let i = 0; i < list.length; i++) {
    if (i > 0 && delayMs > 0) {
      console.log(`[sync] Waiting ${Math.round(delayMs / 1000)}s before next aircraft…`);
      await sleep(delayMs);
    }
    const reg = list[i];
    const { registration, ok, json } = await syncOne(reg);
    const discovered = Number(json?.discovered_flights ?? 0);
    const results = Array.isArray(json?.results) ? json.results : [];
    const violations = results.filter((r) => r.violation === true).length;

    totalFlights += discovered;
    totalViolations += violations;
    perAircraft.push({
      registration,
      ok,
      discovered,
      violations,
      error: !ok ? (json?.error || json?.statusText || 'request failed') : null
    });

    if (!ok) {
      console.error(`[sync] ${registration}: failed –`, json?.error || json?.statusText);
    } else {
      console.log(`[sync] ${registration}: ${discovered} flights, ${violations} violating`);
    }
  }

  console.log('');
  console.log('--- Summary ---');
  console.log(`Total flights found (since last sync): ${totalFlights}`);
  console.log(`Total violating flights: ${totalViolations}`);
  console.log('Results are persisted to cache; refresh fr24.html to see them in the table.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
