/**
 * Cloudflare Worker: Review + Admin
 *
 * Existing:
 *   - One-click review actions via signed links.
 *
 * Added:
 *   - Admin area protected with username + password.
 *   - Read-only admin summary API built from GitHub Actions + repo JSON state.
 */

const COOKIE_NAME = 'heli_admin_session';
const MAX_AUDIT_ENTRIES = 40;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);

    if (pathname === '/review') {
      return handleReview(url, env);
    }

    if (pathname === '/admin') {
      return handleAdminHome(request, env);
    }
    if (pathname === '/admin/login' && request.method === 'POST') {
      return handleAdminLogin(request, env);
    }
    if (pathname === '/admin/logout' && request.method === 'POST') {
      return handleAdminLogout();
    }
    if (pathname === '/admin/api/summary') {
      return handleAdminSummary(request, env);
    }
    if (pathname === '/admin/api/decide' && request.method === 'POST') {
      return handleAdminDecide(request, env);
    }
    if (pathname === '/admin/sendgrid-events' && request.method === 'POST') {
      return handleAdminSendgridEvents(request, env);
    }

    if (pathname === '/health') {
      return jsonResponse({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleReview(url, env) {
  const flightId = (url.searchParams.get('id') || '').trim();
  const action = (url.searchParams.get('action') || '').trim();
  const token = (url.searchParams.get('token') || '').trim();
  const expires = (url.searchParams.get('expires') || '').trim();

  if (!flightId || !action || !token || !expires) {
    return errorPage('Missing parameters', 'The review link is incomplete. Please use the full link from the email.');
  }

  if (action !== 'approve' && action !== 'reject') {
    return errorPage('Invalid action', 'The action must be "approve" or "reject".');
  }

  if (new Date(expires) < new Date()) {
    return errorPage('Link expired', 'This review link has expired. Please check for a newer email or contact the admin.');
  }

  const valid = await validateHmac(`${flightId}:${action}:${expires}`, token, env.HMAC_SECRET);
  if (!valid) {
    return errorPage('Invalid token', 'The review link could not be verified. It may have been tampered with.');
  }

  try {
    await triggerGithubDispatch('review_decision', {
      flight_id: flightId,
      action,
      decided_at: new Date().toISOString()
    }, env);
  } catch (err) {
    return errorPage('Processing error', `Failed to process your review: ${err.message}`);
  }

  return reviewSuccessPage(flightId, action);
}

async function handleAdminHome(request, env) {
  const config = getAdminConfig(env);
  if (!config.ready.ok) {
    return htmlResponse(adminLoginPage(`Admin setup required: ${config.ready.message}`), 200);
  }

  const session = await readAdminSession(request, env);
  if (!session.ok) {
    return htmlResponse(adminLoginPage());
  }
  return htmlResponse(adminDashboardPage(session.email));
}

async function handleAdminLogin(request, env) {
  const config = getAdminConfig(env);
  const body = await parseBody(request);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!config.ready.ok) {
    return htmlResponse(adminLoginPage(config.ready.message), 400);
  }
  if (!username || !password) {
    return htmlResponse(adminLoginPage('Enter username and password.'), 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env, username, ip);
  if (!rl.ok) {
    await appendAudit(env, {
      type: 'admin_login_rate_limited',
      username,
      reason: rl.reason || 'rate_limited',
      ipHash: shortHash(ip)
    });
    return htmlResponse(adminLoginPage('Too many attempts. Please wait a few minutes.'), 429);
  }

  await appendAudit(env, {
    type: 'admin_login_attempt',
    username,
    ipHash: shortHash(ip)
  });

  const validUsername = username === config.adminUsername;
  const validPassword = validUsername ? await verifyPassword(password, config.passwordHash) : false;

  if (!validUsername || !validPassword) {
    const fail = await recordAuthFailure(env, username, ip);
    await appendAudit(env, {
      type: 'admin_login_failed',
      username,
      lockApplied: Boolean(fail.lockApplied),
      ipHash: shortHash(ip)
    });
    return htmlResponse(adminLoginPage('Invalid login credentials.'), 401);
  }

  await clearAuthFailure(env, username, ip);

  const sessionExpiresMs = Date.now() + config.sessionHours * 60 * 60 * 1000;
  const sessionNonce = randomHex(12);
  const sessionSig = await hmacHex(`sess:${config.adminUsername}:${sessionExpiresMs}:${sessionNonce}`, config.signingSecret);
  const sessionToken = base64UrlEncode(JSON.stringify({
    e: config.adminUsername,
    x: sessionExpiresMs,
    n: sessionNonce,
    s: sessionSig
  }));

  await appendAudit(env, { type: 'admin_login_success', username: config.adminUsername, expiresAt: new Date(sessionExpiresMs).toISOString() });

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Set-Cookie': serializeCookie(COOKIE_NAME, sessionToken, {
        maxAge: config.sessionHours * 60 * 60,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict'
      })
    }
  });
}

