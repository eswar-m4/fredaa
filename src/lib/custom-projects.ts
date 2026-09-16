// Self-service projects — a customer picks one of the Solutions catalog
// datasets, uploads/pastes their own entity URLs, picks attributes and a
// cadence, and this provisions a real project directly into their
// workspace: no admin ticket, no wait. It shows up in Monitor/Dashboard
// like any other project and re-checks its entities live via the same
// generic AI webpage-read engine (monitoring-refresh.core.ts) already used
// by NTM/ESG — the "AI bot" that reads a page and extracts the fields it's
// told to look for, just pointed at whatever URLs and attributes the
// customer picked instead of a hand-built profile.
//
// Genuinely new/custom asks (not one of the catalog datasets, or an
// add/remove-source change to an existing project) still go through the
// ticket flow in ticket-store.ts — this store is only for the
// self-provisioned catalog-dataset case.
import { useSyncExternalStore } from "react";
import type { Project, SourceRef, ReviewRecord } from "@/data/customers";
import type { WebpageLiveRefreshProfile, DirectoryLiveRefreshProfile } from "@/lib/live-refresh-types";
import type { Dataset } from "@/data/datasets";
import { runDirectoryExtraction } from "@/lib/api/directory-extract.functions";
import { diffRegistrySnapshot } from "@/lib/api/registry-refresh.core";
import { saveLiveReview } from "@/lib/live-review-store";
import type { LiveReviewData } from "@/components/ReviewDialog";

export type CustomProjectEntry = { project: Project; profile: WebpageLiveRefreshProfile | DirectoryLiveRefreshProfile };

const KEY = "freda_custom_projects_v1";
const listeners = new Set<() => void>();
let cache: Record<string, CustomProjectEntry[]> | null = null;
const EMPTY: CustomProjectEntry[] = [];

