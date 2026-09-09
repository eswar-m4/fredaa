import { defineConfig } from "@tanstack/react-start/config";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  vite: {
    server: { port: 5433, strictPort: true },
    plugins: [tailwindcss(), tsConfigPaths()],
  },
  server: {
    entry: "server",
    preset: "node-server",
  },
});