async function handleAdminLogout() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Set-Cookie': serializeCookie(COOKIE_NAME, '', {
        maxAge: 0,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict'
      })
    }
  });
}

async function handleAdminSummary(request, env) {
  const session = await readAdminSession(request, env);
  if (!session.ok) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const summary = await buildAdminSummary(env);
    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Approve/reject from the dashboard, authenticated by the admin session
// cookie instead of the per-flight HMAC token used by /review. Those tokens
// are short-lived (token_expiry_days, currently 7) because an email link is
// a bearer credential anyone who has it can use — that constraint doesn't
// apply to an action taken from an already-authenticated admin session, so
// this path has no expiry and works on backlog items of any age.
async function handleAdminDecide(request, env) {
  const config = getAdminConfig(env);
  if (!config.ready.ok) {
    return jsonResponse({ ok: false, error: 'not_configured' }, 503);
  }

  const session = await readAdminSession(request, env);
  if (!session.ok) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await parseBody(request);
  const flightId = String(body.flight_id || '').trim();
  const action = String(body.action || '').trim();
  // 'suspicious' is admin-dashboard-only (not offered via the public token
  // link in handleReview) — it's a judgment call, not something to expose
  // as a bearer-token action anyone with an old email could trigger.
  const validActions = ['approve', 'reject', 'suspicious'];

  if (!flightId || !validActions.includes(action)) {
    return jsonResponse({ ok: false, error: 'invalid_request' }, 400);
  }

  try {
    await triggerGithubDispatch('review_decision', {
      flight_id: flightId,
      action,
      decided_at: new Date().toISOString(),
      decided_by: 'admin_dashboard'
    }, env);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 502);
  }

  await appendAudit(env, { type: 'admin_review_decision', flightId, action, email: session.email });

  return jsonResponse({ ok: true, flightId, action });
}

