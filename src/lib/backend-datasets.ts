// Jobs on the shared FreDA backend — the same jobs the market portal runs.
// Solutions (By Dataset) such as Firmographic Data / People & Contacts and
// Agents (Site-Specific) such as BSE or National Grid. Only the customer's
// own input is sent: no demo or placeholder rows, and a failed run surfaces
// the backend's real reason instead of empty data.
import { apiFetch } from "@/lib/api";
import type { Dataset } from "@/data/datasets";
import type { ReviewRecord } from "@/data/customers";
import { diffRegistrySnapshot } from "@/lib/api/registry-refresh.core";

/** Catalog solutions launched through the backend pipeline. */
export const BACKEND_DATASET_IDS = new Set(["ds-firmographic", "ds-contacts"]);

export function isBackendDataset(datasetId: string): boolean {
  return BACKEND_DATASET_IDS.has(datasetId);
}

export type ParsedUpload = { headers: string[]; records: Record<string, string>[] };

/** Parses a CSV/XLSX upload with the backend's parser (same as the market portal). */
export async function parseUploadViaBackend(file: File): Promise<ParsedUpload> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch("/api/v1/workflows/parse-file", { method: "POST", body: form, timeoutMs: 120000 });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ? String(detail.detail) : `File parsing failed (${res.status})`);
  }
  const parsed = await res.json();
  const headers = Array.isArray(parsed.columns) ? parsed.columns.map((h: unknown) => String(h)) : [];
  const records = (Array.isArray(parsed.records) ? parsed.records : []).map((row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])),
  );
  return { headers, records };
}

/** Input rows for typed/pasted URLs when no file was uploaded. */
export function rowsFromUrls(datasetId: string, urls: string[]): Record<string, string>[] {
  const column = datasetId === "ds-contacts" ? "company_domain" : "website";
  return urls.map((u) => u.trim()).filter(Boolean).map((u) => ({ [column]: u }));
}

/** The By Dataset job the market portal's Solutions page sends for a dataset. */
export function buildSolutionJob(params: {
  dataset: Dataset;
  inputRows: Record<string, string>[];
  selectedOutputs: string[];
  frequency: string;
  seedFile: string | null;
  pickedSources?: string[];
  excludedSources?: string[];
  delivery?: string;
  format?: string;
  detectedRegion?: string;
}): Record<string, unknown> {
  const { dataset, inputRows, selectedOutputs, frequency, seedFile } = params;
  const filters = JSON.stringify({
    datasetId: dataset.id,
    workflowId: dataset.workflowId,
    selectedOutputs,
    outputFields: dataset.outputAttributes
      .filter((a) => selectedOutputs.includes(a.key))
      .map((a) => ({ key: a.key, label: a.label, group: a.group ?? "" })),
    pickedSources: params.pickedSources ?? dataset.sources.map((s) => s.name),
    excludedSources: params.excludedSources ?? [],
    seedRows: inputRows.length,
    frequency,
    delivery: params.delivery ?? "Portal",
    format: params.format ?? "JSON",
    sourceMode: "upload",
    detectedRegion: params.detectedRegion,
    seedFile,
    portal: "customer",
  });
  return {
    id: `J-${Date.now()}`,
    source: dataset.name,
    dataset_name: dataset.name,
    seed_file: seedFile,
    scope: "By Dataset",
    filters,
    frequency,
    delivery: params.delivery ?? "Portal",
    output_format: params.format ?? "JSON",
    isCustomSource: false,
    mode: "By Dataset",
    status: "Running",
    created_at: new Date().toISOString(),
    input_data: inputRows,
  };
}

/** Starts (or reruns, same id) backend jobs. Throws with the backend's reason. */
export async function launchBackendJobs(jobs: Record<string, unknown>[]): Promise<void> {
  const res = await apiFetch("/api/v1/demo/jobs/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs: jobs.map((j) => ({ ...j, status: j.status ?? "Running", created_at: new Date().toISOString() })) }),
    timeoutMs: 60000,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const reason = detail?.detail ? (typeof detail.detail === "string" ? detail.detail : JSON.stringify(detail.detail)) : `HTTP ${res.status}`;
    throw new Error(`The FreDA backend rejected the launch: ${reason}`);
  }
}

export type BackendJobState = { status: string; error: string | null; records: Record<string, unknown>[]; done: boolean };

const RUNNING = new Set(["Running", "Refreshing"]);

