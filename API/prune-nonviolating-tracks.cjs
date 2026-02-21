#!/usr/bin/env node
/**
 * Option A: Keep the "No" (violation=false) verdict, but delete the heavy track blobs.
 *
 * Deletes (for each flight where violation=false):
 * - API/cache/fr24-tracks/<flight>.json
 * - API/cache/fr24-track-meta/<flight>.json
 *
 * Keeps:
 * - API/cache/fr24-violations/<flight>.json (so we don't re-check and burn quota)
 * - API/cache/fr24-flight-meta/<flight>.json (for listing / timestamps)
 * - API/cache/fr24-sync-state/*
 *
 * Usage:
 *   node API/prune-nonviolating-tracks.cjs --dry-run
 *   node API/prune-nonviolating-tracks.cjs --apply
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, 'cache');
const VIOL_DIR = path.join(CACHE_DIR, 'fr24-violations');
const TRACKS_DIR = path.join(CACHE_DIR, 'fr24-tracks');
const TRACK_META_DIR = path.join(CACHE_DIR, 'fr24-track-meta');

function safeFileKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 200);
}

function readJsonIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function statSize(p) {
  try {
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  } catch {
    return 0;
  }
}

function unlinkIfExists(p) {
  try {
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function parseArgs(argv) {
  const out = { dryRun: false, apply: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage(exitCode = 1) {
  console.log('Usage:');
  console.log('  node API/prune-nonviolating-tracks.cjs --dry-run');
  console.log('  node API/prune-nonviolating-tracks.cjs --apply');
  process.exitCode = exitCode;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.dryRun && !args.apply) || (args.dryRun && args.apply)) return usage(0);

  if (!fs.existsSync(VIOL_DIR)) {
    console.log(`[prune] No violations dir found at ${VIOL_DIR}`);
    return;
  }

  const files = fs.readdirSync(VIOL_DIR).filter((f) => f.endsWith('.json'));
  let candidates = 0;
  let deletedTracks = 0;
  let deletedTrackMeta = 0;
  let bytesTracks = 0;
  let bytesTrackMeta = 0;

  for (const fn of files) {
    const p = path.join(VIOL_DIR, fn);
    const j = readJsonIfExists(p);
    if (!j || typeof j !== 'object') continue;
    if (j.violation !== false) continue;

    candidates++;
    const flightId = fn.replace(/\.json$/, '');
    const key = safeFileKey(flightId);
    const trackPath = path.join(TRACKS_DIR, `${key}.json`);
    const metaPath = path.join(TRACK_META_DIR, `${key}.json`);

    bytesTracks += statSize(trackPath);
    bytesTrackMeta += statSize(metaPath);

    if (args.apply) {
      if (unlinkIfExists(trackPath)) deletedTracks++;
      if (unlinkIfExists(metaPath)) deletedTrackMeta++;
    }
  }

  console.log(`[prune] Candidates (violation=false): ${candidates}`);
  console.log(`[prune] Track bytes to remove: ${formatBytes(bytesTracks)}`);
  console.log(`[prune] Track-meta bytes to remove: ${formatBytes(bytesTrackMeta)}`);

  if (args.apply) {
    console.log(`[prune] Deleted tracks: ${deletedTracks}`);
    console.log(`[prune] Deleted track-meta: ${deletedTrackMeta}`);
  } else {
    console.log('[prune] Dry-run only (no files deleted).');
  }
}

main().catch((e) => {
  console.error('[prune] fatal:', e);
  process.exitCode = 1;
});

