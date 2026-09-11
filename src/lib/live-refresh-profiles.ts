// Per-project configuration for the live-refresh feature. The extraction
// engine (monitoring-refresh.core.ts) is fully generic — everything that
// differs between projects (which fields exist, what they mean, which
// column holds the URL, how the downloadable template is laid out) lives
// here, one small profile per onboarded project.
import attributeDictionary from "@/data/ntm-attribute-dictionary.json" with { type: "json" };
import { NTM_MONITORING, NTM_MAINTENANCE, POI_DATA, ERIS_ECA_ON } from "@/data/xlsx-customer-data";
import { ESG_COLUMNS, ESG_SAMPLE_ROWS } from "@/data/eris-placeholder-data";
import type { FieldMeta, PromptConfig } from "@/lib/api/monitoring-refresh.core";

export type LiveRefreshOutputFormat =
  /** One column per field — new value overwrites old in place (NTM Monitoring). */
  | "flat"
  /** Field / New_Field / Field_disp triples, disposition-coded V/A/D/M (NTM POI). */
  | "disposition";

/** A project's live-refresh mechanism is one of two fundamentally different
 *  shapes: "webpage" visits one URL per row and asks an LLM to read it
 *  (NTM's hotels, ESG's companies); "registry" queries one bulk database
 *  API and diffs the structured result by a stable key — no LLM involved,
 *  since there's no page to read (ECA_ON's live ArcGIS feature service). */
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
};

export type RegistryLiveRefreshProfile = {
  kind: "registry";
  projectId: string;
  keyField: string;
  nameField: string;
  extractableFields: string[];
  currentValueRows: Record<string, string>[];
  outputSheetName: string;
  /** Other real registries in this project that don't expose a structured
   *  query API but ARE reachable public pages — checked via the same
   *  AI-webpage-reading engine ESG/NTM use, in addition to (not instead of)
   *  the structured registry query above, so "Run" covers every source that
   *  actually responds instead of just the one with a clean API. */
  companionWebpages?: { id: string; name: string; url: string }[];
};

export type LiveRefreshProfile = WebpageLiveRefreshProfile | RegistryLiveRefreshProfile;

type AttrDictEntry = { column: string; group: string; label: string };

function buildNtmFieldMeta(): Record<string, FieldMeta> {
  const meta: Record<string, FieldMeta> = {};
  for (const e of attributeDictionary as AttrDictEntry[]) {
    meta[e.column] = { group: e.group, label: e.label };
  }
  return meta;
}

const NTM_META_COLUMNS = new Set([
  "NTMHotelID", "Status", "Research_URL", "IR_Comments", "TR_comments",
  "Researcher_Name", "Contact_Person",
]);
function isNtmMetaColumn(field: string): boolean {
  return NTM_META_COLUMNS.has(field) || field.endsWith("_Comments") || field.endsWith("_comments");
}

const MONITORING_PROFILE: WebpageLiveRefreshProfile = {
  kind: "webpage",
  projectId: "ntm-p6",
  idField: "NTMHotelID",
  nameField: "HotelName",
  urlField: "HotelWeb",
  extractableFields: NTM_MONITORING.outputColumns.filter((c) => !isNtmMetaColumn(c)),
  currentValueRows: NTM_MONITORING.outputSamples,
  promptConfig: {
    entityLabel: "hotel",
    fieldMeta: buildNtmFieldMeta(),
    relevantLinkKeywords: [
      "amenit", "facilit", "policy", "policies", "room", "meeting", "event",
      "dining", "restaurant", "spa", "about", "contact", "pet",
    ],
  },
  outputFormat: "flat",
  outputSheetName: "Monitoring Output",
};

/* ------------------------------------------------------------------ */
/* NTM Maintenance — same 126-column flat template + field dictionary as   */
/* NTM Monitoring (verified identical column set), just a different hotel  */
/* set refreshed monthly instead of weekly.                                */
/* ------------------------------------------------------------------ */

const MAINTENANCE_PROFILE: WebpageLiveRefreshProfile = {
  kind: "webpage",
  projectId: "ntm-p3",
  idField: "NTMHotelID",
  nameField: "HotelName",
  urlField: "HotelWeb",
  extractableFields: NTM_MAINTENANCE.outputColumns.filter((c) => !isNtmMetaColumn(c)),
  currentValueRows: NTM_MAINTENANCE.outputSamples,
  promptConfig: {
    entityLabel: "hotel",
    fieldMeta: buildNtmFieldMeta(),
    relevantLinkKeywords: [
      "amenit", "facilit", "policy", "policies", "room", "meeting", "event",
      "dining", "restaurant", "spa", "about", "contact", "pet",
    ],
  },
  outputFormat: "flat",
  outputSheetName: "Maintenance Output",
};

