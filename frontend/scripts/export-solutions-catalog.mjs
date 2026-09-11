// Exports the real 19-solution catalog (frontend/src/data/any-site-reference/
// datasets.ts + vertical-datasets.ts, merged) to a static JSON snapshot the
// Python backend can load without needing a JS runtime — same pattern as
// frontend/src/data/bots.json already serves as the agents catalog snapshot.
//
// Re-run this whenever the solutions catalog data changes:
//   node frontend/scripts/export-solutions-catalog.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = join(__dirname, "..");
const REPO_ROOT = join(FRONTEND_ROOT, "..");
const ENTRY = join(FRONTEND_ROOT, "src/data/any-site-reference/datasets.ts");
const OUT_JSON = join(REPO_ROOT, "backend/app/data/solutions_catalog.json");
const ESBUILD = join(FRONTEND_ROOT, "node_modules/.bin/esbuild" + (process.platform === "win32" ? ".cmd" : ""));

const bundlePath = join(tmpdir(), `solutions-catalog-bundle-${Date.now()}.mjs`);

execFileSync(ESBUILD, [ENTRY, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundlePath}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

const mod = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
const datasets = mod.DATASETS;

if (!Array.isArray(datasets) || datasets.length === 0) {
  throw new Error("No DATASETS exported — export shape may have changed.");
}

const solutions = datasets.map((d) => ({
  id: d.id,
  name: d.name,
  category: d.category,
  tagline: d.tagline,
  description: d.description,
  refreshDefault: d.refreshDefault,
  coverage: d.coverage ?? null,
  accuracy: d.accuracy ?? null,
  countriesCovered: d.countriesCovered ?? null,
  rowsAvailable: d.rowsAvailable ?? null,
  sources: (d.sources || []).map((s) => ({ name: s.name, kind: s.kind ?? null })),
  outputFieldLabels: (d.outputAttributes || []).map((f) => f.label),
  outputFieldCount: (d.outputAttributes || []).length,
}));

mkdirSync(dirname(OUT_JSON), { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify({ solutions }, null, 2), "utf-8");

rmSync(bundlePath, { force: true });

console.log(`Exported ${solutions.length} solutions to ${OUT_JSON}`);
