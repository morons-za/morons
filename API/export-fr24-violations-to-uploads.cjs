#!/usr/bin/env node
/**
 * Export FR24 violating flights as KMLs into backend/uploads/.
 *
 * What it does:
 * - Queries FR24 flight-summary via the local API proxy (server.cjs) for a given month/range + registrations
 * - Computes TMNP violations (tracks) via the proxy (cached + rate-limited)
 * - Downloads KML for ONLY violating flights and writes:
 *     backend/uploads/YYYY-MM-DD-REG-<fr24_id>.kml
 *
 * Usage:
 *   # Start the API proxy first (in another terminal):
 *   #   PORT=4607 FR24_TRACK_MIN_INTERVAL_MS=6500 FR24_VIOLATIONS_LOOP_DELAY_MS=6500 node API/server.cjs
 *
 *   # Export Jan 2026 violations for multiple aircraft:
 *   node API/export-fr24-violations-to-uploads.cjs --base http://localhost:4607 --month 2026-01 --reg ZTRPG,ZSRLC,ZTRUM,ZSHGD
 *
 * Notes:
 * - This script writes to backend/uploads/ (tracked in git).
 * - It does NOT touch static-site/kml-optimised/; run your normal optimize/build step after.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = process.env.BASE_URL || 'http://localhost:4599';
const UPLOADS_DIR = path.join(__dirname, '..', 'backend', 'uploads');

function usage(exitCode = 1) {
  console.log(
    [
      'Usage:',
      '  node API/export-fr24-violations-to-uploads.cjs --reg <REG[,REG...]> (--month YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD) [--base URL]',
      '',
      'Examples:',
      '  node API/export-fr24-violations-to-uploads.cjs --base http://localhost:4607 --month 2026-01 --reg ZTRPG,ZSRLC,ZTRUM,ZSHGD',
      ''
    ].join('\n')
  );
  process.exitCode = exitCode;
}

function normalizeRegistrationDisplay(input) {
  // Accept: "ZS-HGD" or "ZSHGD" and normalize to "ZS-HGD" for filenames.
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return '';
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{2}[A-Z0-9]{3}$/.test(compact)) return `${compact.slice(0, 2)}-${compact.slice(2)}`;
  return raw;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toFr24Utc(dt) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}:${pad2(
    dt.getUTCMinutes()
  )}:${pad2(dt.getUTCSeconds())}`;
}

function startOfUtcDay(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function parseYmd(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function monthRange(monthStr) {
  const [yStr, mStr] = String(monthStr || '').split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  // Cap at now (so running mid-month doesn't go into future)
  const now = new Date();
  const cappedEndExclusive = new Date(Math.min(endExclusive.getTime(), now.getTime()));
  return { start, endExclusive: cappedEndExclusive };
}

function* windows14Days(range) {
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  let cursor = range.start.getTime();
  const end = range.endExclusive.getTime();
  while (cursor < end) {
    const wEnd = Math.min(cursor + fourteenDaysMs - 1000, end - 1000);
    yield { from: toFr24Utc(new Date(cursor)), to: toFr24Utc(new Date(wEnd)) };
    cursor = wEnd + 1000;
  }
}

async function fetchJson(url, { method = 'GET', body } = {}, timeoutMs = 180000) {
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

async function fetchKml(url, timeoutMs = 180000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    if (!resp.ok) {
      return { ok: false, status: resp.status, statusText: resp.statusText, body: text };
    }
    return { ok: true, body: text };
  } finally {
    clearTimeout(t);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeId8(fr24Id) {
  const s = String(fr24Id || '').trim().toLowerCase();
  return /^[a-f0-9]{8}$/.test(s) ? s : null;
}

function isoToYmd(iso) {
  const s = String(iso || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function parseArgs(argv) {
  const out = {
    base: DEFAULT_BASE,
    regs: [],
    month: null,
    from: null,
    to: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').trim();
    else if (a === '--reg' || a === '--regs') out.regs.push(String(argv[++i] || '').trim());
    else if (a === '--month') out.month = String(argv[++i] || '').trim();
    else if (a === '--from') out.from = String(argv[++i] || '').trim();
    else if (a === '--to') out.to = String(argv[++i] || '').trim();
    else if (a === '--help' || a === '-h') out.help = true;
    else out.unknown = (out.unknown || []).concat(a);
  }
  out.regs = out.regs
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage(0);
  if (args.unknown?.length) {
    console.error('Unknown args:', args.unknown.join(' '));
    return usage(2);
  }
  if (!args.regs.length) {
    console.error('Missing --reg');
    return usage(2);
  }
  if (!args.month && (!args.from || !args.to)) {
    console.error('Missing --month or --from/--to');
    return usage(2);
  }

  const range = (() => {
    if (args.month) return monthRange(args.month);
    const f = parseYmd(args.from);
    const t = parseYmd(args.to);
    if (!f || !t) return null;
    const start = startOfUtcDay(f.y, f.m, f.d);
    const endExclusive = startOfUtcDay(t.y, t.m, t.d + 1);
    const now = new Date();
    return { start, endExclusive: new Date(Math.min(endExclusive.getTime(), now.getTime())) };
  })();
  if (!range) {
    console.error('Invalid date range.');
    return usage(2);
  }

  ensureDir(UPLOADS_DIR);

  // Sanity check API server + FR24 token.
  const status = await fetchJson(`${args.base}/api/fr24/status`, {}, 20000);
  if (!status.ok) {
    console.error('[export] Server not ready or FR24 auth failed:', status);
    process.exitCode = 2;
    return;
  }

  const regs = args.regs.map(normalizeRegistrationDisplay);
  console.log(`[export] Base: ${args.base}`);
  console.log(`[export] Aircraft: ${regs.join(', ')}`);
  console.log(`[export] Range: ${toFr24Utc(range.start)} → ${toFr24Utc(new Date(range.endExclusive.getTime() - 1000))}`);
  console.log(`[export] Output: ${UPLOADS_DIR}`);

  // 1) Collect flights for the range (per-aircraft, windowed)
  const flightsById = new Map(); // fr24_id -> { fr24_id, registration, first_seen, last_seen }
  for (const w of windows14Days(range)) {
    console.log(`[export] flight-summary window ${w.from} → ${w.to}`);
    for (const reg of regs) {
      const json = await fetchJson(`${args.base}/api/fr24/flight-summary/light`, {
        method: 'POST',
        body: {
          registrations: reg,
          flight_datetime_from: w.from,
          flight_datetime_to: w.to,
          limit: 5000
        }
      }, 120000);

      if (!json.ok) {
        console.error(`[export] flight-summary failed for ${reg}:`, json);
        process.exitCode = 3;
        return;
      }

      const data = Array.isArray(json?.response?.data) ? json.response.data : [];
      console.log(`[export]  ${reg}: ${data.length} flight(s)`);
      for (const f of data) {
        const fr24_id = String(f?.fr24_id || '').trim();
        if (!fr24_id) continue;
        flightsById.set(fr24_id, {
          fr24_id,
          registration: normalizeRegistrationDisplay(f?.registration || reg),
          first_seen: f?.first_seen || null,
          last_seen: f?.last_seen || null
        });
      }
    }
  }

  const allIds = Array.from(flightsById.keys());
  console.log(`[export] Total flights discovered: ${allIds.length}`);
  if (allIds.length === 0) return;

  // 2) Compute violations (cached)
  console.log('[export] Computing TMNP violations (cached + paced)…');
  const viol = await fetchJson(`${args.base}/api/fr24/violations`, {
    method: 'POST',
    body: { flight_ids: allIds }
  }, 60 * 60 * 1000);

  if (!viol.ok) {
    console.error('[export] violations failed:', viol);
    process.exitCode = 4;
    return;
  }

  const results = Array.isArray(viol.results) ? viol.results : [];
  const violating = results.filter((r) => r?.violation === true).map((r) => String(r.flight_id || '').trim()).filter(Boolean);
  const rateLimited = results.filter((r) => String(r?.reason || '') === 'track-http-429').length;
  console.log(`[export] Violations: ${violating.length} yes (rate-limited: ${rateLimited}/${results.length})`);

  if (violating.length === 0) return;

  // 3) Download KMLs for violating flights and write to backend/uploads/
  let written = 0;
  let skipped = 0;

  for (const id of violating) {
    const id8 = safeId8(id);
    if (!id8) {
      console.warn(`[export] Skipping non-8-hex flight id: ${id}`);
      continue;
    }
    const meta = flightsById.get(id) || { registration: 'UNKNOWN', first_seen: null, last_seen: null };
    const ymd = isoToYmd(meta.first_seen) || isoToYmd(meta.last_seen) || 'UNKNOWN-DATE';
    const reg = normalizeRegistrationDisplay(meta.registration) || 'UNKNOWN';
    const outName = `${ymd}-${reg}-${id8}.kml`;
    const outPath = path.join(UPLOADS_DIR, outName);

    if (fs.existsSync(outPath)) {
      skipped++;
      continue;
    }

    const kmlUrl = `${args.base}/api/fr24/flight-tracks.kml?flight_id=${encodeURIComponent(id8)}`;
    const kml = await fetchKml(kmlUrl, 10 * 60 * 1000);
    if (!kml.ok) {
      console.error(`[export] Failed to fetch KML for ${id8}:`, kml);
      process.exitCode = 5;
      return;
    }

    fs.writeFileSync(outPath, kml.body, 'utf8');
    written++;
  }

  console.log(`[export] Done. Wrote ${written} KML(s). Skipped existing: ${skipped}.`);
  console.log('[export] Next: run your normal optimize/build flow to generate -opt.kml files and update metadata.');
}

main().catch((e) => {
  console.error('[export] fatal:', e);
  process.exitCode = 1;
});

