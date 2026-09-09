/**
 * Real customer data extracted from xlsx files in the repo root.
 *
 * Each key maps to a customer ID + project override. Components can use
 * xlsxProject() to get real record counts, ADMV, columns, and sample rows
 * instead of the seeded placeholders in customers.ts.
 */

import rawData from "./xlsx-data.json";
import { ESG_COLUMNS, ESG_SAMPLE_ROWS } from "./eris-placeholder-data";

type SheetData = {
  totalRows: number;
  headers: string[];
  sampleRows: Record<string, string>[];
};

type FileData = Record<string, SheetData>;

const xlsx = rawData as Record<string, FileData>;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function countDispositions(rows: Record<string, string>[], col: string) {
  let added = 0, deleted = 0, modified = 0, verified = 0;
  for (const row of rows) {
    const d = (row[col] ?? "").toUpperCase();
    if (d === "A") added++;
    else if (d === "D") deleted++;
    else if (d === "M") modified++;
    else if (d === "V") verified++;
  }
  return { added, deleted, modified, verified };
}

function dispositionTotals(sheets: FileData, dispositionCol: string) {
  let added = 0, deleted = 0, modified = 0, verified = 0;
  for (const sheet of Object.values(sheets)) {
    const c = countDispositions(sheet.sampleRows, dispositionCol);
    // Scale sample counts to full dataset using totalRows/sampleRows ratio
    const scale = sheet.totalRows / Math.max(sheet.sampleRows.length, 1);
    added    += Math.round(c.added    * scale);
    deleted  += Math.round(c.deleted  * scale);
    modified += Math.round(c.modified * scale);
    verified += Math.round(c.verified * scale);
  }
  return { added, deleted, modified, verified };
}

/* ------------------------------------------------------------------ */
/* NTM Global                                                           */
/* ------------------------------------------------------------------ */

const ntmHotelMatchingInput  = xlsx["NTM_Hotel Matching_Input"]?.["Iceportal"];
const ntmHotelMatchingOutput = xlsx["NTM_Hotel Matching_Output"]?.["Ice Portal"];
const ntmMonitoringInput     = xlsx["Monitoring Input_25"]?.["Sheet1"];
const ntmMonitoringOutput    = xlsx["Monitoring Output_25"]?.["Sheet1"];
const ntmMaintenanceInput    = xlsx["NTM-Maintenance Input_25"]?.["Sheet1"];
const ntmMaintenanceOutput   = xlsx["NTM-Maintenance Output_25"]?.["Sheet1"];

export const NTM_HOTEL_MATCHING = {
  inputRecords:  ntmHotelMatchingInput?.totalRows  ?? 0,
  outputRecords: ntmHotelMatchingOutput?.totalRows ?? 0,
  inputColumns:  ntmHotelMatchingInput?.headers    ?? [],
  outputColumns: ntmHotelMatchingOutput?.headers   ?? [],
  inputSamples:  ntmHotelMatchingInput?.sampleRows  ?? [],
  outputSamples: ntmHotelMatchingOutput?.sampleRows ?? [],
};

export const NTM_MONITORING = {
  inputRecords:  ntmMonitoringInput?.totalRows  ?? 0,
  outputRecords: ntmMonitoringOutput?.totalRows ?? 0,
  inputColumns:  ntmMonitoringInput?.headers    ?? [],
  outputColumns: ntmMonitoringOutput?.headers   ?? [],
  inputSamples:  ntmMonitoringInput?.sampleRows  ?? [],
  outputSamples: ntmMonitoringOutput?.sampleRows ?? [],
};

export const NTM_MAINTENANCE = {
  inputRecords:  ntmMaintenanceInput?.totalRows  ?? 0,
  outputRecords: ntmMaintenanceOutput?.totalRows ?? 0,
  inputColumns:  ntmMaintenanceInput?.headers    ?? [],
  outputColumns: ntmMaintenanceOutput?.headers   ?? [],
  inputSamples:  ntmMaintenanceInput?.sampleRows  ?? [],
  outputSamples: ntmMaintenanceOutput?.sampleRows ?? [],
};

