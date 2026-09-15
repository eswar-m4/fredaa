// Live refresh for bulk single-portal government registries — unlike a
// webpage, there's nothing for an LLM to read here, so this queries/scrapes
// the real underlying dataset directly and diffs the result. Two registries
// today: ECA_ON (a genuine, unprotected ArcGIS Feature Layer REST endpoint)
// and CFIA's MeatList (a genuine, unprotected server-rendered HTML table).
// LUST_AZ and SPL_CT_HAZCONNECT were also tested and are both behind a
// Cloudflare challenge wall — "Attention Required" — so they can't get the
// same treatment without bypassing bot protection, which this app doesn't do.
import { diffFields, type FieldDiff } from "./monitoring-refresh.core";

export type RegistryLiveOutcome = {
  rows: Record<string, string>[];
  reachable: boolean;
  error: string | null;
  checkedAt: string;
};

export type RegistryDiffRecord = {
  key: string;
  name: string;
  diffs: FieldDiff[];
  /** Position in the live result set — the real registry can return more
   *  than one row sharing the same business key (e.g. an approval that was
   *  amended/resubmitted under the same APPROVAL_NUMBER), so callers building
   *  a unique id per record need a tiebreaker beyond `key` alone. */
  index: number;
};

const ECA_ON_QUERY_URL =
  "https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/Access_Environment/Access_Environment_Map/MapServer/0/query";

