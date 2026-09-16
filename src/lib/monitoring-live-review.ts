import { runMonitoringRefresh } from "@/lib/api/monitoring-refresh.functions";
import { runEcaOnRegistryRefresh, runMeatListRegistryRefresh, runAbmDirectoryRegistryRefresh } from "@/lib/api/registry-refresh.functions";
import { diffRegistrySnapshot, type RegistryLiveOutcome } from "@/lib/api/registry-refresh.core";
import { runSecEdgarLookup } from "@/lib/api/sec-edgar.functions";
import type { SecEdgarProfile } from "@/lib/api/sec-edgar.core";
import { runDirectoryExtraction } from "@/lib/api/directory-extract.functions";
import type { FieldDiff, RefreshTarget } from "@/lib/api/monitoring-refresh.core";
import {
  getLiveRefreshProfile,
  CANADA_REGISTRY_PORTAL_CONFIG,
  CANADA_REGISTRY_PORTAL_FIELDS,
  type LiveRefreshProfile,
  type RegistryLiveRefreshProfile,
  type DirectoryLiveRefreshProfile,
} from "@/lib/live-refresh-profiles";
import { xlsxRowsToReviewRecords, reviewRecordsFor, reviewStatusFor, type Project, type ProjectStatus, type ReviewRecord, type ChangeType } from "@/data/customers";
import type { LiveReviewData } from "@/components/ReviewDialog";
import { clearReviewProgress } from "@/lib/review-status";
import { saveLiveReview, LIVE_REVIEW_STORAGE_PREFIX as STORAGE_PREFIX, LIVE_REVIEW_CACHE_VERSION as CACHE_VERSION } from "@/lib/live-review-store";

export { saveLiveReview } from "@/lib/live-review-store";

/** Reads back the last live "Run" result for a project, if one was ever saved
 *  AND it's still trustworthy: it must match the profile currently bound to
 *  that project id (a run cached before a project reorder/rebind is
 *  discarded rather than shown as if it were current), and it must have
 *  been produced by the current CACHE_VERSION of this code (a run cached
 *  before a fix to how records are built is discarded the same way, rather
 *  than surfacing the old, now-wrong shape forever). */
export function loadLiveReview(projectId: string): LiveReviewData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as LiveReviewData;
    if (data.cacheVersion !== CACHE_VERSION) return null;
    const currentKind = getLiveRefreshProfile(projectId)?.kind;
    if (data.profileKind && currentKind && data.profileKind !== currentKind) return null;
    return data;
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

/** The Monitor page's status badge, derived from the same real signals the
 *  Review page uses — not the static seeded status, so the two pages can
 *  never disagree about whether a project's review is actually done.
 *    - actively running a live check right now → "Syncing"
 *    - last live check had a source that failed/was unreachable → "Needs attention"
 *    - review fully submitted (reviewStatusFor === "Completed") → "In sync"
 *    - otherwise → "Review pending" (covers both "not started" and "partial") */
export function monitorStatusFor(p: Project, isRunning = false): ProjectStatus {
  if (isRunning) return "Syncing";
  const live = loadLiveReview(p.id);
  if (live && live.fetchErrors.length > 0) return "Needs attention";
  return reviewStatusFor(p) === "Completed" ? "In sync" : "Review pending";
}

// Which of a webpage-kind profile's own field keys SEC EDGAR can actually
// answer — this only works because custom-projects.ts's Firmographic/
// Registry profiles use these exact key names (matching the real dataset's
// own output attributes), so no per-dataset mapping table is needed.
const SEC_EDGAR_FIELD_KEYS = new Set([
  "legal_name", "sic_code", "industry", "registry_number",
  "hq_address", "hq_city", "hq_state", "hq_country", "phone", "company_type",
]);

/** Looks up every target's entity name in the real SEC EDGAR registry, in
 *  parallel — misses (private company, no confident match, SEC rate limit)
 *  come back as null and simply leave the AI-webpage result untouched. */
async function fetchSecEdgarOverlays(targets: RefreshTarget[]): Promise<Map<string, SecEdgarProfile | null>> {
  const entries = await Promise.all(
    targets.map(async (t) => [t.id, await runSecEdgarLookup({ data: { companyName: t.name } })] as const),
  );
  return new Map(entries);
}

/** Merges a real SEC EDGAR profile into an AI-webpage diff set — SEC wins
 *  for the fields it's actually authoritative for (a marketing page is not
 *  a reliable source for a SIC code), everything else stays exactly what
 *  the webpage check found. Only touches fields the project actually
 *  tracks (extractableFields), and only when SEC returned a real value. */
