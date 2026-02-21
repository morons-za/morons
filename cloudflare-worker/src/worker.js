/**
 * Cloudflare Worker: Heli Review
 *
 * Handles one-click approve/reject actions from email links.
 *
 * Flow:
 *   1. User clicks link in email  -> GET /review?id=...&action=...&token=...&expires=...
 *   2. Worker validates HMAC token
 *   3. Worker triggers GitHub Actions `repository_dispatch` event
 *   4. Worker returns a confirmation HTML page
 *
 * Environment bindings (set in wrangler.toml or via `wrangler secret put`):
 *   HMAC_SECRET, GITHUB_TOKEN, GITHUB_REPO, GITHUB_WORKFLOW_FILE
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/review') {
      return handleReview(url, env);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleReview(url, env) {
  const flightId = url.searchParams.get('id');
  const action = url.searchParams.get('action');
  const token = url.searchParams.get('token');
  const expires = url.searchParams.get('expires');

  if (!flightId || !action || !token || !expires) {
    return errorPage('Missing parameters', 'The review link is incomplete. Please use the full link from the email.');
  }

  if (action !== 'approve' && action !== 'reject') {
    return errorPage('Invalid action', 'The action must be "approve" or "reject".');
  }

  if (new Date(expires) < new Date()) {
    return errorPage('Link expired', 'This review link has expired. Please check for a newer email or contact the admin.');
  }

  const valid = await validateHmac(flightId, action, token, expires, env.HMAC_SECRET);
  if (!valid) {
    return errorPage('Invalid token', 'The review link could not be verified. It may have been tampered with.');
  }

  try {
    await triggerGithubAction(flightId, action, env);
  } catch (err) {
    return errorPage('Processing error', `Failed to process your review: ${err.message}`);
  }

  return successPage(flightId, action);
}

async function validateHmac(flightId, action, token, expires, secret) {
  const encoder = new TextEncoder();
  const payload = `${flightId}:${action}:${expires}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = arrayBufferToHex(signature);

  return timingSafeEqual(token, expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function triggerGithubAction(flightId, action, env) {
  const resp = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'heli-review-worker',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      event_type: 'review_decision',
      client_payload: {
        flight_id: flightId,
        action: action,
        decided_at: new Date().toISOString()
      }
    })
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub API returned ${resp.status}: ${body}`);
  }
}

function successPage(flightId, action) {
  const actionLabel = action === 'approve' ? 'Approved as violation' : 'Rejected — not a violation';
  const color = action === 'approve' ? '#006600' : '#cc0000';
  const icon = action === 'approve' ? '&#10003;' : '&#10007;';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review Recorded</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #1a1a1a; }
  .card { background: white; border-radius: 12px; padding: 40px; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.1); max-width: 420px; }
  .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .flight-id { font-family: monospace; background: #f0f0f0; padding: 4px 12px; border-radius: 4px; font-size: 14px; }
  .action { color: ${color}; font-weight: bold; margin-top: 12px; font-size: 16px; }
  .note { font-size: 13px; color: #888; margin-top: 20px; }
</style></head>
<body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>Review Recorded</h1>
  <p>Flight <span class="flight-id">${escapeHtml(flightId)}</span></p>
  <p class="action">${escapeHtml(actionLabel)}</p>
  <p class="note">Your decision has been submitted and will be processed shortly. You can close this page.</p>
</div>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function errorPage(title, message) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #1a1a1a; }
  .card { background: white; border-radius: 12px; padding: 40px; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.1); max-width: 420px; }
  .icon { font-size: 48px; color: #cc0000; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .msg { color: #555; font-size: 14px; }
</style></head>
<body>
<div class="card">
  <div class="icon">&#9888;</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="msg">${escapeHtml(message)}</p>
</div>
</body></html>`;

  return new Response(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