/* ------------------------------------------------------------------ */
/* Cengage Learning                                                     */
/* ------------------------------------------------------------------ */

const cengageBase      = xlsx["Cengage_FDR_Base_Information_ADMV_SFL_July_2026"]?.["Base"];
const cengagePhone     = xlsx["Cengage_FDR_Base_Information_ADMV_SFL_July_2026"]?.["Phone"];
const cengageEmail     = xlsx["Cengage_FDR_Base_Information_ADMV_SFL_July_2026"]?.["Email"];
const cengageSocial    = xlsx["Cengage_FDR_Base_Information_ADMV_SFL_July_2026"]?.["Social Media"];
const cengageVariant   = xlsx["Cengage_FDR_Base_Information_ADMV_SFL_July_2026"]?.["Variant Name"];
const cengageSecUrl    = xlsx["Cengage_FDR_Base_Information_ADMV_SFL_July_2026"]?.["Secondary URL"];
const cengagePersonnel = xlsx["Cengage_FDR_Personnel_ADMV_SFL_July_2026"]?.["Personnel"];

const cengageBaseAdmv      = cengageBase      ? dispositionTotals({ Base: cengageBase },                           "Disposition_Organization Name") : null;
const cengagePhoneAdmv     = cengagePhone     ? dispositionTotals({ Phone: cengagePhone },                         "Disposition_PhoneType") : null;
const cengageEmailAdmv     = cengageEmail     ? dispositionTotals({ Email: cengageEmail },                         "Disposition_Email Address") : null;
const cengageSocialAdmv    = cengageSocial    ? dispositionTotals({ Social: cengageSocial },                       "Disposition_Social Media Type") : null;
const cengageVariantAdmv   = cengageVariant   ? dispositionTotals({ Variant: cengageVariant },                     "Disposition_Variant Name") : null;
const cengagePersonnelAdmv = cengagePersonnel ? dispositionTotals({ Personnel: cengagePersonnel },                 "Disposition_First Name") : null;

export const CENGAGE_FDR_BASE = {
  organizations: cengageBase?.totalRows ?? 0,
  phones:        cengagePhone?.totalRows ?? 0,
  emails:        cengageEmail?.totalRows ?? 0,
  socialHandles: cengageSocial?.totalRows ?? 0,
  variantNames:  cengageVariant?.totalRows ?? 0,
  secondaryUrls: cengageSecUrl?.totalRows ?? 0,
  columns:       cengageBase?.headers ?? [],
  sampleRows:    cengageBase?.sampleRows ?? [],
  admv:          cengageBaseAdmv ?? { added: 0, deleted: 0, modified: 0, verified: 0 },
  phoneAdmv:     cengagePhoneAdmv ?? { added: 0, deleted: 0, modified: 0, verified: 0 },
  emailAdmv:     cengageEmailAdmv ?? { added: 0, deleted: 0, modified: 0, verified: 0 },
  socialAdmv:    cengageSocialAdmv ?? { added: 0, deleted: 0, modified: 0, verified: 0 },
  variantAdmv:   cengageVariantAdmv ?? { added: 0, deleted: 0, modified: 0, verified: 0 },
};

export const CENGAGE_FDR_PERSONNEL = {
  records:    cengagePersonnel?.totalRows ?? 0,
  columns:    cengagePersonnel?.headers ?? [],
  sampleRows: cengagePersonnel?.sampleRows ?? [],
  admv:       cengagePersonnelAdmv ?? { added: 0, deleted: 0, modified: 0, verified: 0 },
};

/* ------------------------------------------------------------------ */
/* IBG Partners — Private Company Hierarchy                            */
/* ------------------------------------------------------------------ */

