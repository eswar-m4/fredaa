'use strict';

module.exports = {
  apps: [
    // ── FastAPI backend (Python / uvicorn) ───────────────────────────────────
    {
      name: 'fredaa-backend',
      // Points to the venv Python so all pip-installed packages are available.
      // Create venv with: python -m venv venv  (inside ./backend)
      // pythonw.exe = Windows Python without a console window (python.exe pops a
      // visible terminal on every restart). Both executables run identically.
      script: './venv/Scripts/pythonw.exe',
      args: '-m uvicorn app.main:app --host 127.0.0.1 --port 8131 --workers 1',
      cwd: './backend',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        PYTHONPATH: '.',
        API_HOST: '127.0.0.1',
        API_PORT: '8131',
      },
    },

    // ── TanStack Start / Nitro SSR frontend ─────────────────────────────────
    {
      name: 'fredaa-frontend',
      // Nitro (build:prod) outputs a Cloudflare-Workers-style module that only
      // exports a fetch handler — it never binds to a port on its own.
      // start-nitro.mjs wraps that fetch handler in a real Node.js HTTP server.
      // Rebuild after code changes: cd frontend && npm run build:prod
      script: './frontend/start-nitro.mjs',
      cwd: '.',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        PORT: '8130',
        NITRO_PORT: '8130',
        HOST: '127.0.0.1',
        NITRO_HOST: '127.0.0.1',
        NODE_ENV: 'production',
      },
    },

    // ── Ask Freda Next.js app ────────────────────────────────────────────────
    {
      name: 'freda-ask-web',
      // Next's JS entry, not node_modules/.bin/next (a shell shim on Windows
      // that PM2 can't run with the node interpreter). Build first: npm run build.
      script: './node_modules/next/dist/bin/next',
      args: 'start --hostname 0.0.0.0 --port 43147',
      cwd: './ask-web',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: '43147',
      },
    },

    // ── Ask Freda engine (FastAPI) ───────────────────────────────────────────
    // The backend's Ask Freda chat calls this on 127.0.0.1:43148
    // (ASK_FREDA_ENGINE_URL). app.py only defines the app, so it must run
    // under uvicorn — `python app.py` exits immediately and crash-loops.
    // Create its venv with: python -m venv venv && venv\Scripts\pip install -r requirements.txt
    // (inside ./engine). OPENAI_API_KEY goes in engine/.env.
    {
      name: 'freda-engine',
      script: './venv/Scripts/pythonw.exe',
      args: '-m uvicorn app:app --host 127.0.0.1 --port 43148 --workers 1',
      cwd: './engine',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
