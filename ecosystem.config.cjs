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
  ],
};
