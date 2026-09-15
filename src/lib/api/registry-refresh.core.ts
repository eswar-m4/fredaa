// Live refresh for bulk single-portal registries and directory listings —
// unlike a webpage-per-record check, there's nothing for an LLM to read
// here, so this queries/scrapes the real underlying dataset directly (one
// or a few plain HTTP GETs, no per-record website visits) and diffs the
// result. Three registries today: ECA_ON (a genuine, unprotected ArcGIS
// Feature Layer REST endpoint), CFIA's MeatList (a genuine, unprotected
// server-rendered HTML table), and ABM's bundled directory listings
// (Canadian Meat Council / CPMA / OFVGA — 3 genuine, unprotected pages,
// merged into one row set). LUST_AZ and SPL_CT_HAZCONNECT were also tested
// and are both behind a Cloudflare challenge wall — "Attention Required" —
// so they can't get the same treatment without bypassing bot protection,
// which this app doesn't do.
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
  /** The full fresh live row — callers use this to build a real per-record
   *  "Source" link (e.g. ECA_ON's own PDF_URL column, or a registry search
   *  filtered down to just this one entry) instead of pointing every record
   *  at the same generic listing page. */
  row: Record<string, string>;
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

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchHtml(url: string, timeoutMs = 20000): Promise<{ html: string | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) return { html: null, error: `HTTP ${res.status}` };
    return { html: await res.text(), error: null };
  } catch (err) {
    return { html: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

const CMC_MEMBERS_URL = "https://meatcouncil.ca/about-us/our-members/";
const CPMA_MEMBERS_URL = "https://cpma.ca/about-us/members/";
const OFVGA_ABOUT_URL = "https://www.ofvga.org/who-we-are";

/** Canadian Meat Council's real member grid — logo images linking to each
 *  member's own real website, confirmed via direct testing (170 real
 *  companies, no bot wall). The grid never populates the `alt` attribute,
 *  so Company_Name here is a placeholder derived from the logo filename —
 *  the real per-company name is only knowable by visiting that company's
 *  own site, which this bulk directory-level check deliberately doesn't do
 *  (that's a different, much slower kind of check). */
function parseCmcMembers(html: string): Record<string, string>[] {
  const idx = html.indexOf("member-companies-grid");
  if (idx === -1) return [];
  const section = html.slice(idx, idx + 200000);
  const anchorRe = /<a\s+href="([^"]+)"><img[^>]*?src="([^"]+)"/g;
  const rows: Record<string, string>[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(section))) {
    const href = m[1]!.trim();
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    const filename = (m[2]!.split("/").pop() || "").replace(/\.(jpg|jpeg|png|gif|svg)$/i, "").replace(/-\d+x\d+$/, "");
    const cleaned = filename
      .replace(/[-_]+/g, " ")
      .replace(/\b(logo|final|vector|new|cor|cmjn|image|rgb|copy|sm|stacked|black|hi|rez|high)\b/gi, "")
      .trim()
      .replace(/\s+/g, " ");
    let host = "";
    try {
      host = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      host = href;
    }
    const name = cleaned.length > 1 ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : host;
    rows.push({ Company_Name: name, Website: href, Source_Association: "Canadian Meat Council", Address: "", Business_Description: "" });
  }
  return rows;
}

/** CPMA's real member list — a plain name list, no per-member links or
 *  contact details published on the page itself (confirmed via direct
 *  testing: 909 real members). */
function parseCpmaMembers(html: string): Record<string, string>[] {
  const idx = html.indexOf('class="members"');
  if (idx === -1) return [];
  const end = html.indexOf("</ul>", idx);
  const section = html.slice(idx, end === -1 ? undefined : end);
  return [...section.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => ({
    Company_Name: decodeHtmlEntities(m[1]!),
    Website: "",
    Source_Association: "Canadian Produce Marketing Association",
    Address: "",
    Business_Description: "",
  }));
}

/** OFVGA is a federation of affiliated grower associations, not individual
 *  companies — real list, no per-org links or contact details published
 *  (confirmed via direct testing: 14 real affiliates). */
function parseOfvgaAffiliates(html: string): Record<string, string>[] {
  const idx = html.indexOf("Membership</h3>");
  if (idx === -1) return [];
  const end = html.indexOf("</ul>", idx);
  const section = html.slice(idx, end === -1 ? undefined : end + 5);
  return [...section.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => ({
    Company_Name: decodeHtmlEntities(m[1]!),
    Website: "",
    Source_Association: "Ontario Fruit and Vegetable Growers' Association",
    Address: "",
    Business_Description: "",
  }));
}

/** Re-scrapes all 3 directory listing pages that actually publish a real,
 *  bot-wall-free member/affiliate list (Canadian Meat Council, CPMA, OFVGA)
 *  and merges them into one combined row set, matching the shape
 *  abm-source-data.ts's static snapshot already uses. This is 3 plain HTTP
 *  GETs + HTML parsing — no LLM, no per-company website visits — so it
 *  completes in a few seconds instead of the many minutes a per-company
 *  check across hundreds of real sites would take. Meat & Poultry Ontario
 *  and QPMA don't publish a scrapable directory (login/JS-gated), so
 *  they're checked separately as companion reachability pages, not here. */
export async function fetchAbmDirectoryLive(): Promise<RegistryLiveOutcome> {
  const checkedAt = new Date().toISOString();
  const [cmc, cpma, ofvga] = await Promise.all([
    fetchHtml(CMC_MEMBERS_URL),
    fetchHtml(CPMA_MEMBERS_URL),
    fetchHtml(OFVGA_ABOUT_URL),
  ]);

  const rows: Record<string, string>[] = [
    ...(cmc.html ? parseCmcMembers(cmc.html) : []),
    ...(cpma.html ? parseCpmaMembers(cpma.html) : []),
    ...(ofvga.html ? parseOfvgaAffiliates(ofvga.html) : []),
  ];

  const failures = [
    cmc.error ? `Canadian Meat Council: ${cmc.error}` : null,
    cpma.error ? `CPMA: ${cpma.error}` : null,
    ofvga.error ? `OFVGA: ${ofvga.error}` : null,
  ].filter((x): x is string => x !== null);

  return {
    rows,
    reachable: rows.length > 0,
    error: failures.length > 0 ? failures.join("; ") : null,
    checkedAt,
  };
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
    return { key, name: live[nameField] || key, diffs: diffFields(fields, baseline, live), index, row: live };
  });
}
