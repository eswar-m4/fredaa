// Real extraction for directory/listing pages — one page that lists MANY
// companies or contacts (a business directory, a member list), as opposed
// to monitoring-refresh.core.ts's engine which treats one URL as one
// entity.
//
// Two extraction paths, tried in order:
//   1. Deterministic HTML-table parsing (parseHtmlTable) — most real
//      directory sites (city business directories, chamber-of-commerce
//      listings, member rosters) render their data as a plain <table> with
//      a header row. When one is found, every row is read exactly as
//      published — real column headers become the field names, real cell
//      text becomes the values. No LLM involved, so no row cap and no risk
//      of a paraphrased/invented value.
//   2. AI page-reading fallback (the original approach) — for listing
//      pages that aren't a plain table (card grids, freeform text lists).
//      Reuses the same fetch/HTML-to-text/OpenAI plumbing as
//      monitoring-refresh.core.ts, asking for a JSON *array* of entities
//      instead of a flat field map for one named entity.
import * as cheerio from "cheerio";
import { htmlToText, callOpenAI, parseAiJson } from "./monitoring-refresh.core";

export type DirectoryExtractOutcome = {
  url: string;
  rows: Record<string, string>[];
  /** Field keys actually present on `rows` — from the real table's own
   *  headers when parseHtmlTable matched, otherwise the requested `fields`.
   *  The caller should trust this over the fields it asked for, since a
   *  real page's own schema is the ground truth. */
  fields: string[];
  fieldLabels: Record<string, string>;
  reachable: boolean;
  httpStatus: number | null;
  error: string | null;
  checkedAt: string;
  /** True when a real HTML <table> was parsed deterministically (no LLM
   *  involved) rather than AI-read from page text. */
  viaTable: boolean;
};

const MAX_PAGE_TEXT = 20000;
const MAX_ROWS_PER_PAGE = 80;
const MAX_TABLE_ROWS = 1000;

function slugifyHeader(h: string, idx: number): string {
  const s = h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || `field_${idx}`;
}

type ParsedTable = { keys: string[]; labels: Record<string, string>; rows: Record<string, string>[] };

/** Looks for the plain HTML <table> most likely to be the real listing
 *  (the one with the most data rows and a genuine header row), and reads it
 *  exactly as published. Picks href over visible text for a link cell whose
 *  own text is a generic button label ("Learn More", "View") rather than
 *  the real URL. Returns null when no page table looks like real tabular
 *  listing data (fewer than 2 header columns, or zero data rows) — the
 *  caller falls back to AI reading in that case. */
function parseHtmlTable(html: string): ParsedTable | null {
  const $ = cheerio.load(html);
  let best: ParsedTable | null = null;

  $("table").each((_, tableEl) => {
    const $table = $(tableEl);
    let $headerCells = $table.find("thead tr").first().find("th");
    if ($headerCells.length === 0) $headerCells = $table.find("tr").first().find("th");
    if ($headerCells.length < 2) return;

    const headerLabels = $headerCells
      .map((i, el) => $(el).text().trim())
      .get()
      .map((t) => t as string);
    if (headerLabels.filter(Boolean).length < 2) return;

    const seen = new Map<string, number>();
    const keys = headerLabels.map((h, i) => {
      const base = slugifyHeader(h, i);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return n > 1 ? `${base}_${n}` : base;
    });

    let $bodyRows = $table.find("tbody tr");
    if ($bodyRows.length === 0) $bodyRows = $table.find("tr").slice(1);

    const rows: Record<string, string>[] = [];
    $bodyRows.each((_, tr) => {
      const $cells = $(tr).find("td");
      if ($cells.length === 0) return;
      const row: Record<string, string> = {};
      $cells.each((ci, td) => {
        if (ci >= keys.length) return;
        const $td = $(td);
        const text = $td.text().trim().replace(/\s+/g, " ");
        const $link = $td.find("a[href]").first();
        let val = text;
        if ($link.length > 0) {
          const href = ($link.attr("href") ?? "").trim();
          if (href && (!text || text.length < 4 || /^(learn more|view|visit|website|link|details)$/i.test(text))) {
            val = href;
          }
        }
        row[keys[ci]!] = val;
      });
      if (Object.values(row).some((v) => v.trim())) rows.push(row);
    });

    if (rows.length === 0) return;
    const labels: Record<string, string> = {};
    keys.forEach((k, i) => {
      labels[k] = headerLabels[i] || k;
    });
    const candidate: ParsedTable = { keys, labels, rows: rows.slice(0, MAX_TABLE_ROWS) };
    if (!best || candidate.rows.length > best.rows.length) best = candidate;
  });

  return best;
}

function buildDirectoryPrompt(pageText: string, url: string, entityLabel: string, fields: string[], fieldMeta: Record<string, { label: string }>): string {
  const fieldLines = fields.map((f) => `  - ${f} = ${fieldMeta[f]?.label ?? f}`).join("\n");
  return `You are reading a directory/listing page and extracting every distinct ${entityLabel} it lists.

Source URL: ${url}

Page text below:
---
${pageText}
---

List EVERY distinct ${entityLabel} that this page actually names (a real listing entry — a company, organization or person), up to ${MAX_ROWS_PER_PAGE} of them. For each one, extract these fields where the page states them:
${fieldLines}

Rules:
- Only include an entry if the page genuinely names a specific ${entityLabel} — never invent one.
- For a field the page doesn't state for that entry, use an empty string "" (not "unknown"/"n/a"/null).
- Never use outside/general knowledge — only what this page's text actually says.
- If the page is navigation/menu text, an error page, or otherwise does not actually list any ${entityLabel}s, return an empty array.

Respond with ONLY a JSON object: {"entries": [ { ${fields.map((f) => `"${f}": "..."`).join(", ")} }, ... ]}. No prose, no markdown code fences.`;
}

