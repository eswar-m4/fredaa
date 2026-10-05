import { createServer } from 'node:http';
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname } from 'node:path';

const PORT    = parseInt(process.env.FREDA_AUTH_PORT || '8133', 10);
const HOST    = process.env.FREDA_AUTH_HOST           || '127.0.0.1';
const SECRET  = process.env.FREDA_SESSION_SECRET      || 'freda-dev-secret-change-in-prod';
const USERS_FILE  = process.env.FREDA_USERS_FILE      || 'C:\\freda-auth\\users.json';
const LOGS_FILE   = process.env.FREDA_LOGS_FILE       || 'C:\\freda-auth\\activity.log';
const MARKET_PORT   = 8130;
const BACKEND_PORT  = 8131;
const CUSTOMER_PORT = 8132;
const SESSION_COOKIE  = 'freda_gateway_session';
const AUTH_COOKIE     = 'freda_auth';
const CUSTOMER_SPACES = ['NTM', 'ERIS'];

// ── Midnight expiry ───────────────────────────────────────────────────────────

function midnight() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

// ── Session signing ───────────────────────────────────────────────────────────

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

// ── Password helpers ──────────────────────────────────────────────────────────

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

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

// ── Users store ───────────────────────────────────────────────────────────────

function readUsers() {
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function writeUsers(users) {
  const dir = dirname(USERS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── Activity log ──────────────────────────────────────────────────────────────

function writeLog(entry) {
  try {
    const dir = dirname(LOGS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(LOGS_FILE, JSON.stringify(entry) + '\n');
  } catch { /* ignore */ }
}

function readLogs() {
  try {
    return readFileSync(LOGS_FILE, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => JSON.parse(l))
      .reverse();
  } catch { return []; }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

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

// ── HTML escape ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

// ── Login page (light theme) ──────────────────────────────────────────────────

function loginPage(error = '') {
  const errorHtml = error ? `<div class="error">${esc(error)}</div>` : '';
  const features = [
    ['Source',   'Agents mapped to the sites, portals and directories you trust.'],
    ['Extract',  'Only the datapoints you specify — structured and deduplicated.'],
    ['Validate', 'Every record scored Added / Deleted / Modified / Verified.'],
    ['Refresh',  'Daily, weekly, monthly or a custom cadence you set.'],
    ['Review',   'Sampled batches with confidence gates and group approval.'],
    ['Deliver',  'Approved data exported or synced straight to your systems.'],
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>F.R.E.D.A — Sign In</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem 1.5rem;color:#0f172a}
    .wrap{width:100%;max-width:960px;display:grid;gap:2rem;grid-template-columns:1.15fr 0.85fr;align-items:start}
    @media(max-width:720px){.wrap{grid-template-columns:1fr}}
    .brand{display:flex;align-items:center;gap:.875rem;margin-bottom:1.25rem}
    .brand-icon{width:44px;height:44px;background:#6366f1;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .brand-icon svg{width:22px;height:22px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .brand-name{font-size:1.75rem;font-weight:700;color:#0f172a;line-height:1}
    .brand-sub{font-size:.875rem;font-weight:600;color:#6366f1;margin-top:.125rem}
    .desc{font-size:.8125rem;color:#64748b;line-height:1.65;margin-bottom:1.25rem;max-width:440px}
    .feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:.625rem}
    .feat-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:.75rem;display:flex;align-items:flex-start;gap:.625rem}
    .feat-icon{width:28px;height:28px;border-radius:6px;background:#eff6ff;border:1px solid #bfdbfe;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .feat-icon svg{width:13px;height:13px;stroke:#3b82f6;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .feat-card h4{font-size:.75rem;font-weight:600;color:#0f172a}
    .feat-card p{font-size:.6875rem;color:#64748b;line-height:1.45;margin-top:.1rem}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.05)}
    .card-title{font-size:1.125rem;font-weight:700;color:#0f172a;margin-bottom:.25rem}
    .card-sub{font-size:.8125rem;color:#64748b;margin-bottom:1.5rem}
    .field{margin-bottom:1rem}
    label{display:block;font-size:.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#64748b;margin-bottom:.375rem}
    select,input{width:100%;height:40px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;color:#0f172a;padding:0 .75rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s;appearance:none;-webkit-appearance:none}
    select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .75rem center;background-color:#fff;padding-right:2.25rem;cursor:pointer}
    select:focus,input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
    select option{background:#fff}
    .btn{width:100%;height:40px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:.875rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.5rem;transition:background .15s;margin-top:.25rem}
    .btn:hover{background:#4f46e5}
    .error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:6px;padding:.625rem .875rem;font-size:.8125rem;margin-bottom:1rem}
    hr{border:none;border-top:1px solid #f1f5f9;margin:1.25rem 0}
    .note{color:#94a3b8;font-size:.6875rem;text-align:center}
  </style>
</head>
<body>
<div class="wrap">
  <div>
    <div class="brand">
      <div class="brand-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></div>
      <div><div class="brand-name">FreDA</div><div class="brand-sub">Fresh Data Automation</div></div>
    </div>
    <p class="desc">FreDA runs agents on the web sources your business depends on, extracts the exact datapoints you asked for, scores every change, and puts the doubtful ones in front of a human before delivery — on a schedule you control.</p>
    <div class="feat-grid">
      ${features.map(([t, c]) => `<div class="feat-card"><div class="feat-icon"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div><div><h4>${t}</h4><p>${c}</p></div></div>`).join('')}
    </div>
  </div>

  <div class="card">
    <div class="card-title">Welcome back</div>
    <div class="card-sub">Sign in to continue to your workspace</div>
    ${errorHtml}
    <form method="POST" action="/auth/login">
      <div class="field">
        <label for="user_type">Portal</label>
        <select name="user_type" id="user_type" required>
          <option value="">Select…</option>
          <option value="market">New Customer — Exploring Freda</option>
          <option value="customer">Existing Customer — My Workspace</option>
          <option value="admin">Administrator</option>
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
      <button class="btn" type="submit">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        Sign in
      </button>
    </form>
    <hr>
    <p class="note">Sessions expire daily at midnight.</p>
  </div>
</div>
</body>
</html>`;
}

// ── Admin console SPA ─────────────────────────────────────────────────────────

function adminPage() {
  const spacesJson = JSON.stringify(CUSTOMER_SPACES);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>F.R.E.D.A — Admin Console</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;min-height:100vh}
    nav{background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;padding:0 1.5rem;height:52px;gap:0;position:sticky;top:0;z-index:10;box-shadow:0 1px 2px rgba(0,0,0,.04)}
    .nav-brand{display:flex;align-items:center;gap:.5rem;font-weight:700;font-size:.9375rem;color:#0f172a;margin-right:1.5rem;flex-shrink:0}
    .nav-dot{width:8px;height:8px;background:#6366f1;border-radius:50%}
    .nav-link{height:52px;font-size:.8125rem;font-weight:500;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;padding:0 .875rem;cursor:pointer;transition:color .15s,border-color .15s;white-space:nowrap}
    .nav-link:hover{color:#6366f1}
    .nav-link.active{color:#6366f1;border-bottom-color:#6366f1}
    .nav-right{margin-left:auto;display:flex;align-items:center;gap:.75rem}
    .nav-user{font-size:.75rem;color:#94a3b8;font-weight:500}
    .logout-btn{font-size:.75rem;background:none;border:1px solid #e2e8f0;border-radius:5px;padding:.25rem .75rem;color:#64748b;cursor:pointer;transition:background .15s}
    .logout-btn:hover{background:#f1f5f9}
    .page{display:none;padding:1.5rem;max-width:1280px;margin:0 auto}
    .page.active{display:block}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.375rem}
    .section-title{font-size:.9rem;font-weight:700;color:#0f172a;margin-bottom:1rem;letter-spacing:-.01em}
    .form-grid{display:grid;gap:.875rem;grid-template-columns:repeat(3,1fr)}
    @media(max-width:680px){.form-grid{grid-template-columns:1fr}}
    .field{display:flex;flex-direction:column;gap:.3125rem}
    .field label{font-size:.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8}
    .field input,.field select{height:36px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;color:#0f172a;padding:0 .625rem;font-size:.8125rem;outline:none;appearance:none;-webkit-appearance:none;transition:border-color .15s,box-shadow .15s}
    .field select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .625rem center;background-color:#fff;padding-right:1.875rem;cursor:pointer}
    .field input:focus,.field select:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
    .spaces-row{margin-top:.875rem}
    .spaces-label{font-size:.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;margin-bottom:.5rem}
    .chips{display:flex;flex-wrap:wrap;gap:.375rem}
    .chip{display:inline-flex;align-items:center;gap:.3rem;border:1px solid #e2e8f0;border-radius:5px;padding:.25rem .625rem;font-size:.75rem;font-weight:500;cursor:pointer;user-select:none;background:#fff;color:#64748b;transition:all .12s}
    .chip.on{background:#eff6ff;border-color:#93c5fd;color:#1d4ed8}
    .chip input{display:none}
    .btn-add{height:36px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:.8125rem;font-weight:600;cursor:pointer;padding:0 1.125rem;display:inline-flex;align-items:center;gap:.375rem;transition:background .15s;margin-top:1rem}
    .btn-add:hover{background:#4f46e5}
    .lists{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1.25rem}
    @media(max-width:680px){.lists{grid-template-columns:1fr}}
    .list-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
    .list-head{padding:.625rem 1rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}
    .list-head-title{font-size:.8125rem;font-weight:600;color:#0f172a}
    .badge-count{font-size:.6rem;font-weight:700;background:#e2e8f0;border-radius:999px;padding:.15rem .5rem;color:#64748b;letter-spacing:.04em}
    .urow{display:flex;align-items:center;gap:.5rem;padding:.5625rem 1rem;border-bottom:1px solid #f1f5f9;font-size:.8rem;transition:background .1s}
    .urow:last-child{border-bottom:none}
    .urow:hover{background:#fafafa}
    .uname{flex:1;font-weight:500;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    .uspaces{font-size:.6875rem;color:#94a3b8;margin-right:.25rem;flex-shrink:0}
    .badge{display:inline-flex;align-items:center;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-radius:999px;padding:.1rem .45rem;flex-shrink:0}
    .badge-ok{background:#dcfce7;color:#15803d}
    .badge-off{background:#fef9c3;color:#854d0e}
    .actions{display:flex;gap:.25rem;flex-shrink:0}
    .ibtn{height:26px;border-radius:5px;font-size:.6875rem;font-weight:500;cursor:pointer;padding:0 .5rem;display:inline-flex;align-items:center;border:1px solid;transition:background .12s;white-space:nowrap;gap:.2rem}
    .ibtn-edit{background:#fff;border-color:#e2e8f0;color:#475569}.ibtn-edit:hover{background:#f8fafc}
    .ibtn-del{background:#fff;border-color:#fca5a5;color:#dc2626}.ibtn-del:hover{background:#fef2f2}
    .ibtn-pause{background:#fff;border-color:#fcd34d;color:#92400e}.ibtn-pause:hover{background:#fffbeb}
    .ibtn-resume{background:#fff;border-color:#86efac;color:#166534}.ibtn-resume:hover{background:#f0fdf4}
    .empty{padding:2rem;text-align:center;color:#cbd5e1;font-size:.8125rem}
    /* logs */
    .log-bar{display:flex;gap:.625rem;margin-bottom:1rem;align-items:center;flex-wrap:wrap}
    .log-bar input{height:32px;border:1px solid #e2e8f0;border-radius:6px;padding:0 .625rem;font-size:.8125rem;outline:none;color:#0f172a;min-width:200px;transition:border-color .15s}
    .log-bar input:focus{border-color:#6366f1}
    .log-table{width:100%;border-collapse:collapse;font-size:.75rem}
    .log-table th{background:#f8fafc;padding:.5rem .75rem;text-align:left;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;border-bottom:1px solid #e2e8f0;white-space:nowrap}
    .log-table td{padding:.5rem .75rem;border-bottom:1px solid #f8fafc;color:#334155;vertical-align:middle}
    .log-table tr:hover td{background:#fafafa}
    .log-ts{color:#cbd5e1;white-space:nowrap;font-size:.6875rem}
    .log-action{font-weight:600;color:#0f172a}
    .log-detail{color:#64748b;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .no-data{text-align:center;padding:3rem;color:#cbd5e1;font-size:.8125rem}
    /* modals */
    .overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.4);z-index:100;align-items:center;justify-content:center;backdrop-filter:blur(2px)}
    .overlay.open{display:flex}
    .modal{background:#fff;border-radius:12px;padding:1.5rem;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.18)}
    .modal-title{font-size:.9375rem;font-weight:700;color:#0f172a;margin-bottom:1rem}
    .modal-foot{display:flex;gap:.5rem;justify-content:flex-end;margin-top:1.25rem}
    .btn-cancel{height:34px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;font-size:.8125rem;cursor:pointer;padding:0 .875rem;color:#64748b}
    .btn-save{height:34px;background:#6366f1;border:none;border-radius:6px;font-size:.8125rem;font-weight:600;cursor:pointer;padding:0 .875rem;color:#fff}
    .btn-save:hover{background:#4f46e5}
    .btn-danger{height:34px;background:#dc2626;border:none;border-radius:6px;font-size:.8125rem;font-weight:600;cursor:pointer;padding:0 .875rem;color:#fff}
    .btn-danger:hover{background:#b91c1c}
    .m-field{margin-bottom:.875rem}
    .m-field label{display:block;font-size:.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;margin-bottom:.375rem}
    .m-field input{width:100%;height:36px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;color:#0f172a;padding:0 .625rem;font-size:.8125rem;outline:none;transition:border-color .15s,box-shadow .15s}
    .m-field input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
    /* alert/toast */
    .form-msg{font-size:.8rem;border-radius:6px;padding:.5rem .75rem;margin-bottom:.875rem}
    .form-msg.err{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
    .form-msg.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
    .toast{position:fixed;bottom:1.25rem;right:1.25rem;background:#1e293b;color:#f1f5f9;font-size:.8125rem;padding:.5625rem .9375rem;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:0;pointer-events:none;z-index:999;transition:opacity .2s;max-width:280px}
    .toast.show{opacity:1}
    .page.embed{padding:0;max-width:none;height:calc(100vh - 52px);overflow:hidden}
    .embed-frame{width:100%;height:100%;border:none;display:block;background:#f8fafc}
  </style>
</head>
<body>
<nav>
  <div class="nav-brand"><div class="nav-dot"></div>F.R.E.D.A</div>
  <button class="nav-link active" onclick="showPage('console',this)">Console</button>
  <button class="nav-link" onclick="showPage('clogs',this)">Customer Logs</button>
  <button class="nav-link" onclick="showPage('mlogs',this)">Market Logs</button>
  <button class="nav-link" onclick="showPage('madmin',this)">Market Admin</button>
  <button class="nav-link" onclick="showPage('cadmin',this)">Customer Admin</button>
  <div class="nav-right">
    <span class="nav-user" id="nav-user"></span>
    <button class="logout-btn" onclick="doLogout()">Sign out</button>
  </div>
</nav>

<!-- Console -->
<div class="page active" id="page-console">
  <div class="card">
    <div class="section-title">Add User</div>
    <div id="form-msg"></div>
    <div class="form-grid">
      <div class="field">
        <label>Portal</label>
        <select id="f-type" onchange="onTypeChange()">
          <option value="">Select…</option>
          <option value="market">Market — New Customer</option>
          <option value="customer">Customer — Workspace</option>
          <option value="admin">Administrator</option>
        </select>
      </div>
      <div class="field">
        <label>Username</label>
        <input type="text" id="f-user" placeholder="Username" autocomplete="off" />
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="f-pass" placeholder="Password" autocomplete="new-password" />
      </div>
    </div>
    <div id="spaces-row" style="display:none" class="spaces-row">
      <div class="spaces-label">Customer Spaces</div>
      <div class="chips" id="spaces-chips"></div>
    </div>
    <button class="btn-add" onclick="addUser()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add User
    </button>
  </div>

  <div class="lists">
    <div class="list-card">
      <div class="list-head">
        <span class="list-head-title">Market Users</span>
        <span class="badge-count" id="mc">0</span>
      </div>
      <div id="market-list"><div class="empty">No market users yet.</div></div>
    </div>
    <div class="list-card">
      <div class="list-head">
        <span class="list-head-title">Customer Users</span>
        <span class="badge-count" id="cc">0</span>
      </div>
      <div id="customer-list"><div class="empty">No customer users yet.</div></div>
    </div>
  </div>
</div>

<!-- Customer Logs -->
<div class="page" id="page-clogs">
  <div class="card">
    <div class="section-title">Customer Logs</div>
    <div class="log-bar">
      <input type="text" id="cl-search" placeholder="Filter by user or action…" oninput="filterLogs('c')" />
    </div>
    <div style="overflow-x:auto">
      <table class="log-table">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>Page</th></tr></thead>
        <tbody id="cl-body"></tbody>
      </table>
      <div id="cl-empty" class="no-data" style="display:none">No customer activity logged yet.</div>
    </div>
  </div>
</div>

<!-- Market Logs -->
<div class="page" id="page-mlogs">
  <div class="card">
    <div class="section-title">Market Logs</div>
    <div class="log-bar">
      <input type="text" id="ml-search" placeholder="Filter by user or action…" oninput="filterLogs('m')" />
    </div>
    <div style="overflow-x:auto">
      <table class="log-table">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>Page</th></tr></thead>
        <tbody id="ml-body"></tbody>
      </table>
      <div id="ml-empty" class="no-data" style="display:none">No market activity logged yet.</div>
    </div>
  </div>
</div>

<!-- Market Admin embed -->
<div class="page embed" id="page-madmin">
  <iframe class="embed-frame" id="market-frame" src="about:blank" title="Market Admin Console"></iframe>
</div>

<!-- Customer Admin embed -->
<div class="page embed" id="page-cadmin">
  <iframe class="embed-frame" id="customer-frame" src="about:blank" title="Customer Admin Console"></iframe>
</div>

<!-- Edit modal -->
<div class="overlay" id="edit-overlay">
  <div class="modal">
    <div class="modal-title">Edit User</div>
    <div id="edit-msg"></div>
    <div class="m-field"><label>Username</label><input type="text" id="e-user" autocomplete="off" /></div>
    <div class="m-field"><label>New Password <span style="font-size:.65rem;font-weight:400;text-transform:none;letter-spacing:0">(blank = keep current)</span></label><input type="password" id="e-pass" placeholder="Leave blank to keep" autocomplete="new-password" /></div>
    <div id="e-spaces-row" style="display:none">
      <div class="m-field">
        <label>Customer Spaces</label>
        <div class="chips" id="e-chips" style="margin-top:.375rem"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn-cancel" onclick="closeOverlay('edit-overlay')">Cancel</button>
      <button class="btn-save" onclick="saveEdit()">Save changes</button>
    </div>
  </div>
</div>

<!-- Delete modal -->
<div class="overlay" id="del-overlay">
  <div class="modal">
    <div class="modal-title">Delete User</div>
    <p style="font-size:.8125rem;color:#475569;line-height:1.5;margin-bottom:.5rem">Delete <strong id="del-label"></strong>? This cannot be undone and immediately revokes access.</p>
    <div class="modal-foot">
      <button class="btn-cancel" onclick="closeOverlay('del-overlay')">Cancel</button>
      <button class="btn-danger" onclick="confirmDelete()">Delete</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const SPACES = ${spacesJson};
let allLogs = { c: [], m: [] };
let editTarget = null, delTarget = null;

async function init() {
  try {
    const raw = document.cookie.split(';').find(c => c.trim().startsWith('freda_auth='));
    if (raw) {
      const d = JSON.parse(atob(decodeURIComponent(raw.trim().split('=').slice(1).join('='))));
      document.getElementById('nav-user').textContent = (d.username || '') + ' · admin';
    }
  } catch {}
  buildChips('spaces-chips', []);
  await Promise.all([loadUsers(), loadLogs()]);
}

function showPage(name, btn) {
  // Always clear embed mode and reset iframes first to stop background requests
  document.cookie = 'freda_embed_mode=; path=/; max-age=0';
  document.getElementById('market-frame').src = 'about:blank';
  document.getElementById('customer-frame').src = 'about:blank';

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  btn.classList.add('active');

  // Set embed cookie THEN load iframe — cookie must arrive with the first request
  if (name === 'madmin') {
    document.cookie = 'freda_embed_mode=market; path=/';
    document.getElementById('market-frame').src = '/admin';
  }
  if (name === 'cadmin') {
    document.cookie = 'freda_embed_mode=customer; path=/';
    document.getElementById('customer-frame').src = '/admin';
  }
}

// chips
function buildChips(id, selected) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  SPACES.forEach(s => {
    const lbl = document.createElement('label');
    lbl.className = 'chip' + (selected.includes(s) ? ' on' : '');
    lbl.dataset.s = s;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = s;
    if (selected.includes(s)) cb.checked = true;
    cb.addEventListener('change', () => lbl.classList.toggle('on', cb.checked));
    lbl.appendChild(cb);
    lbl.append(s);
    el.appendChild(lbl);
  });
}
function getChips(id) {
  return [...document.querySelectorAll('#'+id+' input:checked')].map(i => i.value);
}

function onTypeChange() {
  document.getElementById('spaces-row').style.display =
    document.getElementById('f-type').value === 'customer' ? 'block' : 'none';
}

// users
async function loadUsers() {
  const r = await fetch('/admin/api/users');
  if (!r.ok) return;
  const { users } = await r.json();
  renderList('market-list','mc', users.filter(u=>u.user_type==='market'), false);
  renderList('customer-list','cc', users.filter(u=>u.user_type==='customer'), true);
}

function e(s) {
  return String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderList(listId, countId, users, showSpaces) {
  document.getElementById(countId).textContent = users.length;
  const el = document.getElementById(listId);
  if (!users.length) { el.innerHTML='<div class="empty">No users yet.</div>'; return; }
  el.innerHTML = users.map(u => {
    const isActive = u.active !== false;
    const sp = u.spaces && u.spaces.length ? u.spaces : [];
    return \`<div class="urow">
      <span class="uname" title="\${e(u.username)}">\${e(u.username)}</span>
      \${showSpaces&&sp.length?'<span class="uspaces">'+e(sp.join(', '))+'</span>':''}
      <span class="badge \${isActive?'badge-ok':'badge-off'}">\${isActive?'Active':'Paused'}</span>
      <div class="actions">
        <button class="ibtn ibtn-edit" onclick='openEdit(\${JSON.stringify(u.username)},\${JSON.stringify(u.user_type)},\${JSON.stringify(sp)})'>Edit</button>
        <button class="ibtn \${isActive?'ibtn-pause':'ibtn-resume'}" onclick='togglePause(\${JSON.stringify(u.username)},\${JSON.stringify(u.user_type)})'>\${isActive?'Pause':'Resume'}</button>
        <button class="ibtn ibtn-del" onclick='openDelete(\${JSON.stringify(u.username)},\${JSON.stringify(u.user_type)})'>Delete</button>
      </div>
    </div>\`;
  }).join('');
}

async function addUser() {
  setMsg('form-msg','','');
  const user_type = document.getElementById('f-type').value;
  const username  = document.getElementById('f-user').value.trim();
  const password  = document.getElementById('f-pass').value;
  const spaces    = user_type === 'customer' ? getChips('spaces-chips') : [];
  if (!user_type) { setMsg('form-msg','Select a portal.','err'); return; }
  if (!username)  { setMsg('form-msg','Enter a username.','err'); return; }
  if (!password)  { setMsg('form-msg','Enter a password.','err'); return; }
  const r = await fetch('/admin/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,user_type,spaces})});
  const d = await r.json();
  if (!r.ok) { setMsg('form-msg',d.error||'Failed.','err'); return; }
  setMsg('form-msg','User added successfully.','ok');
  document.getElementById('f-user').value='';
  document.getElementById('f-pass').value='';
  document.getElementById('f-type').value='';
  document.getElementById('spaces-row').style.display='none';
  buildChips('spaces-chips',[]);
  await loadUsers();
}

function openEdit(username,userType,spaces) {
  editTarget={username,userType};
  document.getElementById('e-user').value=username;
  document.getElementById('e-pass').value='';
  setMsg('edit-msg','','');
  const sr=document.getElementById('e-spaces-row');
  if(userType==='customer'){sr.style.display='block';buildChips('e-chips',spaces||[]);}
  else sr.style.display='none';
  document.getElementById('edit-overlay').classList.add('open');
}
async function saveEdit() {
  setMsg('edit-msg','','');
  const nu=document.getElementById('e-user').value.trim();
  const np=document.getElementById('e-pass').value;
  const sp=editTarget.userType==='customer'?getChips('e-chips'):undefined;
  if(!nu){setMsg('edit-msg','Username cannot be empty.','err');return;}
  const body={username:editTarget.username,user_type:editTarget.userType,new_username:nu};
  if(np)body.new_password=np;
  if(sp!==undefined)body.spaces=sp;
  const r=await fetch('/admin/api/users',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();
  if(!r.ok){setMsg('edit-msg',d.error||'Failed.','err');return;}
  toast('User updated');closeOverlay('edit-overlay');await loadUsers();
}

function openDelete(username,userType) {
  delTarget={username,userType};
  document.getElementById('del-label').textContent=username+' ('+userType+')';
  document.getElementById('del-overlay').classList.add('open');
}
async function confirmDelete() {
  if(!delTarget)return;
  const r=await fetch('/admin/api/users',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(delTarget)});
  const d=await r.json();
  if(!r.ok){toast(d.error||'Failed.');return;}
  toast('User deleted');closeOverlay('del-overlay');await loadUsers();
}

async function togglePause(username,userType) {
  const r=await fetch('/admin/api/users/pause',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,user_type:userType})});
  const d=await r.json();
  if(!r.ok){toast(d.error||'Failed.');return;}
  toast(d.active?'User resumed':'User paused');await loadUsers();
}

// logs
async function loadLogs() {
  const r=await fetch('/admin/api/logs');
  if(!r.ok)return;
  const{logs}=await r.json();
  allLogs.c=logs.filter(l=>l.userType==='customer');
  allLogs.m=logs.filter(l=>l.userType==='market');
  renderLogs('c',allLogs.c);renderLogs('m',allLogs.m);
}
function filterLogs(p) {
  const q=document.getElementById((p==='c'?'cl':'ml')+'-search').value.toLowerCase();
  const src=allLogs[p];
  renderLogs(p,q?src.filter(l=>[(l.username||''),(l.action||''),(l.details||'')].some(v=>v.toLowerCase().includes(q))):src);
}
function renderLogs(p,logs) {
  const tbody=document.getElementById((p==='c'?'cl':'ml')+'-body');
  const empty=document.getElementById((p==='c'?'cl':'ml')+'-empty');
  if(!logs.length){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  tbody.innerHTML=logs.map(l=>\`<tr>
    <td class="log-ts">\${fmt(l.timestamp)}</td>
    <td>\${e(l.username||'—')}</td>
    <td class="log-action">\${e(l.action||'—')}</td>
    <td class="log-detail" title="\${e(l.details||'')}">\${e(l.details||'—')}</td>
    <td>\${e(l.page||'—')}</td>
  </tr>\`).join('');
}
function fmt(ts){
  if(!ts)return'—';
  try{const d=new Date(ts);return d.toLocaleDateString()+' '+d.toLocaleTimeString();}catch{return ts;}
}

// helpers
function setMsg(id,msg,type){
  const el=document.getElementById(id);
  el.innerHTML=msg?'<div class="form-msg '+type+'">'+e(msg)+'</div>':'';
}
function toast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2600);
}
function closeOverlay(id){document.getElementById(id).classList.remove('open');}
function doLogout(){
  ['freda_auth','freda_gateway_session'].forEach(n=>{document.cookie=n+'=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';});
  window.location.href='/auth/logout';
}

init();
</script>
</body>
</html>`;
}

// ── HTTP proxy ────────────────────────────────────────────────────────────────

function proxy(req, res, targetPort, username, userType, overridePath) {
  const headers = { ...req.headers };
  headers['host']         = `127.0.0.1:${targetPort}`;
  headers['x-freda-user'] = username;
  headers['x-freda-type'] = userType;

  if (headers['cookie']) {
    const filtered = headers['cookie']
      .split(';')
      .filter(c => !c.trim().startsWith(SESSION_COOKIE + '=') && !c.trim().startsWith(AUTH_COOKIE + '='))
      .join(';').trim();
    if (filtered) headers['cookie'] = filtered;
    else delete headers['cookie'];
  }

  const path = overridePath !== undefined ? overridePath : req.url;
  const proxyReq = httpRequest({ hostname: '127.0.0.1', port: targetPort, path, method: req.method, headers }, (proxyRes) => {
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

// ── Body helpers ──────────────────────────────────────────────────────────────

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

function jsonRes(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Admin API handler ─────────────────────────────────────────────────────────

async function handleAdminApi(req, res, url) {
  let body = {};
  if (['POST','PUT','DELETE','PATCH'].includes(req.method)) {
    try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
  }

  if (url === '/admin/api/users' && req.method === 'GET') {
    const users = readUsers().map(({ password: _p, ...u }) => u);
    return jsonRes(res, 200, { users });
  }

  if (url === '/admin/api/users' && req.method === 'POST') {
    const { username, password, user_type, spaces = [] } = body;
    if (!username || !password || !['market','customer','admin'].includes(user_type))
      return jsonRes(res, 400, { error: 'username, password and valid portal are required' });
    const users = readUsers();
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase() && u.user_type === user_type))
      return jsonRes(res, 409, { error: 'That username already exists for this portal.' });
    users.push({ username, password: hashPassword(password), user_type, active: true, spaces: user_type === 'customer' ? spaces : [] });
    writeUsers(users);
    return jsonRes(res, 200, { ok: true });
  }

  if (url === '/admin/api/users' && req.method === 'PUT') {
    const { username, user_type, new_username, new_password, spaces } = body;
    if (!username || !user_type) return jsonRes(res, 400, { error: 'username and user_type required' });
    const users = readUsers();
    const idx = users.findIndex(u => u.username === username && u.user_type === user_type);
    if (idx === -1) return jsonRes(res, 404, { error: 'User not found' });
    if (new_username) users[idx].username = new_username;
    if (new_password) users[idx].password = hashPassword(new_password);
    if (spaces !== undefined && user_type === 'customer') users[idx].spaces = spaces;
    writeUsers(users);
    return jsonRes(res, 200, { ok: true });
  }

  if (url === '/admin/api/users' && req.method === 'DELETE') {
    const { username, user_type } = body;
    if (!username || !user_type) return jsonRes(res, 400, { error: 'username and user_type required' });
    const before = readUsers();
    const after  = before.filter(u => !(u.username === username && u.user_type === user_type));
    if (after.length === before.length) return jsonRes(res, 404, { error: 'User not found' });
    writeUsers(after);
    return jsonRes(res, 200, { ok: true });
  }

  if (url === '/admin/api/users/pause' && req.method === 'PATCH') {
    const { username, user_type } = body;
    if (!username || !user_type) return jsonRes(res, 400, { error: 'username and user_type required' });
    const users = readUsers();
    const idx = users.findIndex(u => u.username === username && u.user_type === user_type);
    if (idx === -1) return jsonRes(res, 404, { error: 'User not found' });
    users[idx].active = users[idx].active === false ? true : false;
    writeUsers(users);
    return jsonRes(res, 200, { ok: true, active: users[idx].active });
  }

  if (url === '/admin/api/logs' && req.method === 'GET') {
    return jsonRes(res, 200, { logs: readLogs() });
  }

  jsonRes(res, 404, { error: 'Not found' });
}

// ── Main server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url     = req.url || '/';
  const cookies = parseCookies(req.headers['cookie']);

  try {
    if (url === '/auth/logout') {
      res.writeHead(302, { 'Set-Cookie': clearSessionCookies(), 'Location': '/' });
      res.end();
      return;
    }

    if (url === '/auth/login' && req.method === 'POST') {
      const { username = '', password = '', user_type = '' } = parseForm(await readBody(req));
      if (!username.trim() || !password || !user_type) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage('All fields are required.'));
        return;
      }
      const users = readUsers();
      const user  = users.find(u =>
        u.username.toLowerCase() === username.trim().toLowerCase() && u.user_type === user_type
      );
      if (!user || !verifyPassword(password, user.password)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage('Incorrect username, password, or portal selection.'));
        return;
      }
      if (user.active === false) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage('This account is suspended. Contact your administrator.'));
        return;
      }
      writeLog({ timestamp: new Date().toISOString(), username: user.username, userType: user.user_type, action: 'login', details: 'Successful login', page: '/auth/login' });
      res.writeHead(302, { 'Set-Cookie': [...makeSessionCookies(user.username, user.user_type), 'freda_embed_mode=; Path=/; Max-Age=0; SameSite=Lax'], 'Location': '/' });
      res.end();
      return;
    }

    const session = cookies[SESSION_COOKIE] ? verifySession(cookies[SESSION_COOKIE]) : null;

    if (!session) {
      if (url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage());
      } else {
        res.writeHead(302, { 'Location': '/' });
        res.end();
      }
      return;
    }

    // Activity log endpoint — any authenticated user
    if (url === '/freda-log' && req.method === 'POST') {
      try {
        const b = JSON.parse(await readBody(req));
        writeLog({ timestamp: new Date().toISOString(), username: session.username, userType: session.userType, action: b.action || '', details: b.details || '', page: b.page || '' });
      } catch { /* ignore */ }
      res.writeHead(204); res.end();
      return;
    }

    // Admin users get the console
    if (session.userType === 'admin') {
      if (url.startsWith('/admin/api/')) {
        await handleAdminApi(req, res, url);
        return;
      }

      // Embed proxy: freda_embed_mode cookie routes to the correct React app at the
      // SAME URL path (avoids SSR hydration mismatch). Skip on root '/' so a fresh
      // admin page-load always lands on the gateway admin SPA, never a stale embed.
      const embedMode = cookies['freda_embed_mode'];
      if (embedMode && url !== '/') {
        if (embedMode === 'market') {
          if (url.startsWith('/api/') || url.startsWith('/docs') || url.startsWith('/redoc')) {
            proxy(req, res, BACKEND_PORT, session.username, session.userType);
          } else {
            proxy(req, res, MARKET_PORT, session.username, session.userType);
          }
          return;
        }
        if (embedMode === 'customer') {
          proxy(req, res, CUSTOMER_PORT, session.username, session.userType);
          return;
        }
      }

      // Serve admin SPA and clear any stale embed cookie
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'freda_embed_mode=; Path=/; Max-Age=0; SameSite=Lax' });
      res.end(adminPage());
      return;
    }

    // Proxy to the right app
    let targetPort;
    if (session.userType === 'customer') {
      targetPort = CUSTOMER_PORT;
    } else if (url.startsWith('/api/') || url.startsWith('/docs') || url.startsWith('/redoc')) {
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
  console.log(`[freda-auth] logs       → ${LOGS_FILE}`);
  console.log(`[freda-auth] market     → :${MARKET_PORT}  backend → :${BACKEND_PORT}  customer → :${CUSTOMER_PORT}`);
});

process.on('uncaughtException',  (e) => { console.error('[freda-auth] CRASH', e.message, e.stack); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[freda-auth] UNHANDLED REJECTION', e?.message || e); });
