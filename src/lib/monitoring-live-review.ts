import { runMonitoringRefresh } from "@/lib/api/monitoring-refresh.functions";
import { getLiveRefreshProfile, type LiveRefreshProfile } from "@/lib/live-refresh-profiles";
import { xlsxRowsToReviewRecords, reviewRecordsFor, type Project, type ReviewRecord, type ChangeType } from "@/data/customers";
import type { LiveReviewData } from "@/components/ReviewDialog";

const STORAGE_PREFIX = "freda_live_review_";

/** Persists the result of a live "Run" so other screens (e.g. the Dashboard's
 *  Review button) can show the same data without re-running it. */
export function saveLiveReview(projectId: string, data: LiveReviewData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — the run still succeeded, just won't persist.
  }
}

/** Reads back the last live "Run" result for a project, if one was ever saved. */
export function loadLiveReview(projectId: string): LiveReviewData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    return raw ? (JSON.parse(raw) as LiveReviewData) : null;
  } catch {
    return null;
  }
}

/** Projects onboarded with real per-record URLs — their Review button runs a
 *  genuine live check against every URL instead of opening the static
 *  sample-file view. */
export function isLiveCheckable(p: Project): boolean {
  return getLiveRefreshProfile(p.id) !== null && p.sampleRows.length > 0 && p.columns.length > 0;
}

/** Runs the real live refresh for a live-checkable project and turns the
 *  result into the ReviewRecord[] shape ReviewDialog already knows how to
 *  render (Old → New, tagged Added/Deleted/Modified/Verified). */
export async function fetchLiveReview(project: Project): Promise<LiveReviewData> {
  const profile = getLiveRefreshProfile(project.id);
  if (!profile) throw new Error(`"${project.name}" isn't set up for live refresh.`);

  const targets = profile.currentValueRows.map((row, i) => ({
    id: row[profile.idField] || `row-${i}`,
    name: row[profile.nameField] || `Record ${i + 1}`,
    url: row[profile.urlField] || "",
    currentValues: row,
  }));

  const outcome = await runMonitoringRefresh({
    data: { config: profile.promptConfig, targets, fields: profile.extractableFields },
  });

  const records: ReviewRecord[] = [];
  const fetchErrors: { entity: string; error: string }[] = [];

  for (const record of outcome.results) {
    if (!record.reachable || record.diffs.length === 0) {
      if (record.error) fetchErrors.push({ entity: record.name, error: record.error });
      records.push({
        id: `${project.id}-live-${record.id}-status`,
        projectId: project.id,
        entity: record.name,
        datapoint: "Website check",
        oldValue: "Reachable",
        newValue: record.reachable ? (record.error ?? "Reachable — no field data") : "Unreachable",
        changeType: record.reachable ? "Verified" : "Deleted",
        confidence: 99,
        source: record.name,
        sourceUrl: record.url,
        detectedHrs: 0,
      });
      continue;
    }
    for (const d of record.diffs) {
      records.push({
        id: `${project.id}-live-${record.id}-${d.field}`,
        projectId: project.id,
        entity: record.name,
        datapoint: d.field,
        oldValue: d.oldValue || "—",
        newValue: d.newValue || "—",
        changeType: d.changeType,
        confidence: 95,
        source: record.name,
        sourceUrl: record.url,
        detectedHrs: 0,
      });
    }
  }

  const live: LiveReviewData = {
    records,
    checkedAt: outcome.checkedAt,
    aiConfigured: outcome.aiConfigured,
    reachableCount: outcome.reachableCount,
    totalCount: outcome.totalCount,
    fetchErrors,
  };
  saveLiveReview(project.id, live);
  return live;
}

export type RefreshedMonitoringTable = { columns: string[]; rows: Record<string, string>[]; sheetName: string };

const DISP_CODE: Record<ChangeType, string> = { Added: "A", Deleted: "D", Modified: "M", Verified: "V" };

/** entity name -> field -> diff, built once from a live run's flat records
 *  (skipping the "Website check" status placeholder, which isn't a field). */
