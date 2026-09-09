import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 5433, strictPort: true },
  plugins: [
    tanstackStart(),
    tailwindcss(),
    tsConfigPaths(),
  ],
});
