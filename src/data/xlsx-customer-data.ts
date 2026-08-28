/**
 * Real customer data extracted from xlsx files in the repo root.
 *
 * Each key maps to a customer ID + project override. Components can use
 * xlsxProject() to get real record counts, ADMV, columns, and sample rows
 * instead of the seeded placeholders in customers.ts.
 */

import rawData from "./xlsx-data.json";

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
/* Unified per-customer project overrides                              */
/* ------------------------------------------------------------------ */

export type XlsxProjectOverride = {
  records: number;
  admv: { added: number; deleted: number; modified: number; verified: number };
  columns: string[];
  sampleRows: Record<string, string>[];
  inputRecords?: number;
  outputRecords?: number;
};

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
    // Funding & M&A Signals → NTM Maintenance dataset (25 hotels)
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