function diffsByEntity(live: LiveReviewData) {
  const map = new Map<string, Map<string, { newValue: string; changeType: ChangeType }>>();
  for (const r of live.records) {
    if (r.datapoint === "Website check") continue;
    if (!map.has(r.entity)) map.set(r.entity, new Map());
    map.get(r.entity)!.set(r.datapoint, { newValue: r.newValue === "—" ? "" : r.newValue, changeType: r.changeType });
  }
  return map;
}

/** NTM Monitoring's template: one column per field, new value overwrites old
 *  in place. */
function buildFlatTable(project: Project, live: LiveReviewData | null, profile: LiveRefreshProfile): RefreshedMonitoringTable {
  const rows = project.sampleRows.map((row) => ({ ...row }));
  if (live) {
    const overlay = diffsByEntity(live);
    for (const row of rows) {
      const fieldMap = overlay.get(row[profile.nameField] ?? "");
      if (!fieldMap) continue;
      for (const [field, diff] of fieldMap) {
        if (field in row) row[field] = diff.newValue;
      }
    }
  }
  return { columns: project.columns, rows, sheetName: profile.outputSheetName };
}

/** NTM POI's template: each tracked field is three columns — Field (always
 *  the original value), New_Field (the refreshed value, blank if
 *  unchanged), Field_disp (V/A/D/M) — matching the exact layout of
 *  POI_Input and Output-25.xlsx's "Output" sheet. */
function buildDispositionTable(project: Project, live: LiveReviewData | null, profile: LiveRefreshProfile): RefreshedMonitoringTable {
  const rows = project.sampleRows.map((row) => ({ ...row }));
  if (!live) return { columns: project.columns, rows, sheetName: profile.outputSheetName };

  // Map each base field to its "New_<field>" and "<field>_disp" column
  // names as they actually appear in the template (case can vary, e.g. the
  // source file has both "TollfreeNbr_Disp" and "*_disp").
  const dispColumnFor = new Map<string, string>();
  const newColumnFor = new Map<string, string>();
  for (const col of project.columns) {
    const dispMatch = col.match(/^(.+)_(d|D)isp$/);
    if (dispMatch) dispColumnFor.set(dispMatch[1]!, col);
    if (col.startsWith("New_")) newColumnFor.set(col.slice(4), col);
  }

  const overlay = diffsByEntity(live);
  for (const row of rows) {
    const fieldMap = overlay.get(row[profile.nameField] ?? "");
    if (!fieldMap) continue;
    for (const [field, diff] of fieldMap) {
      const dispCol = dispColumnFor.get(field);
      const newCol = newColumnFor.get(field);
      if (!dispCol && !newCol) continue; // field isn't part of this template's tracked triples
      if (dispCol) row[dispCol] = DISP_CODE[diff.changeType];
      if (newCol) row[newCol] = diff.changeType === "Verified" ? "" : diff.newValue;
      // The base field column itself always keeps the original value —
      // that's the template's convention (New_Field carries the change).
    }
  }
  return { columns: project.columns, rows, sheetName: profile.outputSheetName };
}

/** Reconstructs the full per-record table in the same column layout as the
 *  project's original Output template, with any live-refreshed field values
 *  overlaid on top of the source rows. Returns null for projects that
 *  aren't live-refreshable. */
export function buildRefreshedMonitoringRows(project: Project): RefreshedMonitoringTable | null {
  const profile = getLiveRefreshProfile(project.id);
  if (!profile || !isLiveCheckable(project)) return null;
  const live = loadLiveReview(project.id);
  return profile.outputFormat === "disposition"
    ? buildDispositionTable(project, live, profile)
    : buildFlatTable(project, live, profile);
}

const POOL = 6000;

/** The same records ReviewDialog would show for this project right now —
 *  the last saved live run if one exists, otherwise the static sample data.
 *  Used to back the download button so it always exports what's on screen. */
export function recordsForDownload(project: Project): ReviewRecord[] {
  const live = loadLiveReview(project.id);
  if (live) return live.records;
  // Live-refresh-enabled projects must never fall back to the fabricated
  // sample-file records below (same reasoning as ReviewDialog) — an empty
  // download is the honest answer until a real "Run" has happened.
  if (isLiveCheckable(project)) return [];
  if (project.sampleRows && project.sampleRows.length > 0) {
    return xlsxRowsToReviewRecords(project);
  }
  return reviewRecordsFor(project, Math.min(POOL, Math.max(1200, project.pendingReview)));
}
