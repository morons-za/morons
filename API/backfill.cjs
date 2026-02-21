#!/usr/bin/env node
/**
 * Generic FR24 backfill helper.
 *
 * Examples:
 *   # Jan 2026, flight list + TMNP violations (tracks)
 *   PORT=4607 FR24_TRACK_MIN_INTERVAL_MS=6500 FR24_VIOLATIONS_LOOP_DELAY_MS=6500 node API/server.cjs
 *   node API/backfill.cjs --base http://localhost:4607 --month 2026-01 --reg ZS-HIE,ZS-HBO --violations
 *
 *   # List-only (fast)
 *   node API/backfill.cjs --base http://localhost:4607 --from 2026-01-01 --to 2026-01-31 --reg ZS-HIE --list
 */

const DEFAULT_BASE = process.env.BASE_URL || 'http://localhost:4599';
// FR24 flight-summary can also be rate-limited. This sets a minimum spacing (ms)
// between summary calls to avoid 429s when backfilling many registrations.
const FR24_SUMMARY_MIN_INTERVAL_MS = Number(process.env.FR24_SUMMARY_MIN_INTERVAL_MS || 0);
let lastFr24SummaryRequestAtMs = 0;

function usage(exitCode = 1) {
  console.log(
    [
      'Usage:',
      '  node API/backfill.cjs --reg <REG[,REG...]> (--month YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD) [--base URL] [--violations] [--list] [--batch-size N]',
      '',
      'Notes:',
      '  - --list runs only flight-summary (fast).',
      '  - --violations fetches tracks and computes TMNP violations (slow; rate-limited).',
      '  - --batch-size only affects violations; default 25 (to avoid long-running HTTP timeouts).',
      ''
    ].join('\n')
  );
  process.exitCode = exitCode;
}

function normalizeRegistration(input) {
  // Accept: "ZS-HMB" or "ZSHMB" and normalize to "ZS-HMB".
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return '';
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{2}[A-Z0-9]{3}$/.test(compact)) {
    return `${compact.slice(0, 2)}-${compact.slice(2)}`;
  }
  return raw;
}