async function fetchPage(url: string, timeoutMs = 20000): Promise<{ html: string | null; status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    });
    const html = await res.text();
    if (!res.ok) return { html: null, status: res.status, error: `HTTP ${res.status}` };
    return { html, status: res.status, error: null };
  } catch (err) {
    return { html: null, status: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches one directory/listing page and extracts every distinct entity it
 *  names, with real values only. Tries a deterministic table read first
 *  (see parseHtmlTable); only asks the AI to read the page when the page
 *  isn't a plain table. An unreachable page, a block page, or a page with
 *  no genuine listings all come back as zero rows plus a real reason,
 *  never guessed data. */
export async function extractDirectoryListing(
  url: string,
  fields: string[],
  fieldMeta: Record<string, { label: string }>,
  entityLabel: string,
  apiKey: string,
  model: string,
): Promise<DirectoryExtractOutcome> {
  const checkedAt = new Date().toISOString();
  const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const fetched = await fetchPage(normalizedUrl);
  if (!fetched.html) {
    return { url: normalizedUrl, rows: [], fields: [], fieldLabels: {}, reachable: false, httpStatus: fetched.status, error: fetched.error, checkedAt, viaTable: false };
  }

  const table = parseHtmlTable(fetched.html);
  if (table) {
    return {
      url: normalizedUrl,
      rows: table.rows,
      fields: table.keys,
      fieldLabels: table.labels,
      reachable: true,
      httpStatus: fetched.status,
      error: null,
      checkedAt,
      viaTable: true,
    };
  }

  const pageText = htmlToText(fetched.html).slice(0, MAX_PAGE_TEXT);
  if (!pageText.trim()) {
    return { url: normalizedUrl, rows: [], fields: [], fieldLabels: {}, reachable: true, httpStatus: fetched.status, error: "Page had no readable text", checkedAt, viaTable: false };
  }
  if (!apiKey) {
    return { url: normalizedUrl, rows: [], fields: [], fieldLabels: {}, reachable: true, httpStatus: fetched.status, error: "OPENAI_API_KEY not set", checkedAt, viaTable: false };
  }

  const fieldLabels: Record<string, string> = {};
  for (const f of fields) fieldLabels[f] = fieldMeta[f]?.label ?? f;

  try {
    const prompt = buildDirectoryPrompt(pageText, normalizedUrl, entityLabel, fields, fieldMeta);
    // Extracting up to MAX_ROWS_PER_PAGE structured entries is a lot of
    // completion tokens — confirmed via direct testing this can genuinely
    // take over a minute for a large real directory (CPMA's real 909-name
    // list took ~70s), so this needs a longer budget than a single-entity
    // extraction ever would.
    const raw = await callOpenAI(apiKey, model, prompt, 110000);
    const parsed = parseAiJson(raw) as { entries?: unknown };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const rows: Record<string, string>[] = entries.slice(0, MAX_ROWS_PER_PAGE).map((entry) => {
      const row: Record<string, string> = {};
      const obj = (entry ?? {}) as Record<string, unknown>;
      for (const f of fields) row[f] = obj[f] === null || obj[f] === undefined ? "" : String(obj[f]).trim();
      return row;
    });
    return { url: normalizedUrl, rows, fields, fieldLabels, reachable: true, httpStatus: fetched.status, error: null, checkedAt, viaTable: false };
  } catch (err) {
    return { url: normalizedUrl, rows: [], fields, fieldLabels, reachable: true, httpStatus: fetched.status, error: err instanceof Error ? err.message : String(err), checkedAt, viaTable: false };
  }
}

/** Runs extractDirectoryListing across several directory pages and merges
 *  the results into one row set plus a unified field list (first-seen
 *  order across pages — real pages sharing the same layout naturally
 *  produce the same keys, so this stays stable page to page). */
export async function extractDirectoryListings(
  urls: string[],
  fields: string[],
  fieldMeta: Record<string, { label: string }>,
  entityLabel: string,
  apiKey: string,
  model: string,
): Promise<{ rows: Record<string, string>[]; perPage: DirectoryExtractOutcome[]; checkedAt: string; fields: string[]; fieldLabels: Record<string, string> }> {
  const checkedAt = new Date().toISOString();
  const perPage = await Promise.all(urls.map((u) => extractDirectoryListing(u, fields, fieldMeta, entityLabel, apiKey, model)));
  const rows = perPage.flatMap((p) => p.rows);

  const fieldOrder: string[] = [];
  const fieldLabels: Record<string, string> = {};
  for (const p of perPage) {
    for (const f of p.fields) {
      if (!fieldOrder.includes(f)) fieldOrder.push(f);
      if (!fieldLabels[f]) fieldLabels[f] = p.fieldLabels[f] ?? f;
    }
  }

  return { rows, perPage, checkedAt, fields: fieldOrder, fieldLabels };
}
