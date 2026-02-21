#!/usr/bin/env node
/**
 * Build and send the daily review digest email via SendGrid.
 *
 * The email has two sections:
 *   1. Auto-published flights (clean violations added to the site)
 *   2. Flights pending manual review (with inline PNG, approve/reject buttons)
 *
 * Inline PNGs are CID-embedded as SendGrid attachments so they render
 * directly in the email body without external image loading.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const FLIGHT_MAPS_DIR = path.join(__dirname, '..', 'backend', 'flight-maps');

/**
 * Send an email via SendGrid v3 API with optional inline image attachments.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.from
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {object[]} [opts.attachments] - [{ content (base64), type, filename, content_id, disposition }]
 * @returns {Promise<{ status: number, body: string }>}
 */
function sendEmail({ apiKey, from, to, subject, html, attachments = [] }) {
  return new Promise((resolve, reject) => {
    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: 'text/html', value: html }],
      tracking_settings: { open_tracking: { enable: false } }
    };

    if (attachments.length > 0) {
      payload.attachments = attachments;
    }

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
          resolve({ status: resp.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Try to load a flight map PNG as a base64 string.
 * @param {string} filename - e.g. "2026-01-01-ZT-HOT-3dbad34d.kml"
 * @returns {string|null} base64 content or null
 */
function loadFlightPngBase64(filename) {
  const pngName = filename.replace('.kml', '.png');
  const pngPath = path.join(FLIGHT_MAPS_DIR, pngName);
  try {
    if (!fs.existsSync(pngPath)) return null;
    return fs.readFileSync(pngPath).toString('base64');
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the HTML for the daily review digest email.
 *
 * @param {object} opts
 * @param {object[]} opts.autoPublished - flights auto-added to the site
 * @param {object[]} opts.suspicious   - flights pending review (from pending-review.json)
 * @param {string}   opts.workerUrl    - Cloudflare Worker base URL
 * @param {string}   opts.siteUrl      - Static site URL for flight links
 * @returns {{ html: string, attachments: object[] }}
 */
function buildReviewDigestEmail({ autoPublished = [], suspicious = [], workerUrl, siteUrl = '' }) {
  const attachments = [];
  const date = new Date().toISOString().slice(0, 10);

  let html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 16px; color: #1a1a1a;">
<h1 style="font-size: 22px; border-bottom: 2px solid #0066cc; padding-bottom: 8px;">TMNP Flight Violation Report &mdash; ${escapeHtml(date)}</h1>
`;

  // Section 1: auto-published
  if (autoPublished.length > 0) {
    html += `
<h2 style="font-size: 17px; color: #006600; margin-top: 24px;">Auto-published flights (${autoPublished.length})</h2>
<p style="font-size: 14px; color: #555;">These flights passed the transponder gap check and have been added to the site automatically.</p>
<table style="width: 100%; border-collapse: collapse; font-size: 14px;">
  <tr style="background: #f0f0f0;">
    <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd;">Date</th>
    <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd;">Registration</th>
    <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd;">Incursions</th>
  </tr>`;
    for (const f of autoPublished) {
      html += `
  <tr>
    <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(f.date)}</td>
    <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(f.registration)}</td>
    <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(f.incursions ?? '?')}</td>
  </tr>`;
    }
    html += `</table>`;
  } else {
    html += `<p style="font-size: 14px; color: #888; margin-top: 24px;">No new clean violations detected today.</p>`;
  }

  // Section 2: suspicious / pending review
  if (suspicious.length > 0) {
    html += `
<h2 style="font-size: 17px; color: #cc6600; margin-top: 32px;">Flights pending your review (${suspicious.length})</h2>
<p style="font-size: 14px; color: #555;">These flights have transponder gaps that may produce false violation positives. Please review each one.</p>
`;
    for (let i = 0; i < suspicious.length; i++) {
      const f = suspicious[i];
      const cid = `flight-${f.flight_id}`;
      const pngBase64 = loadFlightPngBase64(f.filename);

      if (pngBase64) {
        attachments.push({
          content: pngBase64,
          type: 'image/png',
          filename: `${f.flight_id}.png`,
          content_id: cid,
          disposition: 'inline'
        });
      }

      const approveUrl = `${workerUrl}/review?id=${encodeURIComponent(f.flight_id)}&action=approve&token=${encodeURIComponent(f.approve_token)}&expires=${encodeURIComponent(f.approve_expires)}`;
      const rejectUrl = `${workerUrl}/review?id=${encodeURIComponent(f.flight_id)}&action=reject&token=${encodeURIComponent(f.reject_token)}&expires=${encodeURIComponent(f.reject_expires)}`;

      html += `
<div style="border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; background: #fafafa;">
  <h3 style="margin: 0 0 8px 0; font-size: 15px;">${escapeHtml(f.registration)} &mdash; ${escapeHtml(f.date)} &mdash; <code>${escapeHtml(f.flight_id)}</code></h3>
  <p style="font-size: 13px; color: #666; margin: 0 0 12px 0;">
    Flagged: ${escapeHtml(f.reason || 'transponder gap')} &bull;
    Max gap: ${f.maxGapKm != null ? f.maxGapKm + ' km' : 'unknown'}
  </p>
  ${pngBase64 ? `<img src="cid:${cid}" alt="Flight map" style="max-width: 100%; border-radius: 4px; margin-bottom: 12px;">` : '<p style="color: #999; font-style: italic;">Flight map image not available</p>'}
  <div style="margin-top: 12px;">
    <a href="${escapeHtml(approveUrl)}" style="display: inline-block; padding: 10px 24px; background: #006600; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; margin-right: 12px;">Approve &mdash; Violating Flight</a>
    <a href="${escapeHtml(rejectUrl)}" style="display: inline-block; padding: 10px 24px; background: #cc0000; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Reject &mdash; Not a Violation</a>
  </div>
</div>`;
    }
  } else if (autoPublished.length > 0) {
    html += `<p style="font-size: 14px; color: #888; margin-top: 24px;">No flights flagged for review today.</p>`;
  }

  // Footer
  html += `
<hr style="border: none; border-top: 1px solid #ddd; margin-top: 32px;">
<p style="font-size: 12px; color: #999; margin-top: 8px;">
  TMNP Helicopter Tracker &bull; ${escapeHtml(date)}
  ${siteUrl ? ` &bull; <a href="${escapeHtml(siteUrl)}" style="color: #999;">${escapeHtml(siteUrl)}</a>` : ''}
</p>
</body></html>`;

  return { html, attachments };
}

/**
 * Send the daily review digest.
 *
 * @param {object} opts
 * @param {string} opts.apiKey      - SendGrid API key
 * @param {string} opts.from        - sender email
 * @param {string} opts.to          - recipient email
 * @param {object[]} opts.autoPublished
 * @param {object[]} opts.suspicious
 * @param {string} opts.workerUrl
 * @param {string} [opts.siteUrl]
 * @returns {Promise<{ status: number, body: string }>}
 */
async function sendReviewDigest({ apiKey, from, to, autoPublished, suspicious, workerUrl, siteUrl }) {
  const totalFlights = autoPublished.length + suspicious.length;
  if (totalFlights === 0) return { status: 0, body: 'nothing-to-send' };

  const { html, attachments } = buildReviewDigestEmail({ autoPublished, suspicious, workerUrl, siteUrl });
  const date = new Date().toISOString().slice(0, 10);
  const subject = suspicious.length > 0
    ? `[Review needed] ${suspicious.length} flight(s) pending — ${date}`
    : `${autoPublished.length} new violation(s) published — ${date}`;

  return sendEmail({ apiKey, from, to, subject, html, attachments });
}

module.exports = { sendEmail, buildReviewDigestEmail, sendReviewDigest, loadFlightPngBase64 };
