// Per-project configuration for the live-refresh feature. The extraction
// engine (monitoring-refresh.core.ts) is fully generic — everything that
// differs between projects (which fields exist, what they mean, which
// column holds the URL, how the downloadable template is laid out) lives
// here, one small profile per onboarded project.
import attributeDictionary from "@/data/ntm-attribute-dictionary.json" with { type: "json" };
import { NTM_MONITORING, NTM_MAINTENANCE, POI_DATA } from "@/data/xlsx-customer-data";
import type { FieldMeta, PromptConfig } from "@/lib/api/monitoring-refresh.core";

export type LiveRefreshOutputFormat =
  /** One column per field — new value overwrites old in place (NTM Monitoring). */
  | "flat"
  /** Field / New_Field / Field_disp triples, disposition-coded V/A/D/M (NTM POI). */
  | "disposition";

export type LiveRefreshProfile = {
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

const MONITORING_PROFILE: LiveRefreshProfile = {
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

const MAINTENANCE_PROFILE: LiveRefreshProfile = {
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

const POI_PROFILE: LiveRefreshProfile = {
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

export const LIVE_REFRESH_PROFILES: Record<string, LiveRefreshProfile> = {
  "ntm-p3": MAINTENANCE_PROFILE,
  "ntm-p6": MONITORING_PROFILE,
  "ntm-p7": POI_PROFILE,
};

export function getLiveRefreshProfile(projectId: string): LiveRefreshProfile | null {
  return LIVE_REFRESH_PROFILES[projectId] ?? null;
}