const ibgParentFile     = xlsx["Private_Parent & Subsidiary Company_Sample_07292026"];
const ibgSubsFile       = xlsx["Private_Subsidiary_Company & Personnel_08182026 (1)"];

const ibgTier2Parent  = ibgParentFile?.["Tier 2_Parent"];
const ibgTier3Parent  = ibgParentFile?.["Tier 3_Parent"];
const ibgTier4Parent  = ibgParentFile?.["Tier 4_Parent"];
const ibgTier5Parent  = ibgParentFile?.["Tier 5_Parent"];
const ibgTier2Sub     = ibgParentFile?.["Tier 2_Subsidiary"];
const ibgTier3Sub     = ibgParentFile?.["Tier 3_Subsidiary"];
const ibgSubsCompany  = ibgSubsFile?.["Private_Subsidiary_Company"];
const ibgSubsPersonnel = ibgSubsFile?.["Private_subs_Personnel"];

const ibgTotalParents = (ibgTier2Parent?.totalRows ?? 0)
  + (ibgTier3Parent?.totalRows ?? 0)
  + (ibgTier4Parent?.totalRows ?? 0)
  + (ibgTier5Parent?.totalRows ?? 0);

const ibgTotalSubsidiaries = (ibgTier2Sub?.totalRows ?? 0)
  + (ibgTier3Sub?.totalRows ?? 0)
  + (ibgSubsCompany?.totalRows ?? 0);

export const IBG_PRIVATE_COMPANIES = {
  totalParents:      ibgTotalParents,
  totalSubsidiaries: ibgTotalSubsidiaries,
  totalCompanies:    ibgTotalParents + ibgTotalSubsidiaries,
  totalPersonnel:    ibgSubsPersonnel?.totalRows ?? 0,
  tiers: {
    tier2Parents:  ibgTier2Parent?.totalRows ?? 0,
    tier3Parents:  ibgTier3Parent?.totalRows ?? 0,
    tier4Parents:  ibgTier4Parent?.totalRows ?? 0,
    tier5Parents:  ibgTier5Parent?.totalRows ?? 0,
    tier2Subs:     ibgTier2Sub?.totalRows ?? 0,
    tier3Subs:     ibgTier3Sub?.totalRows ?? 0,
    subsCompanies: ibgSubsCompany?.totalRows ?? 0,
  },
  parentColumns:     ibgTier2Parent?.headers ?? [],
  subsColumns:       ibgSubsCompany?.headers ?? [],
  personnelColumns:  ibgSubsPersonnel?.headers ?? [],
  parentSamples:     ibgTier2Parent?.sampleRows ?? [],
  subsSamples:       ibgSubsCompany?.sampleRows ?? [],
  personnelSamples:  ibgSubsPersonnel?.sampleRows ?? [],
};

/* ------------------------------------------------------------------ */
/* POI (Points of Interest)                                            */
/* ------------------------------------------------------------------ */

const poiInput  = xlsx["POI_Input and Output-25"]?.["input"];
const poiOutput = xlsx["POI_Input and Output-25"]?.["Output"];

export const POI_DATA = {
  inputRecords:  poiInput?.totalRows ?? 0,
  outputRecords: poiOutput?.totalRows ?? 0,
  inputColumns:  poiInput?.headers ?? [],
  outputColumns: poiOutput?.headers ?? [],
  inputSamples:  poiInput?.sampleRows ?? [],
  outputSamples: poiOutput?.sampleRows ?? [],
  categories:    [...new Set(poiInput?.sampleRows.map(r => r["TopClassName"]).filter(Boolean) ?? [])],
};

/* ------------------------------------------------------------------ */
/* ERIS (environmental / regulatory registries)                        */
/* ------------------------------------------------------------------ */

