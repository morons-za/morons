#!/usr/bin/env node
/**
 * Regenerate 2026 KML files that are missing entry/exit markers.
 * 
 * Requires the API server to be running (e.g. node API/server.cjs).
 * For each 2026 KML in backend/uploads/ that lacks "Entry 1",
 * re-downloads the KML from the server endpoint (which now includes
 * entry/exit point markers) and overwrites the old file.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4599';
const UPLOADS_DIR = path.join(__dirname, '..', 'backend', 'uploads');

function extractFlightId(filename) {
  const m = filename.match(/([a-f0-9]{8})\.kml$/);
  return m ? m[1] : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const allFiles = fs.readdirSync(UPLOADS_DIR)
    .filter(f => f.startsWith('2026-') && f.endsWith('.kml'))
    .sort();

  const toRegenerate = [];
  for (const f of allFiles) {
    const content = fs.readFileSync(path.join(UPLOADS_DIR, f), 'utf8');
    if (!content.includes('Entry 1')) {
      toRegenerate.push(f);
    }
  }

  console.log(`Found ${allFiles.length} total 2026 KMLs, ${toRegenerate.length} need regeneration.`);
  if (toRegenerate.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Verify server is reachable
  try {
    const resp = await fetch(`${BASE_URL}/api/fr24/status`, { signal: AbortSignal.timeout(10000) });
    const json = await resp.json();
    if (!json.ok) {
      console.error('Server not ready:', json);
      process.exitCode = 1;
      return;
    }
    console.log('Server OK.');
  } catch (e) {
    console.error(`Cannot reach server at ${BASE_URL}:`, e.message);
    console.error('Start the server first: PORT=4599 node API/server.cjs');
    process.exitCode = 1;
    return;
  }

  let success = 0;
  let failed = 0;
  const failedIds = [];

  for (let i = 0; i < toRegenerate.length; i++) {
    const filename = toRegenerate[i];
    const flightId = extractFlightId(filename);
    if (!flightId) {
      console.log(`[${i + 1}/${toRegenerate.length}] SKIP (no flight ID): ${filename}`);
      continue;
    }

    const pct = ((i + 1) / toRegenerate.length * 100).toFixed(1);
    process.stdout.write(`[${i + 1}/${toRegenerate.length}] (${pct}%) ${flightId}...`);

    try {
      const url = `${BASE_URL}/api/fr24/flight-tracks.kml?flight_id=${flightId}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(180000) });

      if (!resp.ok) {
        console.log(` HTTP ${resp.status}`);
        failed++;
        failedIds.push(flightId);
        continue;
      }

      const kml = await resp.text();
      if (!kml.includes('<kml')) {
        console.log(' INVALID (not KML)');
        failed++;
        failedIds.push(flightId);
        continue;
      }

      const hasMarkers = kml.includes('Entry 1');
      const outPath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(outPath, kml, 'utf8');
      console.log(hasMarkers ? ' OK (with markers)' : ' OK (no incursions detected)');
      success++;
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
      failed++;
      failedIds.push(flightId);
    }

    // Small delay to avoid hammering FR24 if tracks need fetching
    if (i < toRegenerate.length - 1) {
      await sleep(500);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`DONE. Success: ${success}, Failed: ${failed}, Total: ${toRegenerate.length}`);
  if (failedIds.length > 0) {
    console.log('Failed IDs:', failedIds.join(', '));
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exitCode = 1;
});