function applySecEdgarOverlay(
  diffs: FieldDiff[],
  secProfile: SecEdgarProfile,
  baseline: Record<string, string>,
  extractableFields: string[],
): (FieldDiff & { fromRegistry?: boolean })[] {
  const byField = new Map(diffs.map((d) => [d.field, d as FieldDiff & { fromRegistry?: boolean }]));
  for (const field of extractableFields) {
    if (!SEC_EDGAR_FIELD_KEYS.has(field)) continue;
    const secValue = (secProfile as unknown as Record<string, string>)[field];
    if (!secValue || !secValue.trim()) continue;
    const oldValue = (baseline[field] ?? byField.get(field)?.oldValue ?? "").trim();
    const changeType: ChangeType = !oldValue ? "Added" : oldValue.trim() === secValue.trim() ? "Verified" : "Modified";
    byField.set(field, { field, oldValue, newValue: secValue, changeType, fromRegistry: true });
  }
  return [...byField.values()];
}

/** Runs the real live refresh for a live-checkable project and turns the
 *  result into the ReviewRecord[] shape ReviewDialog already knows how to
 *  render (Old → New, tagged Added/Deleted/Modified/Verified). */
export async function fetchLiveReview(project: Project): Promise<LiveReviewData> {
  const profile = getLiveRefreshProfile(project.id);
  if (!profile) throw new Error(`"${project.name}" isn't set up for live refresh.`);

  if (profile.kind === "registry") return fetchRegistryLiveReview(project, profile);
  if (profile.kind === "directory") return fetchDirectoryLiveReview(project, profile);

  const targets = profile.currentValueRows.map((row, i) => ({
    id: row[profile.idField] || `row-${i}`,
    name: row[profile.nameField] || `Record ${i + 1}`,
    url: row[profile.urlField] || "",
    currentValues: row,
  }));

  const [outcome, secProfiles] = await Promise.all([
    runMonitoringRefresh({
      data: { config: profile.promptConfig, targets, fields: profile.extractableFields },
    }),
    profile.usesSecEdgarOverlay ? fetchSecEdgarOverlays(targets) : Promise.resolve(null),
  ]);

  const records: ReviewRecord[] = [];
  const fetchErrors: { entity: string; error: string }[] = [];

  for (const record of outcome.results) {
    const target = targets.find((t) => t.id === record.id);
    const secProfile = secProfiles?.get(record.id) ?? null;
    const diffs: (FieldDiff & { fromRegistry?: boolean })[] = secProfile
      ? applySecEdgarOverlay(record.diffs, secProfile, target?.currentValues ?? {}, profile.extractableFields)
      : record.diffs;

    if (diffs.length === 0) {
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
    if (!record.reachable && record.error) {
      // The company's own site failed, but SEC EDGAR still answered some
      // fields — surface both: the failure, and what SEC did find.
      fetchErrors.push({ entity: record.name, error: record.error });
    }
    for (const d of diffs) {
      records.push({
        id: `${project.id}-live-${record.id}-${d.field}`,
        projectId: project.id,
        entity: record.name,
        datapoint: d.field,
        oldValue: d.oldValue || "—",
        newValue: d.newValue || "—",
        changeType: d.changeType,
        confidence: d.fromRegistry ? 99 : 95,
        source: d.fromRegistry ? "SEC EDGAR (registry lookup)" : record.name,
        sourceUrl: d.fromRegistry ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${secProfile?.registry_number ?? ""}` : record.url,
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
    profileKind: profile.kind,
  };
  saveLiveReview(project.id, live);
  // A fresh live run can change the record set entirely — don't let a prior
  // submission's progress against the old set keep reading as complete.
  clearReviewProgress(project.id);
  return live;
}

/** Each registry has its own fetch shape (ArcGIS query vs. HTML table
 *  scrape) — this is the one place that knows which server function to
 *  call for a given profile's registryId, so fetchRegistryLiveReview below
 *  stays agnostic to how any particular registry is actually fetched. */
const REGISTRY_FETCHERS: Record<RegistryLiveRefreshProfile["registryId"], () => Promise<RegistryLiveOutcome>> = {
  eca_on: runEcaOnRegistryRefresh,
  meatlist: runMeatListRegistryRefresh,
  abm_directory: runAbmDirectoryRegistryRefresh,
};

/** "registry" kind — queries the live bulk database API directly (no LLM
 *  involved, there's no page to read) and diffs the fresh rows against the
 *  on-file snapshot by the profile's stable key field. Runs in parallel
 *  with an AI-webpage check of the profile's companion registries (real
 *  reachable pages without a structured API), so "Run" covers every real
 *  source that actually responds, not just the one with a clean API. */
async function fetchRegistryLiveReview(project: Project, profile: RegistryLiveRefreshProfile): Promise<LiveReviewData> {
  const companions = profile.companionWebpages ?? [];

  const [outcome, companionOutcome] = await Promise.all([
    REGISTRY_FETCHERS[profile.registryId](),
    companions.length > 0
      ? runMonitoringRefresh({
          data: {
            config: CANADA_REGISTRY_PORTAL_CONFIG,
            targets: companions.map((c) => ({ id: c.id, name: c.name, url: c.url, currentValues: {} })),
            fields: CANADA_REGISTRY_PORTAL_FIELDS,
          },
        })
      : Promise.resolve(null),
  ]);

  const records: ReviewRecord[] = [];
  const fetchErrors: { entity: string; error: string }[] = [];
  let reachableCount = 0;
  const totalCount = 1 + companions.length;

  if (!outcome.reachable) {
    fetchErrors.push({ entity: `${profile.registryId} registry query`, error: outcome.error ?? "Unknown error" });
  } else {
    reachableCount += 1;
    // Some registry fetchers merge several real sub-sources (e.g. ABM's
    // directory listings) — reachable=true just means at least one
    // succeeded, so a partial failure still needs surfacing honestly.
    if (outcome.error) fetchErrors.push({ entity: `${profile.registryId} registry query`, error: outcome.error });
    const diffed = diffRegistrySnapshot(profile.currentValueRows, outcome.rows, profile.keyField, profile.nameField, profile.extractableFields);
    for (const rec of diffed) {
      for (const d of rec.diffs) {
        records.push({
          id: `${project.id}-live-${rec.key}-${rec.index}-${d.field}`,
          projectId: project.id,
          entity: rec.name,
          datapoint: d.field,
          oldValue: d.oldValue || "—",
          newValue: d.newValue || "—",
          changeType: d.changeType,
          confidence: 99,
          source: rec.name,
          sourceUrl: profile.buildSourceUrl?.(rec.row) || profile.sourceUrl,
          detectedHrs: 0,
        });
      }
    }
  }

  if (companionOutcome) {
    for (const c of companionOutcome.results) {
      if (!c.reachable) {
        if (c.error) fetchErrors.push({ entity: c.name, error: c.error });
        records.push({
          id: `${project.id}-live-${c.id}-status`,
          projectId: project.id,
          entity: c.name,
          datapoint: "Portal check",
          oldValue: "Reachable",
          newValue: c.error ?? "Unreachable",
          changeType: "Deleted",
          confidence: 99,
          source: c.name,
          sourceUrl: c.url,
          detectedHrs: 0,
        });
        continue;
      }
      reachableCount += 1;
      for (const d of c.diffs) {
        records.push({
          id: `${project.id}-live-${c.id}-${d.field}`,
          projectId: project.id,
          entity: c.name,
          datapoint: d.field,
          oldValue: d.oldValue || "—",
          newValue: d.newValue || "—",
          changeType: d.changeType === "Added" ? "Verified" : d.changeType, // no baseline for these — "found on the page" isn't a real Added
          confidence: 92,
          source: c.name,
          sourceUrl: c.url,
          detectedHrs: 0,
        });
      }
    }
  }

  const live: LiveReviewData = {
    records,
    checkedAt: outcome.checkedAt,
    aiConfigured: companions.length === 0 || (companionOutcome?.aiConfigured ?? true),
    reachableCount,
    totalCount,
    fetchErrors,
    profileKind: profile.kind,
  };
  saveLiveReview(project.id, live);
  clearReviewProgress(project.id);
  return live;
}

/** "directory" kind — re-scrapes every configured directory/listing page
 *  (real HTTP fetch + AI extraction of every entity that page names, see
 *  directory-extract.core.ts), merges the results, and diffs the combined
 *  row set against the on-file baseline by the profile's key field —
 *  reuses the exact same diffRegistrySnapshot() the registry kind uses,
 *  since "diff a fresh row set against a baseline by key" is identical
 *  either way; only how the fresh rows are obtained differs. */
async function fetchDirectoryLiveReview(project: Project, profile: DirectoryLiveRefreshProfile): Promise<LiveReviewData> {
  const fieldMeta: Record<string, { label: string }> = {};
  for (const f of profile.extractableFields) fieldMeta[f] = { label: profile.fieldLabels[f] ?? f };

  const outcome = await runDirectoryExtraction({
    data: {
      urls: profile.directoryUrls,
      fields: profile.extractableFields,
      fieldMeta,
      entityLabel: profile.entityLabel,
    },
  });

  const records: ReviewRecord[] = [];
  const fetchErrors: { entity: string; error: string }[] = [];
  let reachableCount = 0;
  for (const page of outcome.perPage) {
    if (page.reachable) reachableCount += 1;
    if (page.error) fetchErrors.push({ entity: page.url, error: page.error });
  }

  const diffed = diffRegistrySnapshot(profile.currentValueRows, outcome.rows, profile.keyField, profile.nameField, profile.extractableFields);
  for (const rec of diffed) {
    const sourceUrl = outcome.perPage.find((p) => p.rows.includes(rec.row))?.url ?? profile.directoryUrls[0] ?? "";
    for (const d of rec.diffs) {
      records.push({
        id: `${project.id}-live-${rec.key}-${rec.index}-${d.field}`,
        projectId: project.id,
        entity: rec.name,
        datapoint: d.field,
        oldValue: d.oldValue || "—",
        newValue: d.newValue || "—",
        changeType: d.changeType,
        confidence: 90,
        source: rec.name,
        sourceUrl,
        detectedHrs: 0,
      });
    }
  }

  const live: LiveReviewData = {
    records,
    checkedAt: outcome.checkedAt,
    aiConfigured: true,
    reachableCount,
    totalCount: profile.directoryUrls.length,
    fetchErrors,
    profileKind: profile.kind,
  };
  saveLiveReview(project.id, live);
  clearReviewProgress(project.id);
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
 *  overlaid on top of the source rows. Returns null for projects with no
 *  real onboarded table data at all. */
export function buildRefreshedMonitoringRows(project: Project): RefreshedMonitoringTable | null {
  const profile = getLiveRefreshProfile(project.id);
  if (profile && isLiveCheckable(project)) {
    const live = loadLiveReview(project.id);
    return profile.kind === "webpage" && profile.outputFormat === "disposition"
      ? buildDispositionTable(project, live, profile)
      : buildFlatTable(project, live, profile);
  }
  // No live-refresh profile (e.g. ERIS's ECA_ON/LUST_AZ — a bulk
  // single-portal government registry snapshot, not a per-row website to
  // re-visit) but real onboarded columns/rows exist — the second tab is
  // just that dataset as-is, matching its real output format.
  if (project.columns.length > 0 && project.sampleRows.length > 0) {
    return { columns: project.columns, rows: project.sampleRows, sheetName: "Output" };
  }
  return null;
}

const POOL = 6000;

/** The same records ReviewDialog would show for this project right now —
 *  the last saved live run if one exists, otherwise the static sample data.
 *  Used to back the download button so it always exports what's on screen. */
export function recordsForDownload(project: Project): ReviewRecord[] {
  const live = loadLiveReview(project.id);
  if (live) return live.records;
  if (isLiveCheckable(project)) return baselineReviewRecords(project);
  if (project.sampleRows && project.sampleRows.length > 0) {
    return xlsxRowsToReviewRecords(project);
  }
  return reviewRecordsFor(project, Math.min(POOL, Math.max(1200, project.pendingReview)));
}

/** A live-checkable project's real on-file snapshot (sampleRows), shown as
 *  the Review content before any "Run" has been made/cached — one record
 *  per tracked field per row, marked Verified with its real value. Never
 *  fabricated: a self-service project whose sampleRows are still empty
 *  placeholders (nothing fetched yet) correctly produces no records here,
 *  same as before — this only surfaces real values that are actually on
 *  file, so a directory project's launch-time extraction (or any other
 *  live-checkable project's real baseline) is never hidden behind a
 *  missing/stale live-review cache entry. */
export function baselineReviewRecords(project: Project): ReviewRecord[] {
  const profile = getLiveRefreshProfile(project.id);
  if (!profile || project.sampleRows.length === 0 || project.columns.length === 0) return [];
  const src = project.sources[0] ?? { label: project.source, url: project.websiteUrl };
  const records: ReviewRecord[] = [];
  project.sampleRows.forEach((row, i) => {
    const entity = row[profile.nameField] || `Record ${i + 1}`;
    for (const f of profile.extractableFields) {
      const v = (row[f] ?? "").trim();
      if (!v) continue;
      records.push({
        id: `${project.id}-base-${i}-${f}`,
        projectId: project.id,
        entity,
        datapoint: f,
        oldValue: v,
        newValue: v,
        changeType: "Verified",
        confidence: 90,
        source: src.label,
        sourceUrl: src.url,
        detectedHrs: 0,
      });
    }
  });
  return records;
}