/** One status check of a backend job. */
export async function checkBackendJob(jobId: string): Promise<BackendJobState> {
  const res = await apiFetch(`/api/v1/demo/jobs/${encodeURIComponent(jobId)}/records`, { timeoutMs: 30000 });
  if (!res.ok) throw new Error(`Could not read backend job ${jobId} (HTTP ${res.status})`);
  const data = await res.json();
  const status = String(data.status ?? "");
  return {
    status,
    error: data.error ? String(data.error) : null,
    records: Array.isArray(data.records) ? data.records : [],
    done: !RUNNING.has(status),
  };
}

/** Jobs a page is actively waiting on — the background sync leaves these
 *  alone so a finished run is never applied twice. */
export const awaitedJobs = new Set<string>();

/** Waits for a backend job (used by Monitor "Run"). */
export async function waitForBackendJob(jobId: string, maxWaitMs = 30 * 60 * 1000): Promise<BackendJobState> {
  const started = Date.now();
  awaitedJobs.add(jobId);
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const state = await checkBackendJob(jobId);
      if (state.done) {
        if (state.status === "Failed") throw new Error(state.error ?? "The backend run failed.");
        return state;
      }
      if (Date.now() - started > maxWaitMs) throw new Error("The backend run is still going after 30 minutes — check Monitor again later.");
    }
  } finally {
    awaitedJobs.delete(jobId);
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join("; ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

const SKIP_KEYS = /^(_|id$|run_id$|timestamp$|scraped_at$|created_at$)/;

/** Field keys for an agent run, from the data itself (first-seen order). */
export function deriveFields(records: Record<string, unknown>[]): string[] {
  const seen: string[] = [];
  for (const rec of records.slice(0, 200)) {
    for (const k of Object.keys(rec ?? {})) {
      if (!SKIP_KEYS.test(k) && !seen.includes(k)) seen.push(k);
    }
  }
  return seen.slice(0, 60);
}

/** Backend run records -> flat string rows over the tracked fields, each with
 *  a stable __key so runs can be diffed. Rows with no data are dropped. */
export function rowsFromRun(records: Record<string, unknown>[], fields: string[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const used = new Map<string, number>();
  records.forEach((rec, i) => {
    const row: Record<string, string> = {};
    for (const f of fields) row[f] = str(rec[f]);
    const sourceUrl = str(rec["_source_url"] ?? rec["source_url"]);
    if (sourceUrl) row.source_url = sourceUrl;
    if (!fields.some((f) => row[f])) return;
    let key = keyFor(row, fields, i);
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n) key = `${key}#${n}`;
    row.__key = key;
    rows.push(row);
  });
  return rows;
}

function keyFor(row: Record<string, string>, fields: string[], i: number): string {
  const preferred =
    row.email || row.linkedin_url || [row.full_name, row.company_domain || row.company_name].filter(Boolean).join("|") ||
    row.website || row.domain || row.legal_name || row.company_name || row.cin || row.isin || row.ticker;
  const fallback = fields.slice(0, 2).map((f) => row[f]).filter(Boolean).join("|");
  return (preferred || fallback || `row-${i}`).toLowerCase();
}

export function nameFieldFor(fields: string[], datasetId?: string): string {
  const prefs =
    datasetId === "ds-contacts"
      ? ["full_name", "email", "company_name"]
      : ["legal_name", "company_name", "name", "full_name", "title", "company", "website", "domain"];
  return prefs.find((f) => fields.includes(f)) ?? fields.find((f) => /name|title|company/i.test(f)) ?? fields[0] ?? "__key";
}

export function humanize(field: string): string {
  return field.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Review records for a run, diffed against the previous run's rows (empty on
 *  the first run, so every value is Added with no old value). */
export function reviewRecordsFor(
  projectId: string,
  previousRows: Record<string, string>[],
  rows: Record<string, string>[],
  nameField: string,
  fields: string[],
  includeRemoved: boolean,
  fallbackSource = "",
): ReviewRecord[] {
  const diffed = diffRegistrySnapshot(previousRows, rows, "__key", nameField, fields, includeRemoved);
  const records: ReviewRecord[] = [];
  for (const rec of diffed) {
    for (const d of rec.diffs) {
      records.push({
        id: `${projectId}-backend-${rec.key}-${rec.index}-${d.field}`,
        projectId,
        entity: rec.name,
        datapoint: d.field,
        oldValue: d.oldValue || "—",
        newValue: d.newValue || "—",
        changeType: d.changeType,
        confidence: 90,
        source: hostOf(rec.row.source_url) || fallbackSource || rec.name,
        sourceUrl: rec.row.source_url ?? "",
        detectedHrs: 0,
      });
    }
  }
  return records;
}