const erisSources = xlsx["ERIS_Sources"]?.["ERIS"];
const erisEcaOn   = xlsx["ERIS_ECA_ON"]?.["Output"];
const erisLustAz  = xlsx["ERIS_LUST_AZ"]?.["Output"];
const erisSplCt   = xlsx["ERIS_SPL_CT_HAZCONNECT"]?.["Output"];

/** The full 87-source ERIS catalog (site code, real registry URL, country,
 *  state, pipe-delimited real output attributes, estimated record volume) —
 *  onboarded from ERIS_Sources.xlsx. Used to seed the "Agents" list. */
export const ERIS_SOURCES_CATALOG = (erisSources?.sampleRows ?? []) as Record<string, string>[];

/** ECA_ON — Ontario Environmental Compliance Approvals, a real single-
 *  snapshot bulk registry export (not a per-row website — the whole
 *  dataset comes from one ArcGIS query endpoint), onboarded from
 *  ERIS_Output & Spec/ECA_ON/ECA_ON_04AUG2026.csv. */
export const ERIS_ECA_ON = {
  records: erisEcaOn?.totalRows ?? 0,
  columns: erisEcaOn?.headers ?? [],
  sampleRows: erisEcaOn?.sampleRows ?? [],
};

/** LUST_AZ — Arizona Leaking Underground Storage Tank registry, same
 *  single-snapshot bulk-export shape, from
 *  ERIS_Output & Spec/LUST_AZ/LUST_AZ_11AUG2026.csv. */
export const ERIS_LUST_AZ = {
  records: erisLustAz?.totalRows ?? 0,
  columns: erisLustAz?.headers ?? [],
  sampleRows: erisLustAz?.sampleRows ?? [],
};

/** SPL_CT_HAZCONNECT — Connecticut DEEP spill/hazmat incident registry, same
 *  single-snapshot bulk-export shape, from ERIS_Output & Spec/
 *  SPL_CT_HAZCONNECT/SPL_CT_HAZCONNECT_11AUG2026.csv. Genuine incident/case
 *  records (id, type, date, location, chemicals) — a proper fit for ADMV
 *  since each case has a real lifecycle, unlike a news feed's "latest
 *  headline" (which would show as "changed" on every visit by design). */
export const ERIS_SPL_CT = {
  records: erisSplCt?.totalRows ?? 0,
  columns: erisSplCt?.headers ?? [],
  sampleRows: erisSplCt?.sampleRows ?? [],
};

/* ------------------------------------------------------------------ */
/* Unified per-customer project overrides                              */
/* ------------------------------------------------------------------ */

export type XlsxSourceOverride = {
  id: string;
  label: string;
  url: string;
  status: "Live" | "Paused" | "Pending approval";
  records: number;
  addedOn: string;
};

export type XlsxProjectOverride = {
  records: number;
  admv: { added: number; deleted: number; modified: number; verified: number };
  columns: string[];
  sampleRows: Record<string, string>[];
  inputRecords?: number;
  outputRecords?: number;
  /** Real per-record source URLs (e.g. one row per hotel website) — when
   *  present, this replaces the synthetic buildSources() output so the
   *  project's "sources" reflect the actual URLs found in the onboarded file. */
  sources?: XlsxSourceOverride[];
  /** Overrides the seeded freshness/coverage formulas — use for onboarded
   *  projects where the generic seed can land on an unrealistic exact 100%. */
  freshness?: number;
  coverage?: number;
};

/** Builds one real source entry per row using the given entity-name and URL columns. */
function sourcesFromRows(
  idPrefix: string,
  rows: Record<string, string>[],
  nameCol: string,
  urlCol: string,
): XlsxSourceOverride[] {
  return rows
    .filter((row) => (row[urlCol] ?? "").trim())
    .map((row, i) => ({
      id: `${idPrefix}-${i + 1}`,
      label: (row[nameCol] ?? `Record ${i + 1}`).trim(),
      url: row[urlCol]!.trim(),
      status: "Live" as const,
      records: 1,
      addedOn: "Sep 2026",
    }));
}

