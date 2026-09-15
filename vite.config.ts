import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import type { Plugin } from "vite";

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

export default defineConfig(({ mode }) => {
  // Vite's own dotenv loading only exposes VITE_-prefixed vars to the app —
  // server-only secrets like OPENAI_API_KEY (no prefix, deliberately, so
  // they never ship to the browser) never reach process.env on their own.
  // Server functions (monitoring-refresh.functions.ts etc.) read
  // process.env directly, so copy the full .env into this Node process here,
  // once, at config load — before any server function ever runs.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    server: { port: 5434, strictPort: true },
    plugins: [
      tanstackStart(), // MUST come before viteReact() — required order per TanStack Start's own docs
      viteReact(),
      tailwindcss(),
      tsConfigPaths(),
      devCrashGuardPlugin(),
    ],
  };
});
