// Turn a "By Request" entity list into an upload-ready file that matches the
// By Dataset input template, and hand it over to the By Dataset flow.
import { DATASETS, type Dataset } from "@/data/datasets";
import type { EntityRow } from "@/lib/discovery";

const HANDOFF_KEY = "fd_request_list";

export type RequestHandoff = {
  datasetId: string;
  fileName: string;
  headers: string[];
  records: Record<string, string>[];
};

/** Best-matching dataset template for a suggested category. */
export function templateDatasetFor(category?: string | null): Dataset | null {
  if (!category) return null;
  const parts = category
    .split(/[→>|/]/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const withTemplate = DATASETS.filter((d) => (d.inputTemplateColumns?.length ?? 0) > 0);
  for (const c of parts) {
    const hit =
      withTemplate.find((d) => d.category.toLowerCase() === c) ||
      withTemplate.find((d) => d.name.toLowerCase().includes(c) || c.includes(d.name.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function valueFor(key: string, e: EntityRow): string {
  const k = key.toLowerCase();
  if (/(website|domain|url)/.test(k)) return e.website;
  if (/(city|location)/.test(k)) return e.city;
  if (/phone|contact_number|mobile/.test(k)) return e.phone;
  if (/address/.test(k)) return e.address;
  if (/state|region/.test(k)) return "";
  if (/name|firm|provider|venue|company|brand|insurer|attorney/.test(k)) return e.name;
  return "";
}

/** Map discovered entities onto the dataset's input template columns. */
export function entitiesToTemplateRows(ds: Dataset, entities: EntityRow[]) {
  const cols = (ds.inputTemplateColumns?.length ? ds.inputTemplateColumns : ds.inputAttributes).map((c) => c.key);
  const headers = [...new Set([...cols, "website", "city", "phone", "address"])];
  const records = entities.map((e) => {
    const row: Record<string, string> = {};
    headers.forEach((h) => (row[h] = valueFor(h, e)));
    return row;
  });
  return { headers, records };
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildCsv(headers: string[], records: Record<string, string>[]) {
  return [headers.join(","), ...records.map((r) => headers.map((h) => csvCell(r[h] ?? "")).join(","))].join("\n");
}

export function downloadCsv(fileName: string, headers: string[], records: Record<string, string>[]) {
  const blob = new Blob([buildCsv(headers, records)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function stashRequestList(payload: RequestHandoff) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
}

export function takeRequestList(): RequestHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(HANDOFF_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(HANDOFF_KEY);
  try {
    return JSON.parse(raw) as RequestHandoff;
  } catch {
    return null;
  }
}