async function handleAdminSendgridEvents(request, env) {
  const sharedSecret = String(env.SENDGRID_EVENT_SECRET || '');
  if (sharedSecret) {
    const url = new URL(request.url);
    const headerSecret = String(request.headers.get('x-admin-webhook-secret') || '');
    const auth = String(request.headers.get('authorization') || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const querySecret = String(url.searchParams.get('secret') || '');
    const provided = headerSecret || bearer || querySecret;
    if (!timingSafeEqual(provided, sharedSecret)) {
      await appendAudit(env, { type: 'sendgrid_event_rejected', reason: 'bad_secret' });
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    await appendAudit(env, { type: 'sendgrid_event_rejected', reason: 'invalid_json' });
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const events = Array.isArray(payload) ? payload : [payload];
  const accepted = events.slice(0, 50);
  for (const evt of accepted) {
    await appendAudit(env, {
      type: 'sendgrid_event',
      event: String(evt?.event || ''),
      email: String(evt?.email || ''),
      sgMessageId: String(evt?.sg_message_id || evt?.sgMessageId || ''),
      sgEventId: String(evt?.sg_event_id || evt?.sgEventId || ''),
      reason: String(evt?.reason || ''),
      status: String(evt?.status || ''),
      response: String(evt?.response || ''),
      attempt: Number(evt?.attempt || 0),
      timestamp: Number(evt?.timestamp || 0),
      requestId: String(evt?.request_id || evt?.requestId || evt?.custom_args?.request_id || '')
    });
  }

  return jsonResponse({ ok: true, accepted: accepted.length });
}

async function buildAdminSummary(env) {
  const repo = env.GITHUB_REPO || 'morons-za/morons';
  const workflowFile = 'daily-sync.yml';
  const processWorkflow = 'process-decisions.yml';

  const [defaultLookback, dailyRuns, processRuns, pendingReview, digestState, staticMeta, backendMeta, auditLog] =
    await Promise.all([
      fetchDailyDefaultLookback(repo, env),
      fetchWorkflowRuns(repo, workflowFile, env, 8),
      fetchWorkflowRuns(repo, processWorkflow, env, 8).catch(() => []),
      fetchRepoJson(repo, 'static-site/pending-review.json', env, { pending: [], decisions: [] }),
      fetchRepoJson(repo, 'API/cache/digest-state.json', env, null),
      fetchRepoJson(repo, 'static-site/master-metadata.json', env, { flights: [] }),
      fetchRepoJson(repo, 'backend/scripts/master-metadata.json', env, { flights: [] }),
      readAuditLog(env)
    ]);

  const latestRun = dailyRuns[0] || null;
  const pending = Array.isArray(pendingReview?.pending) ? pendingReview.pending : [];
  const decisions = Array.isArray(pendingReview?.decisions) ? pendingReview.decisions : [];
  const reviewEmails = Array.isArray(digestState?.sendResults) ? digestState.sendResults : [];
  const reportEmails = []; // future feature

  const staticFlights = Array.isArray(staticMeta?.flights) ? staticMeta.flights : [];
  const backendFlights = Array.isArray(backendMeta?.flights) ? backendMeta.flights : [];
  const recentDateThreshold = isoDayDaysAgo(14);
  const recentFlights = staticFlights.filter((f) => String(f?.date || '') >= recentDateThreshold);
  const missingTimeRecent = recentFlights.filter((f) => {
    const t = String(f?.time || '').trim();
    return !t || t === '00:00';
  });

  return {
    generatedAt: new Date().toISOString(),
    auth: { sessionEmail: null }, // intentionally omitted in response body for cache safety
    jobHealth: {
      lookbackHoursDefault: defaultLookback,
      lastRun: latestRun ? simplifyRun(latestRun) : null,
      recentRuns: dailyRuns.map(simplifyRun),
      processDecisionRuns: processRuns.map(simplifyRun)
    },
    emailActivity: {
      reviewEmailsSent: reviewEmails.length,
      reviewEmails: reviewEmails.slice(0, 20),
      reportEmailsSent: reportEmails.length,
      reportEmails
    },
    falsePositives: {
      pendingCount: pending.length,
      decisionCount: decisions.length,
      pending: pending.slice(0, 50),
      decisions: decisions.slice(0, 50)
    },
    dataIntegrity: {
      staticFlightCount: staticFlights.length,
      backendFlightCount: backendFlights.length,
      metadataDrift: staticFlights.length - backendFlights.length,
      recentWindowDays: 14,
      recentFlightCount: recentFlights.length,
      missingTimeRecentCount: missingTimeRecent.length,
      missingTimeRecentRate: recentFlights.length ? Number((missingTimeRecent.length / recentFlights.length).toFixed(4)) : 0
    },
    alerts: buildAlerts({ latestRun, pending, staticFlights, backendFlights, missingTimeRecent, recentFlights, digestState }),
    auditLog
  };
}

function buildAlerts({ latestRun, pending, staticFlights, backendFlights, missingTimeRecent, recentFlights, digestState }) {
  const alerts = [];

  if (latestRun && latestRun.conclusion !== 'success') {
    alerts.push({
      severity: 'high',
      code: 'workflow_failure',
      message: `Latest daily sync run is ${latestRun.conclusion}`
    });
  }
  if (Math.abs(staticFlights.length - backendFlights.length) > 0) {
    alerts.push({
      severity: 'medium',
      code: 'metadata_drift',
      message: `Metadata count mismatch (static=${staticFlights.length}, backend=${backendFlights.length})`
    });
  }
  if (recentFlights.length > 0 && missingTimeRecent.length > 0) {
    alerts.push({
      severity: 'medium',
      code: 'missing_times_recent',
      message: `${missingTimeRecent.length} recent flights have missing/00:00 times`
    });
  }
  const sent = Boolean(digestState?.sent);
  if (digestState && !sent) {
    alerts.push({
      severity: 'low',
      code: 'digest_not_sent',
      message: 'Latest digest-state indicates no email was sent'
    });
  }
  if (pending.length > 0) {
    alerts.push({
      severity: 'low',
      code: 'pending_review_items',
      message: `${pending.length} flights awaiting review decisions`
    });
  }
  return alerts;
}

function getAdminConfig(env) {
  const adminUsername = String(env.ADMIN_USERNAME || 'admin').toLowerCase();
  const signingSecret = String(env.ADMIN_LOGIN_SECRET || env.HMAC_SECRET || '');
  const passwordHash = String(env.ADMIN_PASSWORD_HASH || '');
  const sessionHours = clampInt(env.ADMIN_SESSION_HOURS, 8, 1, 24);

  if (!signingSecret) {
    return { ready: { ok: false, message: 'ADMIN_LOGIN_SECRET (or HMAC_SECRET) is required.' } };
  }
  if (!passwordHash) {
    return { ready: { ok: false, message: 'ADMIN_PASSWORD_HASH is required.' } };
  }
  if (!env.ADMIN_RATE_KV || !env.ADMIN_AUDIT_KV) {
    return {
      ready: {
        ok: false,
        message: 'ADMIN_RATE_KV and ADMIN_AUDIT_KV bindings are required.'
      }
    };
  }

  return {
    ready: { ok: true },
    adminUsername,
    signingSecret,
    passwordHash,
    sessionHours
  };
}

async function readAdminSession(request, env) {
  const config = getAdminConfig(env);
  if (!config.ready.ok) return { ok: false, reason: 'not_configured' };

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const raw = cookies[COOKIE_NAME];
  if (!raw) return { ok: false, reason: 'no_cookie' };

  let parsed;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    return { ok: false, reason: 'bad_cookie' };
  }

  const email = String(parsed?.e || '').toLowerCase();
  const expiresMs = Number(parsed?.x || 0);
  const nonce = String(parsed?.n || '');
  const sig = String(parsed?.s || '');
  if (!email || !nonce || !sig || !Number.isFinite(expiresMs)) {
    return { ok: false, reason: 'bad_cookie' };
  }
  if (email !== config.adminUsername) return { ok: false, reason: 'username_not_allowed' };
  if (Date.now() > expiresMs) return { ok: false, reason: 'expired' };

  const expected = await hmacHex(`sess:${email}:${expiresMs}:${nonce}`, config.signingSecret);
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: 'invalid_sig' };

  return { ok: true, email, expiresMs };
}

async function checkRateLimit(env, username, ip) {
  const userKeySafe = sanitizeRateKey(username || 'unknown');
  const ipKeySafe = sanitizeRateKey(ip || 'unknown');
  const userLockKey = `lock:user:${userKeySafe}`;
  const ipLockKey = `lock:ip:${ipKeySafe}`;
  if (await env.ADMIN_RATE_KV.get(userLockKey)) return { ok: false, reason: 'user_lock' };
  if (await env.ADMIN_RATE_KV.get(ipLockKey)) return { ok: false, reason: 'ip_lock' };

  const minute = Math.floor(Date.now() / 60000);
  const userKey = `rl:user:${userKeySafe}:${minute}`;
  const ipKey = `rl:ip:${ipKeySafe}:${minute}`;

  const userCount = Number((await env.ADMIN_RATE_KV.get(userKey)) || '0') + 1;
  const ipCount = Number((await env.ADMIN_RATE_KV.get(ipKey)) || '0') + 1;
  await env.ADMIN_RATE_KV.put(userKey, String(userCount), { expirationTtl: 120 });
  await env.ADMIN_RATE_KV.put(ipKey, String(ipCount), { expirationTtl: 120 });

  // Tight enough to curb abuse while still forgiving normal retries.
  if (userCount > 4 || ipCount > 10) return { ok: false, reason: 'burst_limit' };
  return { ok: true };
}

async function recordAuthFailure(env, username, ip) {
  const user = sanitizeRateKey(username || 'unknown');
  const ipSafe = sanitizeRateKey(ip || 'unknown');
  const userFailKey = `fail:user:${user}`;
  const ipFailKey = `fail:ip:${ipSafe}`;
  const userFails = Number((await env.ADMIN_RATE_KV.get(userFailKey)) || '0') + 1;
  const ipFails = Number((await env.ADMIN_RATE_KV.get(ipFailKey)) || '0') + 1;
  await env.ADMIN_RATE_KV.put(userFailKey, String(userFails), { expirationTtl: 1800 });
  await env.ADMIN_RATE_KV.put(ipFailKey, String(ipFails), { expirationTtl: 1800 });

  let lockApplied = false;
  if (userFails >= 5) {
    await env.ADMIN_RATE_KV.put(`lock:user:${user}`, '1', { expirationTtl: 600 });
    lockApplied = true;
  }
  if (ipFails >= 12) {
    await env.ADMIN_RATE_KV.put(`lock:ip:${ipSafe}`, '1', { expirationTtl: 600 });
    lockApplied = true;
  }
  return { lockApplied, userFails, ipFails };
}

async function clearAuthFailure(env, username, ip) {
  const user = sanitizeRateKey(username || 'unknown');
  const ipSafe = sanitizeRateKey(ip || 'unknown');
  await Promise.all([
    env.ADMIN_RATE_KV.delete(`fail:user:${user}`),
    env.ADMIN_RATE_KV.delete(`fail:ip:${ipSafe}`),
    env.ADMIN_RATE_KV.delete(`lock:user:${user}`),
    env.ADMIN_RATE_KV.delete(`lock:ip:${ipSafe}`)
  ]);
}

function sanitizeRateKey(raw) {
  return String(raw || 'unknown').toLowerCase().replace(/[^a-z0-9._@:-]/g, '_').slice(0, 128);
}

async function appendAudit(env, event) {
  if (!env.ADMIN_AUDIT_KV) return;
  const key = `audit:${Date.now()}:${randomHex(4)}`;
  const value = JSON.stringify({
    at: new Date().toISOString(),
    ...event
  });
  await env.ADMIN_AUDIT_KV.put(key, value, { expirationTtl: 60 * 60 * 24 * 30 });
}

async function readAuditLog(env) {
  if (!env.ADMIN_AUDIT_KV) return [];
  const listed = await env.ADMIN_AUDIT_KV.list({ prefix: 'audit:', limit: MAX_AUDIT_ENTRIES });
  const keys = (listed.keys || []).map((k) => k.name).sort().reverse();
  const entries = [];
  for (const key of keys) {
    const raw = await env.ADMIN_AUDIT_KV.get(key);
    if (!raw) continue;
    try {
      entries.push(JSON.parse(raw));
    } catch {
      entries.push({ at: null, type: 'unparseable_audit_entry' });
    }
  }
  return entries.slice(0, MAX_AUDIT_ENTRIES);
}

async function triggerGithubDispatch(eventType, clientPayload, env) {
  const resp = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({
      event_type: eventType,
      client_payload: clientPayload
    })
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub API returned ${resp.status}: ${body}`);
  }
}

async function fetchWorkflowRuns(repo, workflowFile, env, perPage = 8) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${perPage}`;
  // no-store: this is a Worker-to-GitHub subrequest, which Cloudflare's
  // edge can cache independently of any Cache-Control on our own response
  // to the browser — a hard refresh on the client does nothing about it.
  const resp = await fetch(url, { headers: githubHeaders(env), cache: 'no-store' });
  if (!resp.ok) throw new Error(`Failed to fetch workflow runs (${workflowFile}): ${resp.status}`);
  const json = await resp.json();
  return Array.isArray(json?.workflow_runs) ? json.workflow_runs : [];
}

async function fetchDailyDefaultLookback(repo, env) {
  const wf = await fetchRepoText(repo, '.github/workflows/daily-sync.yml', env, '');
  const m = wf.match(/hours:[\s\S]{0,160}?default:\s*'?(\\d+)'?/);
  return m ? Number(m[1]) : 48;
}

async function fetchRepoJson(repo, filePath, env, fallbackValue) {
  try {
    const text = await fetchRepoText(repo, filePath, env, null);
    if (text == null) return fallbackValue;
    return JSON.parse(text);
  } catch {
    return fallbackValue;
  }
}

async function fetchRepoText(repo, filePath, env, fallbackValue) {
  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  // no-store: see comment in fetchWorkflowRuns above — this is what was
  // making the dashboard show a flight as still pending after it had
  // already been correctly moved to `decisions` on GitHub.
  const resp = await fetch(url, { headers: githubHeaders(env), cache: 'no-store' });
  if (resp.status === 404) return fallbackValue;
  if (!resp.ok) throw new Error(`Failed to fetch ${filePath}: ${resp.status}`);
  const json = await resp.json();
  if (!json?.content) return fallbackValue;
  return atob(String(json.content).replace(/\n/g, ''));
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'heli-review-worker'
  };
}