function toReadableDate(value: unknown): string {
  if (typeof value !== "number") return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** Queries the live ECA_ON ArcGIS feature layer for the most recent N
 *  approvals, shaped to match the same 23-column layout the onboarded CSV
 *  snapshot uses. PDF_SITE_LOCATION / PDF_NAICS_Code aren't derivable from
 *  this query alone (the original export pulled them from the approval PDF
 *  itself) — left blank here rather than guessed. */
export async function fetchEcaOnLive(limit = 25): Promise<RegistryLiveOutcome> {
  const checkedAt = new Date().toISOString();
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    orderByFields: "APPROVAL_DATE DESC",
    resultRecordCount: String(limit),
    f: "json",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${ECA_ON_QUERY_URL}?${params}`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FredaRegistryRefresh/1.0)" },
    });
    if (!res.ok) return { rows: [], reachable: false, error: `HTTP ${res.status}`, checkedAt };
    const json = (await res.json()) as {
      error?: { message?: string };
      features?: Array<{ attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } }>;
    };
    if (json.error) return { rows: [], reachable: false, error: json.error.message ?? "ArcGIS query error", checkedAt };

    const rows = (json.features ?? []).map(({ attributes: a = {}, geometry }) => {
      const pdfLink = str(a.PDF_LINK);
      return {
        OBJECTID: str(a.OBJECTID),
        APPROVAL_NUMBER: str(a.APPROVAL_NUMBER),
        PDF_LINK: pdfLink,
        BUSINESS_NAME: str(a.BUSINESS_NAME),
        ADDRESS: str(a.ADDRESS),
        MUNICIPALITY: str(a.MUNICIPALITY),
        POSTAL_CODE: str(a.POSTAL_CODE),
        APPROVAL_DATE: toReadableDate(a.APPROVAL_DATE),
        APPROVAL_TYPE: str(a.APPROVAL_TYPE),
        PROJECT_TYPE: str(a.PROJECT_TYPE),
        STATUS: str(a.STATUS),
        LATITUDE: a.LATITUDE != null ? str(a.LATITUDE) : "",
        LONGITUDE: a.LONGITUDE != null ? str(a.LONGITUDE) : "",
        DATASOURCE: str(a.DATASOURCE),
        REFRESH_DATE: toReadableDate(a.REFRESH_DATE),
        MOE_DISTRICT: str(a.MOE_DISTRICT),
        SWP_AREA_NAME: str(a.SWP_AREA_NAME),
        LINKSOURCE: str(a.LINKSOURCE),
        "geometry/x": geometry?.x != null ? str(geometry.x) : "",
        "geometry/y": geometry?.y != null ? str(geometry.y) : "",
        PDF_URL: pdfLink ? `https://www.accessenvironment.ene.gov.on.ca/AEWeb/ae/ViewDocument.action?documentRefID=${pdfLink}` : "",
        PDF_SITE_LOCATION: "",
        PDF_NAICS_Code: "",
      };
    });
    return { rows, reachable: true, error: null, checkedAt };
  } catch (err) {
    return { rows: [], reachable: false, error: err instanceof Error ? err.message : String(err), checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

const MEATLIST_QUERY_URL = "https://apps.inspection.canada.ca/webapps/MeatList/Home/Results";

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Queries the live CFIA "federally registered meat establishments" list
 *  (apps.inspection.canada.ca/webapps/MeatList) — a real, current CFIA app
 *  confirmed via direct testing to return every registered establishment as
 *  server-rendered HTML in one GET, no bot wall. (ABM's originally-named
 *  URL, inspection.canada.ca/.../regresults.asp, is a decommissioned legacy
 *  ASP endpoint that now 404s — CFIA migrated to Drupal 10 years ago; this
 *  is the real replacement serving the same registry.) There's no
 *  structured query API here like ECA_ON's ArcGIS layer, so this parses the
 *  same HTML table a browser would render, matching the shape the onboarded
 *  snapshot in abm-source-data.ts already uses. */
export async function fetchMeatListLive(): Promise<RegistryLiveOutcome> {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(MEATLIST_QUERY_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) return { rows: [], reachable: false, error: `HTTP ${res.status}`, checkedAt };
    const html = await res.text();
    const tbodyStart = html.indexOf("<tbody");
    const tbodyEnd = html.indexOf("</tbody>", tbodyStart);
    if (tbodyStart === -1 || tbodyEnd === -1) {
      return { rows: [], reachable: false, error: "Results table not found in response", checkedAt };
    }
    const tbody = html.slice(tbodyStart, tbodyEnd);
    const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
    const rows: Record<string, string>[] = [];
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tbody))) {
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      const tds: string[] = [];
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowMatch[1]))) tds.push(tdMatch[1]);
      if (tds.length < 4) continue;
      const registrationNumber = decodeHtmlEntities(tds[0]!.replace(/<[^>]+>/g, " "));
      const col2 = tds[1]!;
      const nameMatch = col2.match(/<strong>([^<]+)<\/strong>/);
      const companyName = nameMatch ? decodeHtmlEntities(nameMatch[1]!) : "";
      const locMatch = col2.match(/Location Address:\s*:?\s*<\/strong>\s*<br\s*\/?>\s*<div>([^<]*)<\/div>/);
      const locationAddress = locMatch ? decodeHtmlEntities(locMatch[1]!) : "";
      const mailMatch = col2.match(/Mailing Address:\s*:?\s*<\/strong>\s*<br\s*\/?>\s*<div>\s*([^<]*)<\/div>/);
      const mailingAddress = mailMatch ? decodeHtmlEntities(mailMatch[1]!) : "";
      const functionCodes = [...tds[2]!.matchAll(/<span>([^<]*)<\/span>/g)]
        .map((x) => decodeHtmlEntities(x[1] ?? ""))
        .filter(Boolean)
        .join(" ")
        .replace(/,\s*$/, "")
        .trim();
      const phone = [...tds[3]!.matchAll(/<span>([^<]*)<\/span>/g)]
        .map((x) => decodeHtmlEntities(x[1] ?? ""))
        .filter(Boolean)
        .join("; ");
      if (!registrationNumber && !companyName) continue;
      rows.push({
        Registration_Number: registrationNumber,
        Company_Name: companyName,
        Location_Address: locationAddress,
        Mailing_Address: mailingAddress,
        Function_Codes: functionCodes,
        Phone_Number: phone,
      });
    }
    return { rows, reachable: true, error: null, checkedAt };
  } catch (err) {
    return { rows: [], reachable: false, error: err instanceof Error ? err.message : String(err), checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

/** Diffs freshly-queried registry rows against the on-file baseline, keyed
 *  by a stable business key (APPROVAL_NUMBER) rather than a row position —
 *  reuses the same field-level diffFields() logic (blank-handling,
 *  normalization, invisible-character stripping) already proven across
 *  NTM/ESG's live-refresh, just applied to a bulk query result instead of
 *  one AI-extracted webpage per entity. */
export function diffRegistrySnapshot(
  baselineRows: Record<string, string>[],
  liveRows: Record<string, string>[],
  keyField: string,
  nameField: string,
  fields: string[],
): RegistryDiffRecord[] {
  const baselineByKey = new Map(baselineRows.map((r) => [r[keyField], r]));
  return liveRows.map((live, index) => {
    const key = live[keyField] ?? "";
    const baseline = baselineByKey.get(key) ?? {};
    return { key, name: live[nameField] || key, diffs: diffFields(fields, baseline, live), index };
  });
}
