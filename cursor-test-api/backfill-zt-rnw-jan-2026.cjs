#!/usr/bin/env node
/**
 * Backfill: ZT-RNW flights for January 2026, compute TMNP violations, write to disk cache.
 *
 * This script talks to the local proxy server (server.cjs) so we reuse:
 * - FR24 auth (credentials.json)
 * - pacing / retry / caching
 * - TMNP violation logic
 *
 * Run with a dedicated server port (recommended):
 *   PORT=4600 FR24_TRACK_MIN_INTERVAL_MS=6500 FR24_VIOLATIONS_LOOP_DELAY_MS=6500 node cursor-test-api/server.cjs
 *   node cursor-test-api/backfill-zt-rnw-jan-2026.cjs
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:4600';
const REG = 'ZT-RNW';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    if (json && typeof json === 'object') {
      json._http = { httpStatus: resp.status, httpStatusText: resp.statusText, url };
      if (!resp.ok && !('status' in json)) {
        json.status = resp.status;
        json.statusText = resp.statusText;
      }
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toFr24Utc(dt) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`;
}

function* windowsJan2026() {
  // FR24 Flight Summary max is 14 days per request.
  const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  // Don’t query into the future; cap at "today" (UTC midnight).
  const monthEndExclusive = new Date(Date.UTC(2026, 1, 1, 0, 0, 0));
  const now = new Date();
  const todayUtcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const endExclusive = new Date(Math.min(monthEndExclusive.getTime(), todayUtcStart.getTime()));
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  let cursor = start.getTime();
  while (cursor < endExclusive.getTime()) {
    const wEnd = Math.min(cursor + fourteenDaysMs - 1000, endExclusive.getTime() - 1000);
    yield {
      from: toFr24Utc(new Date(cursor)),
      to: toFr24Utc(new Date(wEnd))
    };
    cursor = wEnd + 1000;
  }
}

async function main() {
  console.log(`[backfill] Base: ${BASE_URL}`);
  console.log(`[backfill] Registration: ${REG}`);

  // Quick sanity check that server is up.
  const status = await fetchJson(`${BASE_URL}/api/fr24/status`, {}, 20000);
  if (!status.ok) {
    console.error('[backfill] Server not ready or FR24 auth failed:', status);
    process.exitCode = 2;
    return;
  }

  const allIds = new Set();

  for (const w of windowsJan2026()) {
    console.log(`[backfill] flight-summary window ${w.from} → ${w.to}`);
    const json = await fetchJson(`${BASE_URL}/api/fr24/flight-summary/light`, {
      method: 'POST',
      body: {
        registrations: REG,
        flight_datetime_from: w.from,
        flight_datetime_to: w.to,
        limit: 5000
      }
    }, 120000);

    if (!json.ok) {
      console.error('[backfill] flight-summary failed:', json);
      process.exitCode = 3;
      return;
    }

    const flights = Array.isArray(json?.response?.data) ? json.response.data : [];
    console.log(`[backfill]  found ${flights.length} flights in window`);
    for (const f of flights) {
      const id = String(f?.fr24_id || '').trim();
      if (id) allIds.add(id);
    }

    // Tiny pause between summary calls (these are cheap, but keep it polite).
    await sleep(250);
  }

  const ids = Array.from(allIds);
  console.log(`[backfill] Total unique Jan 2026 flights: ${ids.length}`);
  if (ids.length === 0) return;

  // One call; server will:
  // - skip already-cached violations
  // - fetch tracks with pacing/retry
  // - compute + persist violations
  console.log('[backfill] Computing violations (this can take a few minutes)…');
  const viol = await fetchJson(`${BASE_URL}/api/fr24/violations`, {
    method: 'POST',
    body: { flight_ids: ids }
  }, 30 * 60 * 1000);

  if (!viol.ok) {
    console.error('[backfill] violations failed:', viol);
    process.exitCode = 4;
    return;
  }

  const results = Array.isArray(viol.results) ? viol.results : [];
  const yes = results.filter((r) => r.violation === true).length;
  const no = results.filter((r) => r.violation === false).length;
  const unk = results.length - yes - no;
  const rateLimited = results.filter((r) => String(r?.reason || '') === 'track-http-429').length;
  console.log(`[backfill] Done. TMNP: ${yes} yes, ${no} no, ${unk} unknown. rate-limited: ${rateLimited}/${results.length}`);
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exitCode = 1;
});

