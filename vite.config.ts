// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

// src/lib/error-capture.ts wires globalThis.addEventListener('error'/'unhandledrejection'),
// which is how the *production* Cloudflare Workers runtime reports uncaught errors — but
// `vite dev` runs on plain Node, which doesn't dispatch those as global events. So in dev,
// a genuine Node-level uncaught exception or unhandled promise rejection (e.g. a server
// function or SSR codepath that throws outside the request's own try/catch) hits Node's
// default behavior: the whole process exits, closing the terminal with no visible error and
// leaving "localhost refused to connect". This plugin adds the missing dev-mode safety net —
// log the real error and keep the server alive, instead of a silent hard crash.
function devCrashGuardPlugin(): Plugin {
  return {
    name: "freda-dev-crash-guard",
    apply: "serve",
    configureServer() {
      process.on("unhandledRejection", (reason) => {
        console.error("\n[dev-crash-guard] Unhandled promise rejection — server stayed up. Root cause:\n", reason);
      });
      process.on("uncaughtException", (err) => {
        console.error("\n[dev-crash-guard] Uncaught exception — server stayed up. Root cause:\n", err);
      });
    },
  };
}

export default defineConfig({
  vite: {
    server: { port: 5434, strictPort: true },
    plugins: [devCrashGuardPlugin()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