function simplifyRun(run) {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    runNumber: run.run_number,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    runStartedAt: run.run_started_at,
    htmlUrl: run.html_url
  };
}

function adminLoginPage(note = '') {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Login</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#f5f5f5; margin:0; padding:24px; color:#111; }
    .card { max-width:560px; margin:48px auto; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:24px; }
    h1 { margin:0 0 8px; font-size:24px; }
    p { margin:6px 0; color:#374151; }
    input, button { width:100%; padding:12px; border-radius:8px; font-size:14px; }
    input { border:1px solid #d1d5db; margin-top:12px; box-sizing:border-box; }
    button { margin-top:12px; border:0; background:#2563eb; color:#fff; cursor:pointer; }
    .note { margin-top:14px; padding:10px; border-radius:8px; background:#eef2ff; color:#3730a3; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin sign in</h1>
    <p>Enter your username and password.</p>
    <form method="post" action="/admin/login">
      <input name="username" type="text" placeholder="username" autocomplete="username" required />
      <input name="password" type="password" placeholder="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
    ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}
  </div>
</body>
</html>`;
}

function adminDashboardPage(email) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Dashboard</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; background:#f8fafc; color:#0f172a; }
    .wrap { max-width:1100px; margin:0 auto; padding:20px; }
    .top { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .top h1 { margin:0; font-size:24px; }
    .chip { display:inline-block; padding:6px 10px; border-radius:999px; background:#e2e8f0; font-size:12px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin-top:16px; }
    .card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px; }
    .card h3 { margin:0 0 8px; font-size:14px; color:#334155; }
    .kpi { font-size:24px; font-weight:700; }
    table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
    th, td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; vertical-align:top; }
    code { background:#f1f5f9; padding:2px 4px; border-radius:4px; }
    .row { margin-top:14px; }
    .actions { display:flex; gap:8px; align-items:center; }
    .btn { border:1px solid #cbd5e1; background:#fff; border-radius:8px; padding:8px 12px; cursor:pointer; }
    .small { color:#475569; font-size:12px; }
    .sev-high { color:#991b1b; }
    .sev-medium { color:#92400e; }
    .sev-low { color:#1e3a8a; }
    .btn-sm { padding:6px 10px; font-size:12px; }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
    }
    .modal-card {
      width: min(760px, 100%);
      max-height: 95vh;
      overflow: auto;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
    }
    .modal-title { margin: 0; font-size: 18px; }
    .modal-subtitle { margin: 6px 0 0 0; color: #475569; font-size: 13px; }
    .modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .modal-kv { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
    .modal-kv .k { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .modal-kv .v { margin-top: 4px; font-size: 13px; color: #0f172a; word-break: break-word; }
    .modal-img-wrap { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; text-align: center; background: #f8fafc; }
    .modal-img { width: 100%; max-height: 360px; object-fit: contain; border-radius: 8px; }
    .modal-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .btn-approve { border-color: #166534; color: #166534; }
    .btn-reject { border-color: #991b1b; color: #991b1b; }
    .btn-suspicious { border-color: #92400e; color: #92400e; }
    .btn-disabled { opacity: 0.5; pointer-events: none; }
    @media (max-width: 760px) {
      .modal-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>Admin dashboard</h1>
        <div class="small">Signed in as <code>${escapeHtml(email)}</code></div>
      </div>
      <div class="actions">
        <button class="btn" onclick="load()">Refresh</button>
        <form method="post" action="/admin/logout"><button class="btn" type="submit">Logout</button></form>
      </div>
    </div>

    <div id="status" class="small row">Loading...</div>
    <div id="kpis" class="grid"></div>
    <div id="alerts" class="row"></div>
    <div id="runs" class="row"></div>
    <div id="emails" class="row"></div>
    <div id="review" class="row"></div>
    <div id="integrity" class="row"></div>
    <div id="audit" class="row"></div>
  </div>

  <div id="pendingModal" class="modal-backdrop" onclick="handleModalBackdrop(event)">
    <div class="modal-card">
      <div class="top">
        <div>
          <h2 class="modal-title">Pending review</h2>
          <p class="modal-subtitle">Mirror of email review card with action links.</p>
        </div>
        <button class="btn" onclick="closePendingModal()">Close</button>
      </div>
      <div class="modal-grid">
        <div class="modal-kv"><div class="k">Flight</div><div class="v"><code id="mFlightId">-</code></div></div>
        <div class="modal-kv"><div class="k">Registration</div><div class="v" id="mRegistration">-</div></div>
        <div class="modal-kv"><div class="k">Date</div><div class="v" id="mDate">-</div></div>
        <div class="modal-kv"><div class="k">Reason</div><div class="v" id="mReason">-</div></div>
        <div class="modal-kv"><div class="k">Max gap</div><div class="v" id="mGap">-</div></div>
        <div class="modal-kv"><div class="k">Detected</div><div class="v" id="mDetected">-</div></div>
      </div>
      <div class="modal-img-wrap">
        <img id="mImage" class="modal-img" alt="Flight map preview" />
        <div id="mNoImage" class="small" style="display:none;">Flight map image not available.</div>
      </div>
      <div class="modal-actions">
        <a id="mFr24" class="btn btn-sm" target="_blank" rel="noreferrer">View on FlightRadar24</a>
        <button id="mApprove" class="btn btn-sm btn-approve" type="button">Approve — Violating Flight</button>
        <button id="mReject" class="btn btn-sm btn-reject" type="button">Reject — Not a Violation</button>
        <button id="mSuspicious" class="btn btn-sm btn-suspicious" type="button">Suspicious — Possible Transponder Off</button>
      </div>
      <div id="mStatus" class="small" style="margin-top:8px; display:none;"></div>
    </div>
  </div>

  <script>
    let pendingCache = [];

    async function load() {
      const statusEl = document.getElementById('status');
      statusEl.textContent = 'Loading summary...';
      try {
        const resp = await fetch('/admin/api/summary', { credentials: 'same-origin' });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || ('HTTP ' + resp.status));
        render(data);
        statusEl.textContent = 'Updated at ' + new Date(data.generatedAt).toLocaleString();
      } catch (e) {
        statusEl.textContent = 'Failed to load summary: ' + e.message;
      }
    }

    function render(data) {
      const kpis = [
        ['Last run', data.jobHealth.lastRun ? (data.jobHealth.lastRun.conclusion || data.jobHealth.lastRun.status) : 'n/a'],
        ['Lookback default', String(data.jobHealth.lookbackHoursDefault) + 'h'],
        ['Pending reviews', String(data.falsePositives.pendingCount)],
        ['Review emails sent', String(data.emailActivity.reviewEmailsSent)],
        ['Flights (static)', String(data.dataIntegrity.staticFlightCount)],
        ['Missing recent times', String(data.dataIntegrity.missingTimeRecentCount)]
      ];
      document.getElementById('kpis').innerHTML = kpis.map(([label, value]) =>
        '<div class="card"><h3>' + esc(label) + '</h3><div class="kpi">' + esc(value) + '</div></div>').join('');

      document.getElementById('alerts').innerHTML = panel('Alerts', table(
        ['Severity', 'Code', 'Message'],
        (data.alerts || []).map(a => [
          '<span class="sev-' + esc((a.severity || 'low')) + '">' + esc(a.severity || 'low') + '</span>',
          esc(a.code || ''),
          esc(a.message || '')
        ])
      ));

      document.getElementById('runs').innerHTML = panel('Recent cron runs', table(
        ['Started', 'Event', 'Status', 'Conclusion', 'Link'],
        (data.jobHealth.recentRuns || []).map(r => [
          esc(r.runStartedAt || r.createdAt || ''),
          esc(r.event || ''),
          esc(r.status || ''),
          esc(r.conclusion || ''),
          r.htmlUrl ? '<a href="' + esc(r.htmlUrl) + '" target="_blank" rel="noreferrer">Open</a>' : '-'
        ])
      ));

      document.getElementById('emails').innerHTML = panel('Email activity', table(
        ['Recipient', 'Status', 'MessageId'],
        (data.emailActivity.reviewEmails || []).map(e => [
          esc(e.to || ''),
          esc(String(e.status || '')),
          esc(e.messageId || '')
        ])
      ));

      pendingCache = Array.isArray(data.falsePositives.pending) ? data.falsePositives.pending : [];
      document.getElementById('review').innerHTML = renderPendingReview(pendingCache);

      document.getElementById('integrity').innerHTML = panel('Data integrity', table(
        ['Metric', 'Value'],
        [
          ['Static flight count', data.dataIntegrity.staticFlightCount],
          ['Backend flight count', data.dataIntegrity.backendFlightCount],
          ['Metadata drift', data.dataIntegrity.metadataDrift],
          ['Recent window days', data.dataIntegrity.recentWindowDays],
          ['Recent flight count', data.dataIntegrity.recentFlightCount],
          ['Missing recent times', data.dataIntegrity.missingTimeRecentCount],
          ['Missing recent rate', data.dataIntegrity.missingTimeRecentRate]
        ].map(([m,v]) => [esc(String(m)), esc(String(v))])
      ));

      document.getElementById('audit').innerHTML = panel('Audit log', table(
        ['At', 'Type', 'Details'],
        (data.auditLog || []).map(a => [
          esc(a.at || ''),
          esc(a.type || ''),
          esc(JSON.stringify(a))
        ])
      ));
    }

    function panel(title, inner) {
      return '<div class="card"><h3>' + esc(title) + '</h3>' + inner + '</div>';
    }

    function table(headers, rows) {
      const h = '<tr>' + headers.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr>';
      const empty = new Array(headers.length).fill('-');
      const b = (rows.length ? rows : [empty]).map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('');
      return '<table>' + h + b + '</table>';
    }

    function renderPendingReview(items) {
      const rows = items.map((p, idx) => [
        '<code>' + esc(p.flight_id || '') + '</code>',
        esc(p.registration || ''),
        esc(p.reason || ''),
        esc(p.detected_at || p.created_at || ''),
        '<button class="btn btn-sm" onclick="openPendingModal(' + idx + ')">Review</button>'
      ]);
      return panel('Pending false positives', table(
        ['Flight', 'Registration', 'Reason', 'Detected', 'Action'],
        rows
      ));
    }

    function buildFr24Url(registration, flightId) {
      const reg = String(registration || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const fid = String(flightId || '').trim().toLowerCase();
      if (!reg || !fid) return '';
      return 'https://www.flightradar24.com/data/aircraft/' + reg + '#' + fid;
    }

    function openPendingModal(index) {
      const p = pendingCache[index];
      if (!p) return;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '-'; };
      set('mFlightId', String(p.flight_id || '-'));
      set('mRegistration', String(p.registration || '-'));
      set('mDate', String(p.date || '-'));
      set('mReason', String(p.reason || 'transponder gap'));
      set('mGap', p.maxGapKm != null ? String(p.maxGapKm) + ' km' : '-');
      set('mDetected', String(p.detected_at || p.created_at || '-'));

      const fr24Url = buildFr24Url(p.registration, p.flight_id);
      const fr24 = document.getElementById('mFr24');
      if (fr24) {
        fr24.href = fr24Url || '#';
        fr24.className = fr24Url ? 'btn btn-sm' : 'btn btn-sm btn-disabled';
      }

      const pngName = String(p.filename || '').replace(/\\.kml$/i, '.png');
      const pngUrl = pngName
        ? 'https://media.githubusercontent.com/media/morons-za/morons/main/backend/flight-maps/' + encodeURIComponent(pngName)
        : '';
      const img = document.getElementById('mImage');
      const noImg = document.getElementById('mNoImage');
      if (img) {
        img.style.display = pngUrl ? 'block' : 'none';
        if (pngUrl) {
          img.src = pngUrl;
          img.onerror = () => {
            img.style.display = 'none';
            if (noImg) noImg.style.display = 'block';
          };
          if (noImg) noImg.style.display = 'none';
        } else if (noImg) {
          noImg.style.display = 'block';
        }
      }

      const approve = document.getElementById('mApprove');
      const reject = document.getElementById('mReject');
      const suspicious = document.getElementById('mSuspicious');
      const status = document.getElementById('mStatus');
      if (status) status.style.display = 'none';
      if (approve) {
        approve.disabled = false;
        approve.onclick = () => decide(p.flight_id, 'approve');
      }
      if (reject) {
        reject.disabled = false;
        reject.onclick = () => decide(p.flight_id, 'reject');
      }
      if (suspicious) {
        suspicious.disabled = false;
        suspicious.onclick = () => decide(p.flight_id, 'suspicious');
      }

      const modal = document.getElementById('pendingModal');
      if (modal) modal.style.display = 'flex';
    }

    // Approve/reject/suspicious via the logged-in admin session — no
    // per-flight token or expiry involved, so this works regardless of how
    // old the item is. "Suspicious" is for flights that look like a pilot
    // deliberately switched off their transponder rather than an ordinary
    // false-positive gap — it's set aside (kept out of the active queue,
    // KML/PNG retained) without being published or dismissed either way.
    let activeDecideFlightId = null;
    function sleepMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

    async function decide(flightId, action) {
      const approve = document.getElementById('mApprove');
      const reject = document.getElementById('mReject');
      const suspicious = document.getElementById('mSuspicious');
      const status = document.getElementById('mStatus');
      const buttons = [approve, reject, suspicious];
      buttons.forEach((b) => { if (b) b.disabled = true; });
      activeDecideFlightId = flightId;
      const setStatus = (color, text) => {
        if (activeDecideFlightId !== flightId || !status) return;
        status.style.display = 'block';
        status.style.color = color;
        status.textContent = text;
      };

      setStatus('#1a1a1a', 'Submitting ' + action + '...');
      try {
        const resp = await fetch('/admin/api/decide', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flight_id: flightId, action })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || ('HTTP ' + resp.status));
      } catch (e) {
        buttons.forEach((b) => { if (b) b.disabled = false; });
        setStatus('#991b1b', 'Failed: ' + e.message);
        return;
      }

      // The request above only queues a GitHub Actions run (checkout, run
      // the decision script, commit, push) — the actual pending-review.json
      // update typically takes 1-3 minutes, not the moment this call
      // returns. Poll until the flight actually drops out of the pending
      // list instead of refreshing immediately and showing stale data.
      const maxAttempts = 18; // ~3 minutes at 10s apart
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        setStatus('#1a1a1a', 'Submitted. Processing via GitHub Actions (' + (attempt - 1) * 10 + 's so far, usually takes 1-2 min)...');
        await sleepMs(10000);
        if (activeDecideFlightId !== flightId) return;
        try {
          const resp = await fetch('/admin/api/summary', { credentials: 'same-origin' });
          const data = await resp.json();
          if (resp.ok && data.ok) {
            render(data);
            const stillPending = (data.falsePositives.pending || []).some((p) => p.flight_id === flightId);
            if (!stillPending) {
              setStatus('#166534', 'Done — ' + action + ' recorded.');
              setTimeout(() => { if (activeDecideFlightId === flightId) closePendingModal(); }, 1200);
              return;
            }
          }
        } catch (e) {
          // transient fetch failure while polling — just retry next attempt
        }
      }
      setStatus('#92400e', 'Still processing after 3 minutes — check the Audit log or GitHub Actions runs, then refresh.');
      buttons.forEach((b) => { if (b) b.disabled = false; });
    }

    function closePendingModal() {
      const modal = document.getElementById('pendingModal');
      if (modal) modal.style.display = 'none';
    }

    function handleModalBackdrop(event) {
      if (event.target && event.target.id === 'pendingModal') {
        closePendingModal();
      }
    }

    function esc(v) {
      return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    load();
  </script>
</body>
</html>`;
}

function reviewSuccessPage(flightId, action) {
  const actionLabel = action === 'approve' ? 'Approved as violation' : 'Rejected - not a violation';
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
  return htmlResponse(html);
}

function errorCardPage(title, message) {
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
  return html;
}

function errorPage(title, message) {
  return htmlResponse(errorCardPage(title, message), 400);
}

async function validateHmac(payload, token, secret) {
  const expected = await hmacHex(payload, secret);
  return timingSafeEqual(expected, token);
}

async function hmacHex(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return arrayBufferToHex(signature);
}

function timingSafeEqual(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa.length !== bb.length) return false;
  let result = 0;
  for (let i = 0; i < aa.length; i++) {
    result |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  }
  return result === 0;
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await request.json();
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const out = {};
    for (const [k, v] of form.entries()) out[k] = String(v);
    return out;
  }
  return {};
}

function parseCookies(cookieHeader) {
  const out = {};
  const parts = String(cookieHeader || '').split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      // Ignore malformed cookie values rather than failing the request.
      out[k] = v;
    }
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.max(0, Number(opts.maxAge) || 0)}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join('; ');
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function shortHash(value) {
  let h = 0;
  const s = String(value || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isoDayDaysAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(str) {
  const normalized = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return atob(normalized + pad);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizePath(pathname) {
  const p = String(pathname || '');
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p || '/';
}

async function verifyPassword(password, encodedHash) {
  const raw = String(encodedHash || '').trim();
  const parts = raw.split('$');
  if (parts.length !== 4) return false;

  const [algo, iterationsRaw, saltB64, hashB64] = parts;
  if (algo !== 'pbkdf2_sha256') return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 10000 || iterations > 100000) return false;

  let salt;
  let expectedHash;
  try {
    salt = base64ToBytes(saltB64);
    expectedHash = base64ToBytes(hashB64);
  } catch {
    return false;
  }

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    }, key, expectedHash.length * 8);
    const actualHash = new Uint8Array(bits);
    return timingSafeEqualBytes(actualHash, expectedHash);
  } catch {
    return false;
  }
}

function base64ToBytes(b64) {
  const str = atob(String(b64 || ''));
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

function timingSafeEqualBytes(a, b) {
  const aa = a instanceof Uint8Array ? a : new Uint8Array(a || []);
  const bb = b instanceof Uint8Array ? b : new Uint8Array(b || []);
  if (aa.length !== bb.length) return false;
  let result = 0;
  for (let i = 0; i < aa.length; i++) {
    result |= aa[i] ^ bb[i];
  }
  return result === 0;
}
