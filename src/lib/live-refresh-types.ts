// Shared types for the live-refresh feature, split out from
// live-refresh-profiles.ts so custom-projects.ts (self-service projects)
// can build a profile without importing the whole static profile map back
// (which would create an import cycle: profiles -> custom-projects ->
// profiles).
import type { PromptConfig } from "@/lib/api/monitoring-refresh.core";

export type LiveRefreshOutputFormat =
  /** One column per field — new value overwrites old in place (NTM Monitoring). */
  | "flat"
  /** Field / New_Field / Field_disp triples, disposition-coded V/A/D/M (NTM POI). */
  | "disposition";

/** A project's live-refresh mechanism is one of two fundamentally different
 *  shapes: "webpage" visits one URL per row and asks an LLM to read it
 *  (NTM's hotels, ESG's companies, self-service catalog projects); "registry"
 *  queries one bulk database API and diffs the structured result by a
 *  stable key — no LLM involved, since there's no page to read (ECA_ON's
 *  live ArcGIS feature service). */
export type WebpageLiveRefreshProfile = {
  kind: "webpage";
  projectId: string;
  idField: string;
  nameField: string;
  urlField: string;
  /** Fields the AI is asked to re-verify — excludes the raw ID column. */
  extractableFields: string[];
  /** Clean, flat ground-truth rows (one per record) diffed against and
   *  shown to the AI as "current value on file". */
  currentValueRows: Record<string, string>[];
  promptConfig: PromptConfig;
  outputFormat: LiveRefreshOutputFormat;
  /** Excel tab name for the reconstructed-template download sheet. */
  outputSheetName: string;
  /** When true, each entity is also looked up in the real SEC EDGAR
   *  registry (by nameField's value) and any fields it can answer — legal
   *  name, SIC code, registration number, HQ address, phone — are overlaid
   *  on top of the AI-webpage result, filling gaps rather than overriding
   *  a real value the webpage check already found. This is what the real
   *  FreDA firmographic pipeline does (a genuine government registry
   *  lookup, not just reading the company's own marketing site) for
   *  fields that simply aren't published on a company's website. */
  usesSecEdgarOverlay?: boolean;
};

export type RegistryLiveRefreshProfile = {
  kind: "registry";
  projectId: string;
  /** Which bulk fetch function to call — see fetchRegistryLiveReview's
   *  dispatch in monitoring-live-review.ts. Each registry has its own
   *  fetch shape (ArcGIS query vs. HTML table scrape), so this is a small
   *  fixed set rather than a free-form string. */
  registryId: "eca_on" | "meatlist" | "abm_directory";
  keyField: string;
  nameField: string;
  extractableFields: string[];
  currentValueRows: Record<string, string>[];
  outputSheetName: string;
  /** The real external registry page — fallback "Source" link for a
   *  record when buildSourceUrl (below) can't produce a real per-row link
   *  for it, so the link never falls back to "" (which resolves to the
   *  app's own current page rather than anywhere external). */
  sourceUrl: string;
  /** Builds the real per-row reference URL from that row's own fresh live
   *  data — e.g. ECA_ON's own PDF_URL column, or a registry search
   *  narrowed to just this one entry — so "Source" points at the specific
   *  page an entry's data actually came from, not a generic listing.
   *  Return "" to fall back to sourceUrl for that row. */
  buildSourceUrl?: (row: Record<string, string>) => string;
  /** Other real registries in this project that don't expose a structured
   *  query API but ARE reachable public pages — checked via the same
   *  AI-webpage-reading engine ESG/NTM use, in addition to (not instead of)
   *  the structured registry query above, so "Run" covers every source that
   *  actually responds instead of just the one with a clean API. */
  companionWebpages?: { id: string; name: string; url: string }[];
};

/** A directory/listing profile is a THIRD shape, distinct from both above:
 *  each configured URL is not one entity, but one page that lists MANY
 *  entities (a business directory, a member list) — "Run" re-scrapes every
 *  listed URL, asks the AI to pull out every distinct entity it names, and
 *  diffs the combined result against the on-file rows by a stable key
 *  (e.g. company name). Used by self-service Solutions projects where the
 *  customer uploaded directory pages rather than individual entity URLs —
 *  see custom-projects.ts's launchDirectoryProject. */
export type DirectoryLiveRefreshProfile = {
  kind: "directory";
  projectId: string;
  directoryUrls: string[];
  keyField: string;
  nameField: string;
  extractableFields: string[];
  /** Human-readable label for each extractableFields key — from the real
   *  page's own table headers when the source is a plain HTML table
   *  ("organization_name" -> "Organization Name"), so the review screen and
   *  the downloadable output file show real column names instead of raw
   *  slugified keys. */
  fieldLabels: Record<string, string>;
  currentValueRows: Record<string, string>[];
  outputSheetName: string;
  entityLabel: string;
};

export type LiveRefreshProfile = WebpageLiveRefreshProfile | RegistryLiveRefreshProfile | DirectoryLiveRefreshProfile;
