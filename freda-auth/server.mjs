import { createServer } from 'node:http';
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';

const PORT   = parseInt(process.env.FREDA_AUTH_PORT   || '8133', 10);
const HOST   = process.env.FREDA_AUTH_HOST             || '127.0.0.1';
const SECRET = process.env.FREDA_SESSION_SECRET        || 'freda-dev-secret-change-in-prod';
const USERS_FILE   = process.env.FREDA_USERS_FILE      || 'C:\\freda-auth\\users.json';
const MARKET_PORT   = 8130;
const BACKEND_PORT  = 8131;
const CUSTOMER_PORT = 8132;
const SESSION_COOKIE = 'freda_gateway_session';
const AUTH_COOKIE    = 'freda_auth';

// ── Midnight expiry ──────────────────────────────────────────────────────────

function midnight() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

// ── Session signing ──────────────────────────────────────────────────────────

function signSession(username, userType) {
  const exp = midnight();
  const payload = `${username}:${userType}:${exp}`;
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifySession(cookie) {
  try {
    const decoded = Buffer.from(cookie, 'base64url').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length !== 4) return null;
    const [username, userType, expStr, sig] = parts;
    if (Date.now() > parseInt(expStr, 10)) return null;
    const payload  = `${username}:${userType}:${expStr}`;
    const expected = createHmac('sha256', SECRET).update(payload).digest('hex');
    const a = Buffer.from(sig,      'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { username, userType };
  } catch {
    return null;
  }
}

// ── Password verification ────────────────────────────────────────────────────

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const hashBuf = Buffer.from(hash, 'hex');
    const testBuf = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuf, testBuf);
  } catch {
    return false;
  }
}

// ── Users store ──────────────────────────────────────────────────────────────

function readUsers() {
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

// ── Cookie helpers ───────────────────────────────────────────────────────────

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = v.join('=').trim();
  }
  return out;
}

function makeSessionCookies(username, userType) {
  const exp     = midnight();
  const expires = new Date(exp).toUTCString();
  const sessionVal = signSession(username, userType);
  const authVal    = Buffer.from(JSON.stringify({ username, userType, exp })).toString('base64');
  return [
    `${SESSION_COOKIE}=${sessionVal}; HttpOnly; Path=/; Expires=${expires}; SameSite=Lax`,
    `${AUTH_COOKIE}=${authVal}; Path=/; Expires=${expires}; SameSite=Lax`,
  ];
}

