// Solutions that run on the shared FreDA backend pipeline — the same
// "By Dataset" job the market portal launches (/api/v1/demo/jobs/launch), so
// Firmographic Data and People & Contacts behave identically in both portals.
// Only the customer's uploaded rows are used: no demo or placeholder input,
// and a failed backend run surfaces its real reason instead of empty rows.
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

export function buildLaunchFilters(dataset: Dataset, selectedOutputs: string[], frequency: string, seedFile: string | null, seedRows: number) {
  return JSON.stringify({
    datasetId: dataset.id,
    workflowId: dataset.workflowId,
    selectedOutputs,
    outputFields: dataset.outputAttributes
      .filter((a) => selectedOutputs.includes(a.key))
      .map((a) => ({ key: a.key, label: a.label, group: a.group ?? "" })),
    pickedSources: dataset.sources.map((s) => s.name),
    excludedSources: [],
    seedRows,
    seedFile,
    frequency,
    sourceMode: "upload",
    portal: "customer",
  });
}

export type BackendRunResult = { jobId: string; records: Record<string, unknown>[] };

const POLL_MS = 5000;
const MAX_WAIT_MS = 30 * 60 * 1000;

/** Launches (or relaunches, when jobId is given) a backend By Dataset job and
 *  waits for it to finish. Throws with the backend's reason if it fails. */
export async function runBackendDatasetJob(params: {
  dataset: Dataset;
  inputRows: Record<string, string>[];
  filters: string;
  frequency: string;
  jobId?: string;
  onStatus?: (status: string) => void;
}): Promise<BackendRunResult> {
  const { dataset, inputRows, filters, frequency, onStatus } = params;
  if (!inputRows.length) throw new Error(`${dataset.name} needs uploaded input rows — upload a file or enter URLs.`);
  const jobId = params.jobId ?? `J-${Date.now()}`;
  const job = {
    id: jobId,
    source: dataset.name,
    dataset_name: dataset.name,
    scope: "By Dataset",
    filters,
    frequency,
    delivery: "Portal",
    output_format: "JSON",
    isCustomSource: false,
    mode: "By Dataset",
    status: "Running",
    created_at: new Date().toISOString(),
    input_data: inputRows,
  };
  const launch = await apiFetch("/api/v1/demo/jobs/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs: [job] }),
    timeoutMs: 60000,
  });
  if (!launch.ok) {
    const detail = await launch.json().catch(() => null);
    throw new Error(detail?.detail ? JSON.stringify(detail.detail) : `Backend rejected the launch (${launch.status})`);
  }

  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await apiFetch(`/api/v1/demo/jobs/${encodeURIComponent(jobId)}/records`, { timeoutMs: 30000 });
    if (!res.ok) throw new Error(`Could not read the backend run (${res.status})`);
    const data = await res.json();
    const status = String(data.status ?? "");
    onStatus?.(status);
    if (status === "Failed") throw new Error(data.error ? String(data.error) : "The backend run failed.");
    if (status !== "Running" && status !== "Refreshing") {
      return { jobId, records: Array.isArray(data.records) ? data.records : [] };
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("The backend run is taking longer than 30 minutes — it keeps running; check Monitor later.");
    }
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join("; ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

/** Backend run records -> flat string rows over the tracked fields, keyed so
 *  runs can be diffed (one stable key per row). Rows the run couldn't match
 *  (no data at all) are dropped rather than shown as blank records. */
export function rowsFromRun(records: Record<string, unknown>[], fields: string[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  records.forEach((rec, i) => {
    const row: Record<string, string> = {};
    for (const f of fields) row[f] = str(rec[f]);
    const sourceUrl = str(rec["_source_url"] ?? rec["source_url"]);
    if (sourceUrl) row.source_url = sourceUrl;
    if (!fields.some((f) => row[f])) return;
    row.__key = keyFor(row, i);
    rows.push(row);
  });
  return rows;
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function keyFor(row: Record<string, string>, i: number): string {
  const ident =
    row.email || row.linkedin_url || [row.full_name, row.company_domain || row.company_name].filter(Boolean).join("|") ||
    row.website || row.domain || row.legal_name || row.company_name;
  return (ident || `row-${i}`).toLowerCase();
}

export function nameFieldFor(datasetId: string, fields: string[]): string {
  const prefs = datasetId === "ds-contacts" ? ["full_name", "email", "company_name"] : ["legal_name", "company_name", "website", "domain"];
  return prefs.find((f) => fields.includes(f)) ?? fields[0] ?? "__key";
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
        source: hostOf(rec.row.source_url) || rec.name,
        sourceUrl: rec.row.source_url ?? "",
        detectedHrs: 0,
      });
    }
  }
  return records;
}
