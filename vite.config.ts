import { defineConfig } from "@tanstack/react-start/config";
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

export default defineConfig({
  vite: {
    server: { port: 5434, strictPort: true },
    plugins: [tailwindcss(), tsConfigPaths(), devCrashGuardPlugin()],
  },
  server: {
    entry: "server",
    preset: "node-server",
  },
});