/* ------------------------------------------------------------------ */
/* NTM POI                                                              */
/* ------------------------------------------------------------------ */

const POI_FIELD_META: Record<string, FieldMeta> = {
  TopClassName: { group: "Identity", label: "Top-Level Category" },
  RefClassName: { group: "Identity", label: "Reference Category" },
  ClassName: { group: "Identity", label: "Category" },
  POIName: { group: "Identity", label: "Point of Interest Name" },
  DisplayName: { group: "Identity", label: "Display Name (City, State)" },
  Address1: { group: "Location", label: "Street Address" },
  StreetDir: { group: "Location", label: "Neighborhood / District" },
  CityName: { group: "Location", label: "City" },
  StateName: { group: "Location", label: "State / Region" },
  CountryName: { group: "Location", label: "Country" },
  ZipCode: { group: "Location", label: "ZIP / Postal Code" },
  Latitude: { group: "Location", label: "Latitude" },
  Longitude: { group: "Location", label: "Longitude" },
  PhoneAC: { group: "Contact", label: "Phone Area Code" },
  PhoneNbr: { group: "Contact", label: "Phone Number" },
  TollfreeAC: { group: "Contact", label: "Toll-Free Area Code" },
  TollfreeNbr: { group: "Contact", label: "Toll-Free Number" },
  Email: { group: "Contact", label: "Email Address" },
  Website: { group: "Contact", label: "Website" },
  FeesDetail: { group: "Visitor Information", label: "Fees / Admission Details" },
  PmtAccept: { group: "Visitor Information", label: "Payment Methods Accepted" },
  PmtAcceptDetail: { group: "Visitor Information", label: "Payment Methods — Details" },
  HrsOper: { group: "Visitor Information", label: "Hours of Operation" },
  ResvPolicy: { group: "Visitor Information", label: "Reservation Policy" },
};

const POI_META_COLUMNS = new Set(["PoiPlaceKey"]);

const POI_PROFILE: WebpageLiveRefreshProfile = {
  kind: "webpage",
  projectId: "ntm-p7",
  idField: "PoiPlaceKey",
  nameField: "POIName",
  urlField: "Website",
  extractableFields: POI_DATA.inputColumns.filter((c) => !POI_META_COLUMNS.has(c)),
  currentValueRows: POI_DATA.inputSamples,
  promptConfig: {
    entityLabel: "point of interest",
    fieldMeta: POI_FIELD_META,
    relevantLinkKeywords: [
      "hours", "menu", "location", "directions", "contact", "about",
      "reservation", "policy", "info", "visit",
    ],
  },
  outputFormat: "disposition",
  outputSheetName: "POI Output",
};

/* ------------------------------------------------------------------ */
/* ERIS — ESG Compliance Monitoring: real public company sustainability    */
/* pages, re-extracted for what's actually stateable from a public page   */
/* (report year, targets, disclosure framework) — not a proprietary rating */
/* agency score, which no public page states.                              */
/* ------------------------------------------------------------------ */

const ESG_META_COLUMNS = new Set(["Company_ID", "Source_URL"]);

const ESG_FIELD_META: Record<string, FieldMeta> = {
  Company_Name: { group: "Identity", label: "Company Name" },
  Sector: { group: "Identity", label: "Sector / Industry" },
  Sustainability_Report_Year: { group: "Disclosure", label: "Most Recent Sustainability Report Year" },
  Disclosure_Framework: { group: "Disclosure", label: "Disclosure Framework Referenced (GRI / SASB / TCFD / CDP)" },
  Net_Zero_Target_Year: { group: "Climate", label: "Stated Net-Zero / Carbon-Neutral Target Year" },
  Renewable_Energy_Commitment: { group: "Climate", label: "Renewable Energy Commitment or Current Usage" },
  Emissions_Disclosure: { group: "Climate", label: "Scope 1/2 Emissions Disclosure Summary" },
  Board_Diversity_Statement: { group: "Governance", label: "Board / Workforce Diversity Statement" },
  Key_Certifications: { group: "Governance", label: "Named Certifications (e.g. B Corp, ISO 14001)" },
  ESG_Highlight_Summary: { group: "Summary", label: "One-Line Summary of the Page's Main Sustainability Message" },
};

const ESG_PROFILE: WebpageLiveRefreshProfile = {
  kind: "webpage",
  projectId: "eris-p3",
  idField: "Company_ID",
  nameField: "Company_Name",
  urlField: "Source_URL",
  extractableFields: ESG_COLUMNS.filter((c) => !ESG_META_COLUMNS.has(c)),
  currentValueRows: ESG_SAMPLE_ROWS,
  promptConfig: {
    entityLabel: "company",
    fieldMeta: ESG_FIELD_META,
    relevantLinkKeywords: [
      "sustainability", "esg", "environment", "climate", "responsibility",
      "impact", "report", "diversity", "carbon", "emissions",
    ],
  },
  outputFormat: "flat",
  outputSheetName: "ESG Output",
};

