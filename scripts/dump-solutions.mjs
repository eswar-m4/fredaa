// Prints the frontend solutions catalog (DATASETS from datasets.ts +
// vertical-datasets.ts) as JSON, so the Ask Freda catalog can be rebuilt from
// the same definitions the Playbooks pages use. Needs Node 22.13+ (built-in
// TypeScript type stripping); no npm packages.
//
//   node scripts/dump-solutions.mjs [path/to/any-site-reference]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const srcDir = resolve(process.argv[2] ?? join(import.meta.dirname, "..", "frontend", "src", "data", "any-site-reference"));
const outDir = mkdtempSync(join(tmpdir(), "freda-solutions-"));

try {
  for (const name of ["datasets", "vertical-datasets"]) {
    const ts = readFileSync(join(srcDir, `${name}.ts`), "utf8");
    const js = stripTypeScriptTypes(ts, { mode: "strip" })
      // ESM needs explicit extensions for the sibling import.
      .replace(/from\s+["']\.\/vertical-datasets["']/g, 'from "./vertical-datasets.mjs"')
      .replace(/from\s+["']\.\/datasets["']/g, 'from "./datasets.mjs"');
    writeFileSync(join(outDir, `${name}.mjs`), js);
  }
  const mod = await import(pathToFileURL(join(outDir, "datasets.mjs")).href);
  const pick = (d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    tagline: d.tagline ?? "",
    description: d.description ?? "",
    rowsAvailable: d.rowsAvailable ?? "",
    coverage: d.coverage ?? null,
    accuracy: d.accuracy ?? null,
    countriesCovered: d.countriesCovered ?? null,
    refreshDefault: d.refreshDefault ?? "",
    refreshOptions: d.refreshOptions ?? [],
    inputAttributes: (d.inputAttributes ?? []).map((a) => ({ key: a.key, label: a.label, required: !!a.required })),
    outputAttributes: (d.outputAttributes ?? []).map((a) => ({ key: a.key, label: a.label })),
    sources: (d.sources ?? []).map((s) => ({
      name: s.name,
      url: s.url ?? "",
      kind: s.kind ?? "",
      attributes: s.attributes ?? null,
      region: s.region ?? "",
    })),
    workflowId: d.workflowId ?? "",
  });
  process.stdout.write(JSON.stringify({ datasets: mod.DATASETS.map(pick), categories: mod.DATASET_CATEGORIES }));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
