'use strict';

/**
 * Zero-dependency Node.js static file server for the Freda customer portal.
 * Used as a fallback if the Nitro SSR server is not available.
 * Serves the Vite/Nitro build output with SPA fallback to index.html.
 * Managed by PM2 via ecosystem.config.cjs — do not run directly in production.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');

const PORT = parseInt(process.env.PORT || '8132', 10);
const HOST = process.env.HOST || '127.0.0.1';

// TanStack Start + Nitro outputs to .output/public/
const CANDIDATES = [
  path.join(__dirname, '.output', 'public'),
  path.join(__dirname, 'dist', 'client'),
  path.join(__dirname, 'dist'),
];
const STATIC_DIR = CANDIDATES.find((d) => fs.existsSync(d));

if (!STATIC_DIR) {
  console.error(
    '[freda-customer] ERROR: No built frontend found.\n' +
      'Run the following first:\n' +
      '  npm install --include=dev && npm run build:prod\n' +
      'Searched:\n  ' +
      CANDIDATES.join('\n  ')
  );
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const isImmutable = filePath.includes(path.sep + 'assets' + path.sep);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url || '/');
  const safe = path.normalize(decodeURIComponent(pathname || '/')).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(STATIC_DIR, safe);

  fs.stat(target, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(res, target);
    } else if (!err && stat.isDirectory()) {
      const idx = path.join(target, 'index.html');
      fs.stat(idx, (e2, s2) => {
        if (!e2 && s2.isFile()) {
          sendFile(res, idx);
        } else {
          sendFile(res, path.join(STATIC_DIR, 'index.html'));
        }
      });
    } else {
      sendFile(res, path.join(STATIC_DIR, 'index.html'));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[freda-customer] listening  → http://${HOST}:${PORT}`);
  console.log(`[freda-customer] serving    → ${STATIC_DIR}`);
});