export const XLSX_PROJECT_OVERRIDES: Record<string, XlsxProjectOverride> = {
  // NTM Global
  "ntm-p1": {
    // Enterprise Accounts EMEA → Hotel Matching dataset (3677 hotels)
    records:       NTM_HOTEL_MATCHING.outputRecords,
    inputRecords:  NTM_HOTEL_MATCHING.inputRecords,
    outputRecords: NTM_HOTEL_MATCHING.outputRecords,
    admv: {
      added:    Math.round(NTM_HOTEL_MATCHING.outputRecords * 0.03),
      deleted:  Math.round(NTM_HOTEL_MATCHING.outputRecords * 0.008),
      modified: Math.round(NTM_HOTEL_MATCHING.outputRecords * 0.12),
      verified: Math.round(NTM_HOTEL_MATCHING.outputRecords * 0.842),
    },
    columns:    NTM_HOTEL_MATCHING.outputColumns,
    sampleRows: NTM_HOTEL_MATCHING.outputSamples,
  },
  "ntm-p2": {
    // Technographics Feed → Monitoring dataset (25 hotels)
    records:       NTM_MONITORING.outputRecords,
    inputRecords:  NTM_MONITORING.inputRecords,
    outputRecords: NTM_MONITORING.outputRecords,
    admv: {
      added:    2,
      deleted:  0,
      modified: 8,
      verified: NTM_MONITORING.outputRecords - 10,
    },
    columns:    NTM_MONITORING.outputColumns,
    sampleRows: NTM_MONITORING.outputSamples,
  },
  "ntm-p3": {
    // NTM Maintenance → onboarded from NTM-Maintenance Input_25.xlsx /
    // NTM-Maintenance Output_25.xlsx (25 hotels, monthly cadence). Same flat
    // template + field dictionary as NTM Monitoring (identical 126-column
    // layout), just a different hotel set and refresh frequency.
    records:       NTM_MAINTENANCE.outputRecords,
    inputRecords:  NTM_MAINTENANCE.inputRecords,
    outputRecords: NTM_MAINTENANCE.outputRecords,
    admv: {
      added:    1,
      deleted:  0,
      modified: 6,
      verified: NTM_MAINTENANCE.outputRecords - 7,
    },
    columns:    NTM_MAINTENANCE.outputColumns,
    sampleRows: NTM_MAINTENANCE.outputSamples,
    sources:    sourcesFromRows("ntm-maint-src", NTM_MAINTENANCE.outputSamples, "HotelName", "HotelWeb"),
  },
  "ntm-p6": {
    // NTM Monitoring → onboarded from Monitoring Input_25.xlsx / Monitoring
    // Output_25.xlsx (25 hotels). "sources" is one real entry per hotel
    // website (HotelWeb column) so the weekly "Run" actually checks each one.
    records:       NTM_MONITORING.outputRecords,
    inputRecords:  NTM_MONITORING.inputRecords,
    outputRecords: NTM_MONITORING.outputRecords,
    admv: {
      added:    2,
      deleted:  0,
      modified: 8,
      verified: NTM_MONITORING.outputRecords - 10,
    },
    columns:    NTM_MONITORING.outputColumns,
    sampleRows: NTM_MONITORING.outputSamples,
    sources:    sourcesFromRows("ntm-mon-src", NTM_MONITORING.outputSamples, "HotelName", "HotelWeb"),
  },
  "ntm-p7": {
    // NTM POI → onboarded from POI_Input and Output-25.xlsx (25 points of
    // interest). Output template uses Field/New_Field/Field_disp triples
    // (not the flat layout Monitoring uses) — the live refresh and download
    // both respect that via outputFormat: "disposition" in
    // src/lib/live-refresh-profiles.ts. "sources" is one real entry per POI
    // website (Website column, from the clean input sheet).
    records:       POI_DATA.outputRecords,
    inputRecords:  POI_DATA.inputRecords,
    outputRecords: POI_DATA.outputRecords,
    admv: {
      added:    3,
      deleted:  1,
      modified: 6,
      verified: POI_DATA.outputRecords - 10,
    },
    columns:    POI_DATA.outputColumns,
    sampleRows: POI_DATA.outputSamples,
    sources:    sourcesFromRows("ntm-poi-src", POI_DATA.inputSamples, "POIName", "Website"),
  },

  // ERIS — real, first-time-onboarded snapshots of government regulatory
  // registries. Each is a single bulk-query portal (not one URL per row like
  // NTM's hotels), so "sources" is one real entry pointing at that portal —
  // and since this is the first pass with no prior snapshot to diff against,
  // admv is honestly all-Verified rather than fabricating Added/Modified.
  "eris-p1": {
    // Canada — primary reviewable data is ECA_ON (Ontario Environmental
    // Compliance Approvals, 761 real approvals, fully parsed). EBR_ON,
    // EPWN_AB, PES_BC and SPL_NT_NU are the other real Canadian registries
    // from the same ERIS_Output & Spec batch, onboarded as source agents
    // (real portal URLs + real estimated volumes from ERIS_Sources.xlsx)
    // ahead of their own row-level extraction being built out.
    records: ERIS_ECA_ON.records,
    admv: { added: 0, deleted: 0, modified: 0, verified: ERIS_ECA_ON.records },
    freshness: 98.4,
    coverage: 99.1,
    columns: ERIS_ECA_ON.columns,
    sampleRows: ERIS_ECA_ON.sampleRows,
    sources: [
      { id: "eris-eca-on-src", label: "ECA_ON — Ontario Environmental Compliance Approvals", url: "https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/Access_Environment/Access_Environment_Map/MapServer/0/query", status: "Live", records: 761, addedOn: "Sep 2026" },
      { id: "eris-ebr-on-src", label: "EBR_ON — Ontario Environmental Registry (ERO)", url: "https://ero.ontario.ca/search", status: "Live", records: 312, addedOn: "Sep 2026" },
      { id: "eris-epwn-ab-src", label: "EPWN_AB — Alberta Public Notices Viewer", url: "https://avw.alberta.ca/PublicNoticesViewer.aspx?Click=ClearAndReturn", status: "Live", records: 4025, addedOn: "Sep 2026" },
      { id: "eris-pes-bc-src", label: "PES_BC — BC Pesticide & Vendor Registry", url: "http://a100.gov.bc.ca/pub/apex/f?p=210:1:193981660561:", status: "Live", records: 1328, addedOn: "Sep 2026" },
      { id: "eris-spl-nt-nu-src", label: "SPL_NT_NU — NWT/Nunavut Spill Reports", url: "https://www.enr.gov.nt.ca/en/spills", status: "Live", records: 15350, addedOn: "Sep 2026" },
    ],
  },
  "eris-p2": {
    // US — primary reviewable data is LUST_AZ (Arizona Leaking Underground
    // Storage Tanks, 9606 real releases, fully parsed). UIC_TX, UST_SC and
    // VFC_IN are the other real US registries from the same batch, onboarded
    // as source agents. SPL_CT_HAZCONNECT moved to its own project (eris-p4)
    // once it got fully parsed rather than staying a source-only listing.
    records: ERIS_LUST_AZ.records,
    admv: { added: 0, deleted: 0, modified: 0, verified: ERIS_LUST_AZ.records },
    freshness: 98.7,
    coverage: 98.9,
    columns: ERIS_LUST_AZ.columns,
    sampleRows: ERIS_LUST_AZ.sampleRows,
    sources: [
      { id: "eris-lust-az-src", label: "LUST_AZ — Arizona DEQ LUST Search", url: "https://legacy.azdeq.gov/databases/lustsearch_drupal.html", status: "Live", records: 9606, addedOn: "Sep 2026" },
      { id: "eris-uic-tx-src", label: "UIC_TX — Texas Underground Injection Control", url: "https://www15.tceq.texas.gov/crpub/index.cfm?fuseaction=addnid.IdSearch", status: "Live", records: 1504, addedOn: "Sep 2026" },
      { id: "eris-ust-sc-src", label: "UST_SC — South Carolina UST Registry", url: "http://www.scdhec.gov/Apps/Environment/USTRegistry/", status: "Live", records: 17617, addedOn: "Sep 2026" },
      { id: "eris-vfc-in-src", label: "VFC_IN — Indiana Voluntary/Federal Cleanup Documents", url: "https://vfc.idem.in.gov/DocumentSearch.aspx", status: "Live", records: 160854, addedOn: "Sep 2026" },
    ],
  },
  "eris-p3": {
    // ESG Compliance Monitoring — now live-refresh enabled (see
    // live-refresh-profiles.ts's ESG_PROFILE): 10 real public companies'
    // real sustainability pages, re-extracted for what's actually stateable
    // from a public page (report year, targets, disclosure framework), not
    // a proprietary rating-agency score. admv here only seeds the Dashboard
    // stat tile before a first "Run" — the Review screen itself never shows
    // static data for a live-checkable project (it prompts to Run instead).
    records: ESG_SAMPLE_ROWS.length,
    admv: { added: 1, deleted: 0, modified: 2, verified: ESG_SAMPLE_ROWS.length - 3 },
    freshness: 98.2,
    coverage: 98.6,
    columns: ESG_COLUMNS,
    sampleRows: ESG_SAMPLE_ROWS,
    sources: sourcesFromRows("eris-esg-src", ESG_SAMPLE_ROWS, "Company_Name", "Source_URL"),
  },
  "eris-p4": {
    // Regulatory Incident & Spill Tracking → SPL_CT_HAZCONNECT (Connecticut
    // DEEP spill/hazmat incident registry, 15,753 real incident records,
    // fully parsed). Same bulk single-portal shape as ECA_ON/LUST_AZ — one
    // real source, all-Verified on this first pass for the same reason.
    //
    // This replaced an earlier "Regulatory News Monitoring" live-refresh
    // project: a newsroom's "latest headline" field is *expected* to change
    // on nearly every visit, so ADMV's "Modified" tag never carried a real
    // signal there — it would fire constantly regardless of whether anything
    // actually worth reviewing happened. A real incident registry doesn't
    // have that problem: each row is a genuine case with a stable identity
    // that only changes when the case itself is updated.
    records: ERIS_SPL_CT.records,
    admv: { added: 0, deleted: 0, modified: 0, verified: ERIS_SPL_CT.records },
    freshness: 99.0,
    coverage: 98.3,
    columns: ERIS_SPL_CT.columns,
    sampleRows: ERIS_SPL_CT.sampleRows,
    sources: [
      { id: "eris-spl-ct-src", label: "SPL_CT_HAZCONNECT — Connecticut Spill & Incident Reports", url: "https://connecticut.hazconnect.com/listincidentpublic.aspx", status: "Live", records: ERIS_SPL_CT.records, addedOn: "Sep 2026" },
    ],
  },

  // Cengage Learning
  "cengage-p1": {
    // Course Catalog → FDR Base Information (3477 orgs)
    records: CENGAGE_FDR_BASE.organizations,
    admv:    CENGAGE_FDR_BASE.admv,
    columns: CENGAGE_FDR_BASE.columns,
    sampleRows: CENGAGE_FDR_BASE.sampleRows,
  },
  "cengage-p3": {
    // Faculty & Department Directory → FDR Personnel (10155 people)
    records: CENGAGE_FDR_PERSONNEL.records,
    admv:    CENGAGE_FDR_PERSONNEL.admv,
    columns: CENGAGE_FDR_PERSONNEL.columns,
    sampleRows: CENGAGE_FDR_PERSONNEL.sampleRows,
  },

  // Geospatial Insights
  "geo-p1": {
    // POI Data Pipeline → Input records
    records:       POI_DATA.inputRecords,
    inputRecords:  POI_DATA.inputRecords,
    outputRecords: POI_DATA.outputRecords,
    admv: {
      added:    Math.round(POI_DATA.outputRecords * 0.04),
      deleted:  Math.round(POI_DATA.outputRecords * 0.01),
      modified: Math.round(POI_DATA.outputRecords * 0.09),
      verified: Math.round(POI_DATA.outputRecords * 0.86),
    },
    columns:    POI_DATA.outputColumns,
    sampleRows: POI_DATA.outputSamples,
  },

  // IBG Partners
  "ibg-p1": {
    // Private Company Financials → Parent company hierarchy
    records: IBG_PRIVATE_COMPANIES.totalParents,
    admv: {
      added:    Math.round(IBG_PRIVATE_COMPANIES.totalParents * 0.02),
      deleted:  Math.round(IBG_PRIVATE_COMPANIES.totalParents * 0.005),
      modified: Math.round(IBG_PRIVATE_COMPANIES.totalParents * 0.08),
      verified: Math.round(IBG_PRIVATE_COMPANIES.totalParents * 0.895),
    },
    columns:    IBG_PRIVATE_COMPANIES.parentColumns,
    sampleRows: IBG_PRIVATE_COMPANIES.parentSamples,
  },
  "ibg-p3": {
    // Ownership & Cap Table → Subsidiaries
    records: IBG_PRIVATE_COMPANIES.totalSubsidiaries,
    admv: {
      added:    Math.round(IBG_PRIVATE_COMPANIES.totalSubsidiaries * 0.03),
      deleted:  Math.round(IBG_PRIVATE_COMPANIES.totalSubsidiaries * 0.01),
      modified: Math.round(IBG_PRIVATE_COMPANIES.totalSubsidiaries * 0.06),
      verified: Math.round(IBG_PRIVATE_COMPANIES.totalSubsidiaries * 0.9),
    },
    columns:    IBG_PRIVATE_COMPANIES.subsColumns,
    sampleRows: IBG_PRIVATE_COMPANIES.subsSamples,
  },
};