function parseArgs(argv) {
  const out = {
    base: DEFAULT_BASE,
    regs: [],
    month: null,
    from: null,
    to: null,
    list: false,
    violations: false,
    batchSize: 25
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').trim();
    else if (a === '--reg' || a === '--regs') out.regs.push(String(argv[++i] || '').trim());
    else if (a === '--month') out.month = String(argv[++i] || '').trim();
    else if (a === '--from') out.from = String(argv[++i] || '').trim();
    else if (a === '--to') out.to = String(argv[++i] || '').trim();
    else if (a === '--list') out.list = true;
    else if (a === '--violations') out.violations = true;
    else if (a === '--batch-size') out.batchSize = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else out.unknown = (out.unknown || []).concat(a);
  }

  out.regs = out.regs
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  return out;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function paceSummaryCalls() {
  if (!FR24_SUMMARY_MIN_INTERVAL_MS) return;
  const now = Date.now();
  const nextAt = lastFr24SummaryRequestAtMs + FR24_SUMMARY_MIN_INTERVAL_MS;
  if (now < nextAt) await sleep(nextAt - now);
}

function parseRetryAfterMs(headers) {
  const h = headers && typeof headers === 'object' ? headers : null;
  const ra = h ? (h['retry-after'] || h['Retry-After'] || h['RETRY-AFTER']) : null;
  const s = ra == null ? '' : String(ra).trim();
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return Math.min(10 * 60 * 1000, Math.max(0, Math.floor(n * 1000)));
  return 0;
}

async function fetchFlightSummaryWithRetry(base, body, { maxAttempts = 8 } = {}) {
  let attempt = 0;
  let backoffMs = 1000;
  while (attempt < maxAttempts) {
    attempt++;
    await paceSummaryCalls();
    lastFr24SummaryRequestAtMs = Date.now();

    const json = await fetchJson(
      `${base}/api/fr24/flight-summary/light`,
      { method: 'POST', body },
      120000
    );

    if (json && json.ok) return json;

    const status = Number(json?.status || json?._http?.httpStatus || 0);
    const retryAfterMs = parseRetryAfterMs(json?.headers);
    const isRetryable = status === 429 || (status >= 500 && status < 600);
    if (!isRetryable || attempt >= maxAttempts) return json;

    const waitMs = retryAfterMs || backoffMs;
    const jitter = Math.floor(Math.random() * 250);
    console.warn(
      `[backfill] flight-summary retryable error (status ${status || 'unknown'}), attempt ${attempt}/${maxAttempts}; waiting ${Math.round((waitMs + jitter) / 1000)}s…`
    );
    await sleep(waitMs + jitter);
    backoffMs = Math.min(60 * 1000, Math.floor(backoffMs * 1.8));
  }
  return { ok: false, error: 'flight-summary retry loop exhausted' };
}

function toFr24Utc(dt) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`;
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

async function fetchJson(url, { method = 'GET', body } = {}, timeoutMs = 120000) {
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  if (!args.list && !args.violations) {
    // Default to list-only unless explicitly asked to compute violations.
    args.list = true;
  }
  // Violations require flight IDs; always collect the list first.
  if (args.violations && !args.list) {
    args.list = true;
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) {
    console.error('Invalid --batch-size (expected positive number).');
    return usage(2);
  }
  args.batchSize = Math.max(1, Math.min(200, Math.floor(args.batchSize)));
  args.regs = args.regs.map(normalizeRegistration);

  const range = (() => {
    if (args.month) return monthRange(args.month);
    const f = parseYmd(args.from);
    const t = parseYmd(args.to);
    if (!f || !t) return null;
    const start = startOfUtcDay(f.y, f.m, f.d);
    // to is inclusive day; make endExclusive = next day 00:00:00, cap at now
    const endExclusive = startOfUtcDay(t.y, t.m, t.d + 1);
    const now = new Date();
    return { start, endExclusive: new Date(Math.min(endExclusive.getTime(), now.getTime())) };
  })();

  if (!range || !Number.isFinite(range.start.getTime()) || !Number.isFinite(range.endExclusive.getTime())) {
    console.error('Invalid date range.');
    return usage(2);
  }

  console.log(`[backfill] Base: ${args.base}`);
  console.log(`[backfill] Aircraft: ${args.regs.join(', ')}`);
  console.log(`[backfill] Range: ${toFr24Utc(range.start)} → ${toFr24Utc(new Date(range.endExclusive.getTime() - 1000))}`);
  console.log(`[backfill] Modes: ${args.list ? 'list' : ''}${args.list && args.violations ? '+' : ''}${args.violations ? 'violations' : ''}`);

  // Sanity check auth/server.
  const status = await fetchJson(`${args.base}/api/fr24/status`, {}, 20000);
  if (!status.ok) {
    console.error('[backfill] Server not ready or FR24 auth failed:', status);
    process.exitCode = 2;
    return;
  }

  const idsByReg = new Map();
  for (const reg of args.regs) idsByReg.set(reg, new Set());

  if (args.list) {
    for (const w of windows14Days(range)) {
      console.log(`[backfill] flight-summary window ${w.from} → ${w.to}`);
      for (const reg of args.regs) {
        const json = await fetchFlightSummaryWithRetry(
          args.base,
          {
            registrations: reg,
            flight_datetime_from: w.from,
            flight_datetime_to: w.to,
            limit: 5000
          },
          { maxAttempts: 8 }
        );

        if (!json.ok) {
          console.error(`[backfill] flight-summary failed for ${reg}:`, json);
          process.exitCode = 3;
          return;
        }

        const flights = Array.isArray(json?.response?.data) ? json.response.data : [];
        console.log(`[backfill]  ${reg}: ${flights.length} flights`);
        for (const f of flights) {
          const id = String(f?.fr24_id || '').trim();
          if (id) idsByReg.get(reg).add(id);
        }

        // Polite spacing between summary calls (in addition to FR24_SUMMARY_MIN_INTERVAL_MS pacing).
        await sleep(200);
      }
    }
  }

  if (args.violations) {
    // Batch requests (server will cache/skip already-computed flights).
    const allIds = new Set();
    for (const s of idsByReg.values()) for (const id of s) allIds.add(id);
    const ids = Array.from(allIds);
    console.log(`[backfill] Total unique flights across regs: ${ids.length}`);
    if (ids.length === 0) return;

    console.log(`[backfill] Computing violations in batches of ${args.batchSize} (slow)…`);
    const allResults = [];
    for (let i = 0; i < ids.length; i += args.batchSize) {
      const batch = ids.slice(i, i + args.batchSize);
      console.log(`[backfill]  violations batch ${Math.floor(i / args.batchSize) + 1}/${Math.ceil(ids.length / args.batchSize)} (${batch.length} flights)`);
      const viol = await fetchJson(
        `${args.base}/api/fr24/violations`,
        { method: 'POST', body: { flight_ids: batch } },
        30 * 60 * 1000
      );

      if (!viol.ok) {
        console.error('[backfill] violations failed:', viol);
        process.exitCode = 4;
        return;
      }

      const results = Array.isArray(viol.results) ? viol.results : [];
      allResults.push(...results);
    }

    const yes = allResults.filter((r) => r.violation === true).length;
    const no = allResults.filter((r) => r.violation === false).length;
    const unk = allResults.length - yes - no;
    const rateLimited = allResults.filter((r) => String(r?.reason || '') === 'track-http-429').length;
    console.log(`[backfill] Done. TMNP: ${yes} yes, ${no} no, ${unk} unknown. rate-limited: ${rateLimited}/${allResults.length}`);
  } else {
    for (const [reg, set] of idsByReg.entries()) {
      console.log(`[backfill] ${reg}: ${set.size} unique flights (list-only)`);
    }
  }
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exitCode = 1;
});