function clearSessionCookies() {
  const past = 'Thu, 01 Jan 1970 00:00:00 GMT';
  return [
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Expires=${past}; SameSite=Lax`,
    `${AUTH_COOKIE}=; Path=/; Expires=${past}; SameSite=Lax`,
  ];
}

// ── Login page ───────────────────────────────────────────────────────────────

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c])); }

function loginPage(error = '') {
  const errorHtml = error
    ? `<div class="error">${esc(error)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>F.R.E.D.A — Sign In</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0f1a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
    .card{background:#131929;border:1px solid #1e2d47;border-radius:14px;padding:2.5rem;width:100%;max-width:420px;box-shadow:0 25px 50px rgba(0,0,0,.5)}
    .brand{display:flex;align-items:center;gap:.625rem;margin-bottom:1.75rem}
    .brand-dot{width:10px;height:10px;background:#6366f1;border-radius:50%}
    .brand-name{color:#e2e8f0;font-size:1.0625rem;font-weight:700;letter-spacing:.12em}
    h1{color:#f1f5f9;font-size:1.5rem;font-weight:700;margin-bottom:.375rem}
    .subtitle{color:#64748b;font-size:.875rem;margin-bottom:2rem}
    .field{margin-bottom:1.25rem}
    label{display:block;color:#94a3b8;font-size:.8125rem;font-weight:500;margin-bottom:.5rem}
    select,input{width:100%;background:#0b0f1a;border:1px solid #1e2d47;border-radius:8px;color:#e2e8f0;padding:.6875rem .875rem;font-size:.9rem;outline:none;transition:border-color .15s,box-shadow .15s;-webkit-appearance:none;appearance:none}
    select{cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .875rem center;padding-right:2.5rem}
    select:focus,input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15)}
    select option{background:#131929}
    .btn{width:100%;background:#6366f1;color:#fff;border:none;border-radius:8px;padding:.75rem;font-size:.9375rem;font-weight:600;cursor:pointer;margin-top:.5rem;transition:background .15s}
    .btn:hover{background:#4f46e5}
    .error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5;border-radius:8px;padding:.625rem .875rem;font-size:.8125rem;margin-bottom:1.25rem}
    hr{border:none;border-top:1px solid #1e2d47;margin:1.75rem 0}
    .note{color:#475569;font-size:.75rem;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand"><div class="brand-dot"></div><div class="brand-name">F.R.E.D.A</div></div>
    <h1>Welcome back</h1>
    <p class="subtitle">Sign in to continue to your workspace</p>
    ${errorHtml}
    <form method="POST" action="/auth/login">
      <div class="field">
        <label for="user_type">Account type</label>
        <select name="user_type" id="user_type" required>
          <option value="">Select…</option>
          <option value="market">New Customer — Exploring Freda</option>
          <option value="customer">Existing Customer — My Workspace</option>
        </select>
      </div>
      <div class="field">
        <label for="username">Username</label>
        <input type="text" name="username" id="username" required autocomplete="username" placeholder="Enter your username" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" name="password" id="password" required autocomplete="current-password" placeholder="••••••••" />
      </div>
      <button class="btn" type="submit">Sign in</button>
    </form>
    <hr>
    <p class="note">Sessions expire daily at midnight.</p>
  </div>
</body>
</html>`;
}

// ── HTTP proxy ───────────────────────────────────────────────────────────────

function proxy(req, res, targetPort, username, userType) {
  const headers = { ...req.headers };
  headers['host']         = `127.0.0.1:${targetPort}`;
  headers['x-freda-user'] = username;
  headers['x-freda-type'] = userType;

  // Strip gateway cookies before forwarding
  if (headers['cookie']) {
    const filtered = headers['cookie']
      .split(';')
      .filter(c => !c.trim().startsWith(SESSION_COOKIE + '=') && !c.trim().startsWith(AUTH_COOKIE + '='))
      .join(';')
      .trim();
    if (filtered) headers['cookie'] = filtered;
    else delete headers['cookie'];
  }

  const proxyReq = httpRequest({
    hostname: '127.0.0.1',
    port: targetPort,
    path: req.url,
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[freda-auth] proxy error → :${targetPort} — ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

// ── Body parser ──────────────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

function parseForm(body) {
  const out = {};
  for (const pair of body.split('&')) {
    const [k, ...v] = pair.split('=');
    if (k) out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.join('=').replace(/\+/g, ' '));
  }
  return out;
}

// ── Main server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url     = req.url || '/';
  const cookies = parseCookies(req.headers['cookie']);

  try {
    // ── Logout ──
    if (url === '/auth/logout') {
      res.writeHead(302, { 'Set-Cookie': clearSessionCookies(), 'Location': '/' });
      res.end();
      return;
    }

    // ── Login POST ──
    if (url === '/auth/login' && req.method === 'POST') {
      const { username = '', password = '', user_type = '' } = parseForm(await readBody(req));

      if (!username.trim() || !password || !user_type) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage('All fields are required.'));
        return;
      }

      const users = readUsers();
      const user  = users.find(u =>
        u.username.toLowerCase() === username.trim().toLowerCase() &&
        u.user_type === user_type
      );

      if (!user || !verifyPassword(password, user.password)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage('Incorrect username, password, or account type.'));
        return;
      }

      res.writeHead(302, { 'Set-Cookie': makeSessionCookies(user.username, user.user_type), 'Location': '/' });
      res.end();
      return;
    }

    // ── Validate session ──
    const session = cookies[SESSION_COOKIE] ? verifySession(cookies[SESSION_COOKIE]) : null;

    if (!session) {
      // Show login page for GET /, redirect everything else
      if (url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage());
      } else {
        res.writeHead(302, { 'Location': '/' });
        res.end();
      }
      return;
    }

    // ── Proxy to the right app ──
    let targetPort;
    if (session.userType === 'customer') {
      targetPort = CUSTOMER_PORT;
    } else if (url.startsWith('/api/')) {
      targetPort = BACKEND_PORT;
    } else {
      targetPort = MARKET_PORT;
    }
    proxy(req, res, targetPort, session.username, session.userType);

  } catch (err) {
    console.error('[freda-auth] unhandled error:', err?.message || err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[freda-auth] listening  → http://${HOST}:${PORT}`);
  console.log(`[freda-auth] users      → ${USERS_FILE}`);
  console.log(`[freda-auth] market     → :${MARKET_PORT}`);
  console.log(`[freda-auth] customer   → :${CUSTOMER_PORT}`);
});

process.on('uncaughtException',  (e) => { console.error('[freda-auth] CRASH', e.message, e.stack); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[freda-auth] UNHANDLED REJECTION', e?.message || e); });