/* ------------------------------------------------------------------ */
/* ERIS — Canada Environmental & Regulatory Registries (eris-p1): ECA_ON's */
/* live ArcGIS feature service is a genuine, unprotected structured query  */
/* API (confirmed by direct testing) — "Run" queries it live for the most  */
/* recent 25 real approvals and diffs them against the on-file snapshot by */
/* APPROVAL_NUMBER, no LLM involved since there's a real database to query */
/* instead of a page to read.                                              */
/*                                                                          */
/* The other 4 real Canadian registries listed as sources were tested      */
/* directly (not assumed): EBR_ON, PES_BC and SPL_NT_NU all return real,   */
/* readable pages (HTTP 200) — they're wired below as companion webpage    */
/* checks using the same AI engine ESG/NTM use, so "Run" now covers 4 of 5 */
/* real sources, not just ECA_ON. EPWN_AB returns "555 Request Rejected" — */
/* a genuine active block, not a bad URL — so it stays out, the same       */
/* reasoning as LUST_AZ/SPL_CT_HAZCONNECT's Cloudflare walls.              */
/* ------------------------------------------------------------------ */

/** Shared prompt for the 3 companion Canada registry portals — different
 *  registry types (notices/postings, license search, spill reports) so the
 *  fields stay generic ("what's currently on this page") rather than
 *  bespoke per registry, the same way the engine already handles hotels vs.
 *  companies vs. POIs through one shared PromptConfig shape. */
export const CANADA_REGISTRY_PORTAL_CONFIG: PromptConfig = {
  entityLabel: "regulatory registry portal",
  fieldMeta: {
    Portal_Status_Summary: { group: "Status", label: "One-Line Summary of What This Page Currently Shows" },
    Latest_Entry_Or_Notice: { group: "Status", label: "Most Recent Item, Notice or Entry Visible (Title, Date or Reference Number)" },
    Result_Count_If_Shown: { group: "Status", label: "Total Number of Results/Records/Entries Shown, If a Count Is Displayed" },
  },
  relevantLinkKeywords: ["notice", "search", "results", "registry", "filing", "posting", "record", "spill", "license"],
};
export const CANADA_REGISTRY_PORTAL_FIELDS = Object.keys(CANADA_REGISTRY_PORTAL_CONFIG.fieldMeta);

const ECA_ON_META_COLUMNS = new Set(["OBJECTID", "APPROVAL_NUMBER"]);

const ECA_ON_REGISTRY_PROFILE: RegistryLiveRefreshProfile = {
  kind: "registry",
  projectId: "eris-p1",
  keyField: "APPROVAL_NUMBER",
  nameField: "BUSINESS_NAME",
  extractableFields: ERIS_ECA_ON.columns.filter((c) => !ECA_ON_META_COLUMNS.has(c)),
  currentValueRows: ERIS_ECA_ON.sampleRows,
  outputSheetName: "ECA_ON Output",
  companionWebpages: [
    { id: "ebr-on", name: "EBR_ON — Ontario Environmental Registry", url: "https://ero.ontario.ca/search" },
    { id: "pes-bc", name: "PES_BC — BC Pesticide Licenses", url: "http://a100.gov.bc.ca/pub/apex/f?p=210:1:193981660561:" },
    { id: "spl-nt-nu", name: "SPL_NT_NU — NWT/Nunavut Spills", url: "https://www.enr.gov.nt.ca/en/spills" },
  ],
};

// eris-p4 (Regulatory Incident & Spill Tracking) deliberately has no
// live-refresh profile — like LUST_AZ, it's a bulk single-portal registry
// snapshot (SPL_CT_HAZCONNECT) behind Cloudflare bot protection, not a
// per-row website to revisit and not a queryable open API like ECA_ON.
// It previously held a "Regulatory News Monitoring" live-refresh profile,
// but a newsroom's "latest headline" field is expected to change on nearly
// every visit, so ADMV's "Modified" tag never carried a real signal there.

export const LIVE_REFRESH_PROFILES: Record<string, LiveRefreshProfile> = {
  "eris-p1": ECA_ON_REGISTRY_PROFILE,
  "ntm-p3": MAINTENANCE_PROFILE,
  "ntm-p6": MONITORING_PROFILE,
  "ntm-p7": POI_PROFILE,
  "eris-p3": ESG_PROFILE,
};

export function getLiveRefreshProfile(projectId: string): LiveRefreshProfile | null {
  return LIVE_REFRESH_PROFILES[projectId] ?? null;
}
