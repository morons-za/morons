#!/usr/bin/env node
/**
 * Daily digest: emails subscribers a summary of TMNP violations detected
 * for a given day (default: yesterday in Africa/Johannesburg timezone).
 *
 * Usage:
 *   node API/daily-digest.cjs              # yesterday's violations
 *   node API/daily-digest.cjs 2026-01-29   # specific date
 *   node API/daily-digest.cjs --dry-run    # print email without sending
 *
 * Reads:
 *   API/credentials.json       – SENDGRID_API_KEY
 *   API/digest-config.json     – from, subscribers[], siteUrl, timezone
 *   API/cache/fr24-violations/ – violation results per flight
 *   API/cache/fr24-flight-meta/– registration + timestamps per flight
 *   backend/scripts/helicopters.json – owner lookup
 *
 * Writes:
 *   API/cache/digest-state.json – tracks last digest date sent
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const CONFIG_PATH = path.join(ROOT, 'digest-config.json');
const VIOLATIONS_DIR = path.join(ROOT, 'cache', 'fr24-violations');
const FLIGHT_META_DIR = path.join(ROOT, 'cache', 'fr24-flight-meta');
const TRACK_META_DIR = path.join(ROOT, 'cache', 'fr24-track-meta');
const HELICOPTERS_PATH = path.join(ROOT, '..', 'backend', 'scripts', 'helicopters.json');
const DIGEST_STATE_PATH = path.join(ROOT, 'cache', 'digest-state.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonFile(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function readSendGridApiKey() {
  const json = readJsonFile(CREDENTIALS_PATH);
  if (!json) return null;
  return String(json?.SENDGRID_API_KEY || json?.sendgridApiKey || '').trim() || null;
}

function sendEmail({ apiKey, from, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [],
      tracking_settings: { open_tracking: { enable: true } }
    };
    if (text) payload.content.push({ type: 'text/plain', value: text });
    if (html) payload.content.push({ type: 'text/html', value: html });
    if (payload.content.length === 0) payload.content.push({ type: 'text/plain', value: '(no body)' });

    const body = JSON.stringify(payload);
    const req = https.request(
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
          const msgId = resp.headers['x-message-id'] || null;
          resolve({
            status: resp.statusCode || 0,
            messageId: msgId,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Date helpers (using Intl for timezone-aware local dates, no extra deps)
// ---------------------------------------------------------------------------

function localDateStr(dateObj, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dateObj);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

function yesterdayLocalDateStr(tz) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return localDateStr(yesterday, tz);
}

function flightDateStr(isoString, tz) {
  if (!isoString) return null;
  try {
    return localDateStr(new Date(isoString), tz);
  } catch {
    return null;
  }
}

function formatLocalTime(isoString, tz) {
  if (!isoString) return '—';
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(isoString));
  } catch {
    return '—';
  }
}

function formatLocalDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    return new Intl.DateTimeFormat('en-ZA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(d);
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Core: collect violations for a target date
// ---------------------------------------------------------------------------

function collectViolationsForDate(targetDate, tz) {
  let violationFiles;
  try {
    violationFiles = fs.readdirSync(VIOLATIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const helicopters = readJsonFile(HELICOPTERS_PATH) || {};
  const results = [];

  for (const f of violationFiles) {
    const flightId = f.replace(/\.json$/i, '');
    const v = readJsonFile(path.join(VIOLATIONS_DIR, f));
    if (!v || v.violation !== true) continue;

    const flightMeta = readJsonFile(path.join(FLIGHT_META_DIR, f));
    const trackMeta = readJsonFile(path.join(TRACK_META_DIR, f));

    const firstSeen = flightMeta?.first_seen || trackMeta?.first_seen || null;
    const lastSeen = flightMeta?.last_seen || trackMeta?.last_seen || null;
    const registration = flightMeta?.registration || null;

    const flightLocalDate = flightDateStr(firstSeen, tz) || flightDateStr(lastSeen, tz);
    if (flightLocalDate !== targetDate) continue;

    const owner = registration && helicopters[registration]
      ? helicopters[registration].owner || 'Unknown'
      : 'Unknown';

    results.push({
      flightId,
      registration: registration || '—',
      owner,
      firstSeen,
      lastSeen,
      reason: v.reason || '—'
    });
  }

  results.sort((a, b) => String(a.firstSeen || '').localeCompare(String(b.firstSeen || '')));
  return results;
}

// ---------------------------------------------------------------------------
// Email composition
// ---------------------------------------------------------------------------

function utmUrl(base, { campaign, content }) {
  if (!base) return '';
  const sep = base.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    utm_source: 'sendgrid',
    utm_medium: 'email',
    utm_campaign: campaign || 'daily_digest',
    ...(content ? { utm_content: content } : {})
  });
  return `${base}${sep}${params.toString()}`;
}

function composeDigest({ violations, targetDate, siteUrl }) {
  const dateDisplay = formatLocalDate(targetDate);
  const tz = 'Africa/Johannesburg';
  const count = violations.length;
  const campaign = `daily_digest_${targetDate}`;

  const siteLink = utmUrl(siteUrl, { campaign, content: 'cta_link' });

  const subject = `TMNP Daily Digest – ${count} violation${count === 1 ? '' : 's'} on ${dateDisplay}`;

  const rows = violations
    .map((v) => {
      const time = formatLocalTime(v.firstSeen, tz);
      return `  • ${v.registration} (${v.owner}) at ${time} SAST`;
    })
    .join('\n');

  const text = [
    `TMNP Helicopter Violation Digest – ${dateDisplay}`,
    '',
    `${count} violating flight${count === 1 ? '' : 's'} detected:`,
    '',
    rows,
    '',
    siteLink ? `View all violations: ${siteLink}` : '',
    '',
    '— Heli Map'
  ].join('\n');

  const htmlRows = violations
    .map((v) => {
      const time = formatLocalTime(v.firstSeen, tz);
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e0e0e0">${v.registration}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e0e0e0">${v.owner}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e0e0e0">${time} SAST</td>
      </tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 4px">TMNP Helicopter Violation Digest</h2>
  <p style="color:#666;margin:0 0 16px">${dateDisplay}</p>
  <p><strong>${count}</strong> violating flight${count === 1 ? '' : 's'} detected entering Table Mountain National Park restricted airspace.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead>
      <tr style="background:#f5f5f5;text-align:left">
        <th style="padding:8px 12px;border-bottom:2px solid #ccc">Registration</th>
        <th style="padding:8px 12px;border-bottom:2px solid #ccc">Operator</th>
        <th style="padding:8px 12px;border-bottom:2px solid #ccc">Time</th>
      </tr>
    </thead>
    <tbody>
      ${htmlRows}
    </tbody>
  </table>
  ${siteLink ? `<p><a href="${siteLink}" style="color:#1a73e8">View all violations on the map &rarr;</a></p>` : ''}
  <p style="color:#999;font-size:13px;margin-top:24px">&mdash; Heli Map &middot; Automated daily digest</p>
</body>
</html>`;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

  const config = readJsonFile(CONFIG_PATH);
  if (!config) {
    console.error('❌ Missing or invalid digest-config.json');
    process.exit(1);
  }

  const tz = config.timezone || 'Africa/Johannesburg';
  const targetDate = dateArg || yesterdayLocalDateStr(tz);
  const subscribers = config.subscribers || [];
  const fromAddr = config.from;
  const siteUrl = config.siteUrl || '';

  console.log(`📅 Target date: ${targetDate} (${tz})`);
  console.log(`📬 Subscribers: ${subscribers.length}`);

  // Check idempotency
  const state = readJsonFile(DIGEST_STATE_PATH) || {};
  if (!dryRun && state.lastDigestDate === targetDate) {
    console.log(`⏭️  Digest for ${targetDate} was already sent. Skipping. (Use --dry-run to preview anyway.)`);
    process.exit(0);
  }

  // Collect violations
  const violations = collectViolationsForDate(targetDate, tz);
  console.log(`🚁 Violations found: ${violations.length}`);

  if (violations.length === 0) {
    console.log('✅ No violations for this date. No email will be sent.');
    if (!dryRun) {
      writeJsonFile(DIGEST_STATE_PATH, {
        lastDigestDate: targetDate,
        lastRunAt: new Date().toISOString(),
        violationCount: 0,
        sent: false
      });
    }
    process.exit(0);
  }

  // Compose
  const { subject, text, html } = composeDigest({ violations, targetDate, siteUrl });

  if (dryRun) {
    console.log('\n--- DRY RUN (not sending) ---');
    console.log(`Subject: ${subject}`);
    console.log(`To: ${subscribers.join(', ')}`);
    console.log(`From: ${fromAddr}`);
    console.log('\n--- Plain text ---');
    console.log(text);
    console.log('\n--- HTML preview (first 500 chars) ---');
    console.log(html.slice(0, 500) + '…');
    process.exit(0);
  }

  // Send
  const apiKey = readSendGridApiKey();
  if (!apiKey) {
    console.error('❌ Missing SENDGRID_API_KEY in API/credentials.json');
    process.exit(1);
  }

  if (!fromAddr) {
    console.error('❌ Missing "from" in API/digest-config.json');
    process.exit(1);
  }

  const sendResults = [];
  for (const to of subscribers) {
    console.log(`📧 Sending to ${to}…`);
    try {
      const result = await sendEmail({ apiKey, from: fromAddr, to, subject, text, html });
      console.log(`   → ${result.status} ${result.messageId || '(no message id)'}`);
      sendResults.push({ to, status: result.status, messageId: result.messageId });
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
      sendResults.push({ to, status: 0, error: err.message });
    }
  }

  // Persist state
  writeJsonFile(DIGEST_STATE_PATH, {
    lastDigestDate: targetDate,
    lastRunAt: new Date().toISOString(),
    violationCount: violations.length,
    sent: true,
    sendResults
  });

  const ok = sendResults.filter((r) => r.status >= 200 && r.status < 300).length;
  const fail = sendResults.length - ok;
  console.log(`\n✅ Done. Sent: ${ok}, Failed: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
