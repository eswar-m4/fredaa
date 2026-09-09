import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
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
  server: { port: 5434, strictPort: true },
  plugins: [
    tanstackStart({
      start: { entry: "server" },
    }),
    tailwindcss(),
    tsConfigPaths(),
    devCrashGuardPlugin(),
  ],
});