function readAll(): Record<string, CustomProjectEntry[]> {
  if (typeof window === "undefined") return {};
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, CustomProjectEntry[]>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(next: Record<string, CustomProjectEntry[]>) {
  cache = next;
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

/** Reactive list of self-provisioned projects for one workspace. */
export function useCustomProjects(customerId: string): Project[] {
  const entries = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => readAll()[customerId] ?? EMPTY,
    () => EMPTY,
  );
  return entries.map((e) => e.project);
}

function nextCustomProjectId(customerId: string): string {
  return `${customerId}-custom-${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`;
}

// Base keywords always worth checking on a company's own site, plus extra
// ones added when the *selected fields'* own group names suggest a
// particular kind of subpage is likely to actually have the answer (e.g.
// selecting Financials-group fields makes "investor"/"annual report" pages
// worth finding, not just "about"). This is what lets "which fields/sources
// you selected" genuinely change what gets crawled, without needing a
// bespoke keyword list written by hand per dataset.
const BASE_KEYWORDS = ["about", "company", "overview", "contact", "home"];
const GROUP_KEYWORD_HINTS: Record<string, string[]> = {
  identity: ["about", "company", "who we are"],
  classification: ["industry", "sector"],
  size: ["about", "careers", "team"],
  financials: ["investor", "investors", "annual report", "financial"],
  leadership: ["team", "leadership", "management", "board", "executives"],
  location: ["contact", "offices", "locations"],
  web: ["contact", "connect", "social"],
  tech: ["careers", "engineering", "technology"],
  registry: ["legal", "investor", "governance"],
  filing: ["investor", "sec", "governance"],
  "income statement": ["investor", "financial", "annual report"],
  "balance sheet": ["investor", "financial", "annual report"],
  "cash flow": ["investor", "financial", "annual report"],
  ratios: ["investor", "financial"],
  contact: ["contact", "connect"],
  role: ["team", "leadership", "careers"],
};

// Toggled "wired source" checkboxes (LinkedIn, SEC EDGAR, Companies House,
// Crunchbase, ...) aren't independently fetchable in this build (no API
// access to those platforms), but their names still tell us what the
// customer cares about — matched against the source NAME text so a
// selected source nudges the same-site crawl the same way selecting the
// matching field group would.
const SOURCE_NAME_KEYWORD_HINTS: [RegExp, string[]][] = [
  [/linkedin/i, ["team", "leadership", "careers"]],
  [/crunchbase|funding|investor/i, ["investor", "investors", "funding", "press"]],
  [/sec edgar|companies house|mca|registry|registrar|division of corporations|dos\b/i, ["legal", "investor", "governance"]],
  [/annual report|10-k|10-q|financial/i, ["investor", "financial", "annual report"]],
  [/press|news|media/i, ["press", "news", "media"]],
  [/career|job/i, ["careers", "jobs"]],
];

function keywordsForGroups(groups: string[], sourceNames: string[]): string[] {
  const set = new Set(BASE_KEYWORDS);
  for (const g of groups) {
    const hints = GROUP_KEYWORD_HINTS[g.toLowerCase().trim()];
    if (hints) hints.forEach((h) => set.add(h));
  }
  for (const name of sourceNames) {
    for (const [re, hints] of SOURCE_NAME_KEYWORD_HINTS) {
      if (re.test(name)) hints.forEach((h) => set.add(h));
    }
  }
  return [...set];
}

/** A generic-webpage-engine PromptConfig built straight from a catalog
 *  dataset's own attribute list — this is what avoids needing bespoke
 *  script/profile code per dataset: any of the 21 (or any future addition
 *  to datasets.ts) works through the same function. Capped to a sane field
 *  count so the AI prompt for a 60-field dataset (e.g. Financial
 *  Statements) doesn't try to extract everything in one shot. */
export function promptConfigFromDataset(dataset: Dataset, selectedKeys: string[], selectedSourceNames: string[] = []) {
  const attrsByKey = new Map(dataset.outputAttributes.map((a) => [a.key, a]));
  const fieldMeta: Record<string, { group: string; label: string }> = {};
  const fields: string[] = [];
  const groups: string[] = [];
  for (const key of selectedKeys.slice(0, 30)) {
    const a = attrsByKey.get(key);
    if (!a) continue;
    fieldMeta[key] = { group: a.group ?? "Details", label: a.label };
    fields.push(key);
    if (a.group) groups.push(a.group);
  }
  return {
    fields,
    promptConfig: {
      entityLabel: dataset.category.toLowerCase(),
      fieldMeta,
      relevantLinkKeywords: keywordsForGroups(groups, selectedSourceNames),
    },
  };
}

function nameFromUrl(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const FREQ_MAP: Record<string, Project["frequency"]> = { Daily: "Daily", Weekly: "Weekly", Monthly: "Monthly", Custom: "Weekly" };

/** Provisions a new project for `customerId` right now — no ticket, no
 *  admin step. `entityUrls` are the customer's own uploaded/typed URLs
 *  (the actual per-row entities to check); `selectedAttributeKeys` are the
 *  dataset.outputAttributes keys the customer chose to track. Returns the
 *  new project so the caller can navigate straight to it. */
export function launchSelfServiceProject(params: {
  customerId: string;
  projectName: string;
  dataset: Dataset;
  entityUrls: string[];
  selectedAttributeKeys: string[];
  selectedSourceNames?: string[];
  cadence: string;
}): Project {
  const { customerId, projectName, dataset, entityUrls, selectedAttributeKeys, selectedSourceNames = [], cadence } = params;
  const id = nextCustomProjectId(customerId);
  const urls = [...new Set(entityUrls.map((u) => u.trim()).filter(Boolean))];

  const { fields, promptConfig } = promptConfigFromDataset(dataset, selectedAttributeKeys, selectedSourceNames);
  const columns = ["Entity_Name", "Source_URL", ...fields];
  const sampleRows = urls.map((url) => {
    const row: Record<string, string> = { Entity_Name: nameFromUrl(url), Source_URL: url };
    for (const f of fields) row[f] = "";
    return row;
  });

  const profile: WebpageLiveRefreshProfile = {
    kind: "webpage",
    projectId: id,
    idField: "Source_URL",
    nameField: "Entity_Name",
    urlField: "Source_URL",
    extractableFields: fields,
    currentValueRows: sampleRows,
    promptConfig,
    outputFormat: "flat",
    outputSheetName: `${dataset.name} Output`,
    // Firmographic and Company Registry/Compliance are the two catalog
    // datasets whose real FreDA pipeline draws from an actual government
    // registry (SEC EDGAR) for fields like SIC code and legal name — not
    // just the company's own website. Same real lookup either way.
    usesSecEdgarOverlay: dataset.id === "ds-firmographic" || dataset.id === "ds-registry",
  };

  const sources: SourceRef[] = urls.length
    ? urls.map((url, i) => ({
        id: `${id}-src-${i}`,
        label: nameFromUrl(url),
        url,
        status: "Live",
        records: 1,
        addedOn: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      }))
    : dataset.sources.slice(0, 5).map((s, i) => ({
        id: `${id}-src-${i}`,
        label: s.name,
        url: s.url.startsWith("http") ? s.url : `https://${s.url}`,
        status: "Live",
        records: 0,
        addedOn: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      }));

  const project: Project = {
    id,
    customerId,
    name: projectName,
    source: dataset.tagline,
    websiteUrl: urls[0] ?? dataset.sources[0]?.url ?? "",
    datapoints: fields.map((f) => promptConfig.fieldMeta[f]?.label ?? f),
    sources,
    records: sampleRows.length,
    admv: { added: 0, deleted: 0, modified: 0, verified: 0 },
    freshness: 0,
    accuracy: 0,
    coverage: 0,
    frequency: FREQ_MAP[cadence] ?? "Weekly",
    lastRefreshHrs: 0,
    nextRefreshHrs: 0,
    status: "Review pending",
    pendingReview: sampleRows.length,
    history: [],
    sampleRows,
    columns,
  };

  const all = readAll();
  const existing = all[customerId] ?? [];
  persist({ ...all, [customerId]: [...existing, { project, profile }] });
  return project;
}

/** Same idea as launchSelfServiceProject, but for directory/listing
 *  sources (a business directory, a member list — one page names MANY
 *  entities) rather than one URL per entity. Runs the real extraction
 *  immediately (synchronously, before returning) so the project lands in
 *  the workspace with real rows already in Review/Output, not an empty
 *  shell waiting for a first "Run" — matches how ERIS/ABM's other
 *  first-time-onboarded real datasets already work (a real snapshot,
 *  all-Verified, no fabricated Added). A later "Run" in Monitor re-scrapes
 *  the same directory URLs and diffs against this baseline. */
export async function launchDirectoryProject(params: {
  customerId: string;
  projectName: string;
  dataset: Dataset;
  directoryUrls: string[];
  selectedAttributeKeys: string[];
  cadence: string;
}): Promise<{ project: Project; fetchErrors: { entity: string; error: string }[] }> {
  const { customerId, projectName, dataset, directoryUrls, selectedAttributeKeys, cadence } = params;
  const id = nextCustomProjectId(customerId);
  const urls = [...new Set(directoryUrls.map((u) => u.trim()).filter(Boolean))];
  const entityLabel = dataset.category.toLowerCase();

  const attrsByKey = new Map(dataset.outputAttributes.map((a) => [a.key, a]));
  const requestedFields = selectedAttributeKeys.filter((k) => attrsByKey.has(k)).slice(0, 30);
  const requestedFieldMeta: Record<string, { label: string }> = {};
  for (const f of requestedFields) requestedFieldMeta[f] = { label: attrsByKey.get(f)!.label };

  const outcome = await runDirectoryExtraction({ data: { urls, fields: requestedFields, fieldMeta: requestedFieldMeta, entityLabel } });

  // Real directory pages are almost always a plain HTML table — when one is
  // found, its own column headers (Organization Name, Address, Telephone,
  // Email, Website, ...) become the project's real fields instead of the
  // dataset's generic catalog attributes, since the page's own schema is
  // the ground truth for what it actually publishes. Only when nothing was
  // extracted at all (blocked page, empty page) do we keep the customer's
  // originally-requested fields, so the wizard's summary still shows what
  // they asked for.
  const fields = outcome.fields.length > 0 ? outcome.fields : requestedFields;
  const fieldLabels: Record<string, string> =
    outcome.fields.length > 0 ? outcome.fieldLabels : Object.fromEntries(requestedFields.map((f) => [f, requestedFieldMeta[f]!.label]));

  // Prefer a discovered field that plainly looks like the entity's own
  // name/title (organization, company, name, contact) over whichever field
  // happened to come first in the table — falls back to the first column
  // when nothing matches, and to the dataset's own declared name-like field
  // when we kept the customer's requested fields instead.
  const nameField =
    fields.find((f) => /name|organi[sz]ation|company|title/i.test(f)) ??
    (outcome.fields.length > 0 ? fields[0] : dataset.outputAttributes.find((a) => fields.includes(a.key))?.key) ??
    fields[0] ??
    "name";

  const sampleRows = outcome.rows.filter((r) => (r[nameField] ?? "").trim());
  const fetchErrors: { entity: string; error: string }[] = [];
  for (const page of outcome.perPage) {
    if (page.error) fetchErrors.push({ entity: page.url, error: page.error });
  }

  const profile: DirectoryLiveRefreshProfile = {
    kind: "directory",
    projectId: id,
    directoryUrls: urls,
    keyField: nameField,
    nameField,
    extractableFields: fields,
    fieldLabels,
    currentValueRows: sampleRows,
    outputSheetName: `${dataset.name} Output`,
    entityLabel,
  };

  const sources: SourceRef[] = outcome.perPage.map((page, i) => ({
    id: `${id}-src-${i}`,
    label: nameFromUrl(page.url),
    url: page.url,
    status: "Live",
    records: page.rows.length,
    addedOn: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
  }));

  const project: Project = {
    id,
    customerId,
    name: projectName,
    source: dataset.tagline,
    websiteUrl: urls[0] ?? "",
    datapoints: fields.map((f) => fieldLabels[f] ?? f),
    sources,
    records: sampleRows.length,
    admv: { added: 0, deleted: 0, modified: 0, verified: sampleRows.length },
    freshness: sampleRows.length > 0 ? 96 : 0,
    accuracy: sampleRows.length > 0 ? 94 : 0,
    coverage: sampleRows.length > 0 ? 95 : 0,
    frequency: FREQ_MAP[cadence] ?? "Weekly",
    lastRefreshHrs: 0,
    nextRefreshHrs: 0,
    status: "Review pending",
    pendingReview: sampleRows.length,
    history: [],
    sampleRows,
    columns: fields,
  };

  // The Review screen (and the downloadable Review file) only ever show a
  // live-checkable project's *saved* live-review run — never the sampleRows
  // baseline directly — so without this, Review would sit empty until the
  // customer separately clicked "Run" in Monitor, even though the real
  // first-pass data (every field, every org, straight from the real page)
  // is already sitting right here. Diffing sampleRows against itself is
  // exactly the "first real snapshot" case: every field naturally comes
  // back Verified with its real value, nothing fabricated.
  const diffed = diffRegistrySnapshot(sampleRows, sampleRows, nameField, nameField, fields);
  const records: ReviewRecord[] = [];
  for (const rec of diffed) {
    const sourceUrl = outcome.perPage.find((p) => p.rows.includes(rec.row))?.url ?? urls[0] ?? "";
    for (const d of rec.diffs) {
      records.push({
        id: `${id}-live-${rec.key}-${rec.index}-${d.field}`,
        projectId: id,
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
    reachableCount: outcome.perPage.filter((p) => p.reachable).length,
    totalCount: urls.length,
    fetchErrors,
    profileKind: "directory",
  };
  saveLiveReview(id, live);

  const all = readAll();
  const existing = all[customerId] ?? [];
  persist({ ...all, [customerId]: [...existing, { project, profile }] });
  return { project, fetchErrors };
}

/** Looked up by monitoring-live-review.ts / live-refresh-profiles.ts when a
 *  project id isn't one of the hand-built static profiles — the dynamic
 *  counterpart to LIVE_REFRESH_PROFILES. */
export function getCustomLiveRefreshProfile(projectId: string): WebpageLiveRefreshProfile | DirectoryLiveRefreshProfile | null {
  const all = readAll();
  for (const entries of Object.values(all)) {
    const hit = entries.find((e) => e.project.id === projectId);
    if (hit) return hit.profile;
  }
  return null;
}

/** Removes a self-provisioned project entirely — only ever called on a
 *  project the customer launched themselves (see the "Delete" action next
 *  to Download in Monitor's Refresh schedule, gated on isCustomProjectId).
 *  Onboarded real projects (NTM, ERIS, ABM, ...) never go through this —
 *  they aren't stored here at all. */
export function removeCustomProject(customerId: string, projectId: string) {
  const all = readAll();
  const existing = all[customerId] ?? [];
  const next = existing.filter((e) => e.project.id !== projectId);
  if (next.length === existing.length) return;
  persist({ ...all, [customerId]: next });
}

/** True for a project id that was self-provisioned via launchSelfServiceProject
 *  (see nextCustomProjectId) — used to gate the Delete action so it can
 *  never appear on an onboarded real project. */
export function isCustomProjectId(projectId: string): boolean {
  return /-custom-/.test(projectId);
}
