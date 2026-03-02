#!/usr/bin/env node
/**
 * Daily flight sync pipeline.
 *
 * Orchestrates the full flow:
 *   1. Start server.cjs as a child process (for FR24 API + violation detection)
 *   2. Query FR24 for flights in the last N hours for tracked registrations
 *   3. Compute TMNP violations
 *   4. For each violating flight:
 *      a. Run transponder gap check
 *      b. Clean flights  -> download KML, generate PNG, optimise KML, add to static site
 *      c. Suspicious     -> download KML, generate PNG, add to pending-review.json
 *   5. Send SendGrid email digest
 *   6. Stop child server
 *
 * Designed to run as a GitHub Action on a daily cron, or manually.
 *
 * Usage:
 *   node API/daily-sync.cjs [--hours 48] [--dry-run] [--skip-email]
 *
 * Environment variables (or API/credentials.json):
 *   FR24_TOKEN, SENDGRID_API_KEY, HMAC_SECRET
 *
 * Config: API/review-config.json (copy from review-config.example.json)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { analyseTrackForGaps, analyseKmlForGaps, classifyViolation } = require('./detect-transponder-gaps.cjs');
const { addPendingFlight, readPendingReview } = require('./pending-review.cjs');
const { sendReviewDigest } = require('./review-email.cjs');

const UPLOADS_DIR = path.join(__dirname, '..', 'backend', 'uploads');
const OPTIMISED_DIR = path.join(__dirname, '..', 'static-site', 'kml-optimised');
const FLIGHT_MAPS_DIR = path.join(__dirname, '..', 'backend', 'flight-maps');
const CONFIG_PATH = path.join(__dirname, 'review-config.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

const SERVER_PORT = 4698;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function getSecret(name) {
  return process.env[name] || loadCredentials()[name] || '';
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toFr24Utc(dt) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`;
}

function isoToYmd(iso) {
  const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function isoToHHMM(iso) {
  const m = String(iso || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function normalizeReg(input) {
  const raw = String(input || '').trim().toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{2}[A-Z0-9]{3}$/.test(compact)) return `${compact.slice(0, 2)}-${compact.slice(2)}`;
  return raw;
}

function safeId8(id) {
  const s = String(id || '').trim().toLowerCase();
  return /^[a-f0-9]{8}$/.test(s) ? s : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    try { return JSON.parse(text); } catch { return { ok: false, error: 'non-json', raw: text }; }
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, timeoutMs = 180000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, body: text };
  } finally {
    clearTimeout(t);
  }
}

function* windows14Days(start, endExclusive) {
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  let cursor = start.getTime();
  const end = endExclusive.getTime();
  while (cursor < end) {
    const wEnd = Math.min(cursor + fourteenDaysMs - 1000, end - 1000);
    yield { from: toFr24Utc(new Date(cursor)), to: toFr24Utc(new Date(wEnd)) };
    cursor = wEnd + 1000;
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'server.cjs');
    const child = spawn('node', [serverPath], {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        FR24_TRACK_MIN_INTERVAL_MS: '6500',
        FR24_VIOLATIONS_LOOP_DELAY_MS: '6500'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Server startup timeout'));
    }, 30000);

    child.stdout.on('data', (data) => {
      const line = data.toString();
      if (!started && line.includes('API server running')) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on('data', (data) => {
      if (!started) process.stderr.write(`[server] ${data}`);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code} before starting`));
      }
    });

    // Fallback: poll for readiness
    const poll = setInterval(async () => {
      try {
        const resp = await fetch(`${BASE_URL}/api/fr24/status`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok && !started) {
          started = true;
          clearTimeout(timeout);
          clearInterval(poll);
          resolve(child);
        }
      } catch {}
    }, 2000);

    // Clear poll on timeout/error
    setTimeout(() => clearInterval(poll), 30000);
  });
}

function parseArgs(argv) {
  const out = { hours: 48, dryRun: false, skipEmail: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hours') out.hours = Number(argv[++i]) || 48;
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--skip-email') out.skipEmail = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('[sync] Missing or invalid API/review-config.json');
    console.error('        Copy API/review-config.example.json to API/review-config.json and set review_email.');
    process.exitCode = 1;
    return;
  }
  const hmacSecret = getSecret('HMAC_SECRET');
  const sendgridKey = getSecret('SENDGRID_API_KEY');

  if (!hmacSecret) {
    console.error('[sync] Missing HMAC_SECRET in env or credentials.json');
    process.exitCode = 1;
    return;
  }

  const regs = config.tracked_registrations.map(normalizeReg);
  const now = new Date();
  const lookbackMs = args.hours * 60 * 60 * 1000;
  const rangeStart = new Date(now.getTime() - lookbackMs);

  console.log(`[sync] Starting daily sync`);
  console.log(`[sync] Lookback: ${args.hours}h (${toFr24Utc(rangeStart)} to ${toFr24Utc(now)})`);
  console.log(`[sync] Registrations: ${regs.join(', ')}`);
  if (args.dryRun) console.log('[sync] DRY RUN — no files will be written');

  // Step 1: Start server
  console.log('[sync] Starting API server...');
  let serverProcess;
  try {
    serverProcess = await startServer();
    console.log('[sync] Server ready.');
  } catch (err) {
    console.error('[sync] Failed to start server:', err.message);
    process.exitCode = 2;
    return;
  }

  try {
    // Step 2: Discover flights
    const flightsById = new Map();
    for (const w of windows14Days(rangeStart, now)) {
      for (const reg of regs) {
        const json = await fetchJson(`${BASE_URL}/api/fr24/flight-summary/light`, {
          method: 'POST',
          body: { registrations: reg, flight_datetime_from: w.from, flight_datetime_to: w.to, limit: 5000 }
        }, 120000);

        if (!json.ok) {
          console.error(`[sync] flight-summary failed for ${reg}:`, json.error || json);
          continue;
        }

        const data = Array.isArray(json?.response?.data) ? json.response.data : [];
        for (const f of data) {
          const fr24_id = String(f?.fr24_id || '').trim();
          if (!fr24_id) continue;
          flightsById.set(fr24_id, {
            fr24_id,
            registration: normalizeReg(f?.registration || reg),
            first_seen: f?.first_seen || null,
            last_seen: f?.last_seen || null
          });
        }
      }
    }

    const allIds = Array.from(flightsById.keys());
    console.log(`[sync] Discovered ${allIds.length} flight(s)`);
    if (allIds.length === 0) {
      console.log('[sync] No flights found, done.');
      return;
    }

    // Step 3: Compute violations
    console.log('[sync] Computing violations...');
    const viol = await fetchJson(`${BASE_URL}/api/fr24/violations`, {
      method: 'POST',
      body: { flight_ids: allIds }
    }, 60 * 60 * 1000);

    if (!viol.ok) {
      console.error('[sync] Violations endpoint failed:', viol);
      process.exitCode = 3;
      return;
    }

    const results = Array.isArray(viol.results) ? viol.results : [];
    const violationById = new Map(
      results.map((r) => [String(r?.flight_id || '').trim(), r])
    );
    const violatingIds = results
      .filter((r) => r?.violation === true)
      .map((r) => String(r.flight_id || '').trim())
      .filter(Boolean);
    console.log(`[sync] Violating: ${violatingIds.length} / ${allIds.length}`);
    if (violatingIds.length === 0) {
      console.log('[sync] No violations found, done.');
      return;
    }

    // Step 4: Process each violating flight
    const autoPublished = [];
    const suspicious = [];
    const existingUploads = new Set(fs.readdirSync(UPLOADS_DIR));

    for (const id of violatingIds) {
      const id8 = safeId8(id);
      if (!id8) continue;
      const meta = flightsById.get(id) || {};
      const ymd = isoToYmd(meta.first_seen) || isoToYmd(meta.last_seen) || 'UNKNOWN';
      const hhmm = isoToHHMM(meta.first_seen) || isoToHHMM(meta.last_seen) || '00:00';
      const reg = normalizeReg(meta.registration) || 'UNKNOWN';
      const filename = `${ymd}-${reg}-${id8}.kml`;

      // Skip if already in uploads
      if (existingUploads.has(filename)) continue;

      // Also skip if already in pending review
      const pending = readPendingReview();
      if (pending.pending.some((f) => f.flight_id === id8)) continue;
      if (pending.decisions.some((d) => d.flight_id === id8)) continue;

      // Fetch track data for gap analysis
      const trackJson = await fetchJson(`${BASE_URL}/api/fr24/flight-tracks?flight_id=${id8}`, {}, 120000);
      const trackResponse = trackJson?.response || trackJson;

      const gapOpts = {
        thresholdKm: config.transponder_gap_threshold_km,
        ratioThreshold: config.transponder_gap_ratio
      };
      let gapResult = analyseTrackForGaps(trackResponse, gapOpts);

      // If FR24 API returned no tracks, fall back to analysing the KML file
      if (gapResult.noTrackData) {
        console.log(`[sync] No FR24 track data for ${id8}, falling back to KML-based gap analysis`);
        const kmlUrl = `${BASE_URL}/api/fr24/flight-tracks.kml?flight_id=${id8}`;
        const kml = await fetchText(kmlUrl, 10 * 60 * 1000);
        if (kml.ok && kml.body) {
          gapResult = analyseKmlForGaps(kml.body, gapOpts);
          if (gapResult.noTrackData) {
            console.log(`[sync] KML also has no coordinates for ${id8} — flagging for review`);
          }
        }
      }

      // Classify: 'clean', 'mixed', 'gap_only', or 'no_track_data'
      let classification = 'clean';
      if (gapResult.noTrackData) {
        classification = 'no_track_data';
      } else if (gapResult.suspicious) {
        const cv = classifyViolation(trackResponse, gapResult, gapOpts);
        classification = cv.classification;
      }

      const flightInfo = {
        flight_id: id8,
        filename,
        registration: reg,
        date: ymd,
        time: hhmm,
        incursions: Number.isFinite(Number(violationById.get(id)?.incursions))
          ? Number(violationById.get(id).incursions)
          : null,
        classification,
        maxGapKm: gapResult.maxGapKm,
        avgSegmentKm: gapResult.avgSegmentKm,
        totalSegments: gapResult.totalSegments,
        gapCount: gapResult.gaps.length
      };

      const needsReview = classification === 'gap_only' || classification === 'no_track_data';

      if (args.dryRun) {
        console.log(`[sync] [DRY] ${id8} ${reg} ${ymd} — ${classification.toUpperCase()} (max gap: ${gapResult.maxGapKm} km)`);
        (needsReview ? suspicious : autoPublished).push(flightInfo);
        continue;
      }

      // Download KML (may already have been fetched for fallback analysis)
      const kmlUrl = `${BASE_URL}/api/fr24/flight-tracks.kml?flight_id=${id8}`;
      const kml = await fetchText(kmlUrl, 10 * 60 * 1000);
      if (!kml.ok) {
        console.error(`[sync] Failed to download KML for ${id8}: HTTP ${kml.status}`);
        continue;
      }

      const kmlPath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(kmlPath, kml.body, 'utf8');

      // Generate PNG
      try {
        const { execSync } = require('child_process');
        execSync(`node backend/scripts/generate-flight-image.cjs "${filename}"`, {
          cwd: path.join(__dirname, '..'),
          stdio: 'pipe',
          timeout: 120000
        });
      } catch (e) {
        console.warn(`[sync] PNG generation failed for ${id8}: ${e.message}`);
      }

      if (needsReview) {
        const reason = classification === 'no_track_data' ? 'no_track_data' : 'gap_only_violation';
        console.log(`[sync] ${classification.toUpperCase()} ${id8} ${reg} ${ymd} — max gap: ${gapResult.maxGapKm} km → pending review`);
        const pendingEntry = addPendingFlight({
          ...flightInfo,
          reason
        }, hmacSecret, config.token_expiry_days);
        // Use the persisted pending entry so email links have valid tokens/expires.
        suspicious.push(pendingEntry || { ...flightInfo, reason });
      } else {
        console.log(`[sync] ${classification === 'mixed' ? 'MIXED' : 'CLEAN'} ${id8} ${reg} ${ymd} — publishing (real violations on non-gap segments)`);
        autoPublished.push(flightInfo);
      }

      await sleep(500);
    }

    // Step 5: Run optimiser for all new KMLs (clean + suspicious; suspicious need it ready for when approved)
    const totalWritten = autoPublished.length + suspicious.length;
    if (totalWritten > 0 && !args.dryRun) {
      console.log(`[sync] Running KML optimiser...`);
      const { execSync } = require('child_process');
      try {
        execSync('python3 backend/scripts/optimise_kml.py', {
          cwd: path.join(__dirname, '..'),
          stdio: 'pipe',
          timeout: 120000
        });
      } catch (e) {
        console.warn(`[sync] Optimiser warning: ${e.message}`);
      }
    }

    // Step 6: Incrementally update metadata for auto-published flights
    if (autoPublished.length > 0 && !args.dryRun) {
      console.log('[sync] Updating metadata (incremental)...');
      try {
        const { updateMasterMetadataIncremental } = require('../backend/scripts/generate-master-metadata-main.cjs');
        const flightRecords = autoPublished.map(f => ({
          filename: f.filename,
          registration: f.registration,
          date: f.date,
          time: f.time || '00:00'
        }));
        await updateMasterMetadataIncremental(null, { flightRecords });

        const srcMeta = path.join(__dirname, '..', 'backend', 'scripts', 'master-metadata.json');
        const dstMeta = path.join(__dirname, '..', 'static-site', 'master-metadata.json');
        if (fs.existsSync(srcMeta)) {
          fs.copyFileSync(srcMeta, dstMeta);
          console.log('[sync] Copied master-metadata.json to static-site/');
        }
      } catch (e) {
        console.warn(`[sync] Metadata update warning: ${e.message}`);
      }
    }

    // Step 7: Send email digest
    const totalNew = autoPublished.length + suspicious.length;
    console.log(`[sync] Summary: ${autoPublished.length} auto-published, ${suspicious.length} pending review, ${totalNew} total new`);

    if (totalNew > 0 && !args.skipEmail && !args.dryRun && sendgridKey && config.review_email) {
      console.log('[sync] Sending email digest...');
      try {
        const result = await sendReviewDigest({
          apiKey: sendgridKey,
          from: config.from_email,
          to: config.review_email,
          autoPublished,
          suspicious,
          workerUrl: config.cloudflare_worker_url,
          siteUrl: config.site_url || 'https://morons.org.za'
        });
        console.log(`[sync] Email sent: HTTP ${result.status}`);
      } catch (e) {
        console.error(`[sync] Email failed: ${e.message}`);
      }
    } else if (totalNew > 0 && (args.skipEmail || args.dryRun)) {
      console.log('[sync] Skipping email (--skip-email or --dry-run)');
    }

    console.log('[sync] Done.');

  } finally {
    if (serverProcess) {
      console.log('[sync] Stopping server...');
      serverProcess.kill('SIGTERM');
      await sleep(1000);
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
    }
  }
}

main().catch((e) => {
  console.error('[sync] Fatal:', e);
  process.exitCode = 1;
});
