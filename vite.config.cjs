'use strict';
// CommonJS wrapper for the Lovable Vite config.
//
// WHY THIS FILE EXISTS:
// Vite compiles vite.config.ts into a temp .mjs inside node_modules/.vite-temp/.
// Node.js ESM resolution skips the parent node_modules/ when the importer is
// already inside node_modules/, so @lovable.dev/vite-tanstack-config can never
// be found from that temp file.  CommonJS require() does NOT have this restriction,
// so loading the config as .cjs bypasses the issue entirely.
//
// USAGE ON THE PRODUCTION SERVER:
//   npm run build:prod
// (Do NOT use this for local Lovable dev — use npm run build / vite dev instead.)

const { defineConfig } = require('@lovable.dev/vite-tanstack-config');

module.exports = defineConfig({
  tanstackStart: {
    server: { entry: 'server', preset: 'node-server' },
  },
});