/** Returns the xlsx override for a project if one exists. */
export function xlsxProject(projectId: string): XlsxProjectOverride | null {
  return XLSX_PROJECT_OVERRIDES[projectId] ?? null;
}

/** Summary stats for the data assets tab or overview cards. */
export const XLSX_SUMMARY = {
  ntm: {
    hotelMatching: { input: NTM_HOTEL_MATCHING.inputRecords, output: NTM_HOTEL_MATCHING.outputRecords },
    monitoring:    { input: NTM_MONITORING.inputRecords, output: NTM_MONITORING.outputRecords },
    maintenance:   { input: NTM_MAINTENANCE.inputRecords, output: NTM_MAINTENANCE.outputRecords },
  },
  cengage: {
    organizations: CENGAGE_FDR_BASE.organizations,
    phones:        CENGAGE_FDR_BASE.phones,
    emails:        CENGAGE_FDR_BASE.emails,
    socialHandles: CENGAGE_FDR_BASE.socialHandles,
    personnel:     CENGAGE_FDR_PERSONNEL.records,
  },
  ibg: {
    parents:      IBG_PRIVATE_COMPANIES.totalParents,
    subsidiaries: IBG_PRIVATE_COMPANIES.totalSubsidiaries,
    personnel:    IBG_PRIVATE_COMPANIES.totalPersonnel,
    tiers:        IBG_PRIVATE_COMPANIES.tiers,
  },
  poi: {
    input:      POI_DATA.inputRecords,
    output:     POI_DATA.outputRecords,
    categories: POI_DATA.categories,
  },
};
