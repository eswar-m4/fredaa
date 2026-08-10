/**
 * Node.js HTTP adapter for the Nitro/TanStack Start build.
 *
 * WHY THIS EXISTS:
 * `npm run build:prod` uses @lovable.dev/vite-tanstack-config which defaults
 * to a Cloudflare-Workers-style module preset. The output dist/server/server.js
 * exports a { fetch } handler — it never calls listen() on its own.
 * This wrapper imports that fetch handler and binds it to a real TCP port so
 * PM2 can serve it like a normal Node.js server.
 */

import { createServer } from 'node:http';

process.on('uncaughtException', (e) => {
  console.error('[fredaa-frontend] CRASH', e.message);
  console.error(e.stack);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('[fredaa-frontend] UNHANDLED REJECTION', e?.message || e);
});

const PORT = parseInt(process.env.NITRO_PORT || process.env.PORT || '8130', 10);
const HOST = process.env.NITRO_HOST || process.env.HOST || '127.0.0.1';

// server.js exports default: { fetch } (Cloudflare Workers style)
const { default: app } = await import('./dist/server/server.js');
const fetchFn = typeof app === 'function' ? app : app?.fetch;

if (typeof fetchFn !== 'function') {
  console.error('[fredaa-frontend] ERROR: no fetch handler found in dist/server/server.js. Got:', app);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
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

    const webRes = await fetchFn(webReq, {}, {});

    const resHeaders = {};
    webRes.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });
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
    console.error('[fredaa-frontend] request error:', err?.message || err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[fredaa-frontend] listening  → http://${HOST}:${PORT}`);
});
