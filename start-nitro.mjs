/**
 * Node.js HTTP adapter for the Nitro/TanStack Start build.
 *
 * WHY THIS EXISTS:
 * `npm run build:prod` uses @lovable.dev/vite-tanstack-config which defaults
 * to a Cloudflare-Workers-style module preset. The output dist/server/server.js
 * exports a { fetch } handler — it never calls listen() on its own. Static
 * assets land in dist/client/ and are expected to be served by a CDN/edge layer.
 * This wrapper serves dist/client/ assets directly and proxies everything else
 * to the Nitro SSR fetch handler so the app works on a plain Node.js server.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

process.on('uncaughtException', (e) => {
  console.error('[freda-customer] CRASH', e.message);
  console.error(e.stack);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('[freda-customer] UNHANDLED REJECTION', e?.message || e);
});

const PORT = parseInt(process.env.NITRO_PORT || process.env.PORT || '8132', 10);
const HOST = process.env.NITRO_HOST || process.env.HOST || '127.0.0.1';

const __dir = fileURLToPath(new URL('.', import.meta.url));
const CLIENT_DIR = resolve(__dir, '.output/public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain',
};

// index.mjs exports default: { fetch } (Cloudflare Workers style)
const { default: app } = await import('./.output/server/index.mjs');
const fetchFn = typeof app === 'function' ? app : app?.fetch;

if (typeof fetchFn !== 'function') {
  console.error('[freda-customer] ERROR: no fetch handler found in .output/server/index.mjs');
  process.exit(1);
}

function serveStatic(res, filePath, immutable = false) {
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const cacheControl = immutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    // Sanitise path to prevent directory traversal
    const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
    const candidate = join(CLIENT_DIR, safePath);

    // Serve static files from dist/client/ directly (immutable for /assets/)
    if (existsSync(candidate)) {
      const stat = statSync(candidate);
      if (stat.isFile()) {
        serveStatic(res, candidate, safePath.startsWith('/assets/'));
        return;
      }
      const idx = join(candidate, 'index.html');
      if (stat.isDirectory() && existsSync(idx)) {
        serveStatic(res, idx);
        return;
      }
    }

    // Everything else → Nitro SSR fetch handler
    const host = req.headers.host || `${HOST}:${PORT}`;
    const url = `http://${host}${req.url || '/'}`;

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val == null) continue;
      if (Array.isArray(val)) val.forEach((v) => headers.append(key, v));
      else headers.set(key, val);
    }

    const method = (req.method || 'GET').toUpperCase();
    let bodyInit = null;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length) bodyInit = Buffer.concat(chunks);
    }

    const webReq = new Request(url, {
      method,
      headers,
      body: bodyInit,
      ...(bodyInit ? { duplex: 'half' } : {}),
    });

    const cfCtx = {
      waitUntil: (p) => { p.catch(console.error); },
      passThroughOnException: () => {},
    };
    const webRes = await fetchFn(webReq, {}, cfCtx);

    const resHeaders = {};
    webRes.headers.forEach((v, k) => { resHeaders[k] = v; });
    res.writeHead(webRes.status, webRes.statusText || '', resHeaders);

    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error('[freda-customer] request error:', err?.message || err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[freda-customer] listening  → http://${HOST}:${PORT}`);
  console.log(`[freda-customer] static     → ${CLIENT_DIR}`);
});
