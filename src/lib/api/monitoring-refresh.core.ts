// Generic live-refresh engine, kept free of any createServerFn/TanStack
// Start server-context dependency so it can be unit-tested or run standalone
// (e.g. via a plain Node script), not only through the RPC wrapper in
// monitoring-refresh.functions.ts.
//
// This module knows nothing about hotels or points of interest specifically
// — every project (NTM Monitoring, NTM POI, …) supplies its own PromptConfig
// (field meanings/groups, entity language, subpage-discovery keywords) from
// src/lib/live-refresh-profiles.ts. The fetch/prompt/diff/dedupe machinery
// itself is shared and battle-tested across both.

export type FieldMeta = { group: string; label: string; indicator?: boolean };

/** Per-project language + field knowledge the engine needs to build a good
 *  prompt — everything dataset-specific lives here, nothing in this file. */
export type PromptConfig = {
  /** e.g. "hotel", "point of interest" — used in prompt copy. */
  entityLabel: string;
  /** field code -> category + plain-English meaning, for prompt grouping. */
  fieldMeta: Record<string, FieldMeta>;
  /** Keywords used to find worthwhile same-site subpages to also fetch. */
  relevantLinkKeywords: string[];
};

export type ChangeType = "Added" | "Deleted" | "Modified" | "Verified";

export type FieldDiff = {
  field: string;
  oldValue: string;
  newValue: string;
  changeType: ChangeType;
};

export type RefreshTarget = {
  id: string;
  name: string;
  url: string;
  currentValues: Record<string, string>;
};

export type HotelRefreshResult = {
  id: string;
  name: string;
  url: string;
  reachable: boolean;
  httpStatus: number | null;
  error: string | null;
  checkedAt: string;
  durationMs: number;
  diffs: FieldDiff[];
};

export type RefreshOutcome = {
  results: HotelRefreshResult[];
  checkedAt: string;
  aiConfigured: boolean;
  reachableCount: number;
  totalCount: number;
};

/** Boolean present/absent attributes (AmenRecPoolIndoorInd, ArptFreeTransInd1, …)
 *  — the workbook's X/Y/N convention applies to these, and only these. Naturally
 *  matches nothing for datasets (like POI) that don't use this convention. */
export function isIndicatorField(field: string): boolean {
  return /Ind\d*$/.test(field);
}

export function humanizeField(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
}

function describeField(config: PromptConfig, field: string): { group: string; label: string; indicator: boolean } {
  const meta = config.fieldMeta[field];
  return {
    group: meta?.group ?? "Other",
    label: meta?.label ?? humanizeField(field),
    indicator: meta?.indicator ?? isIndicatorField(field),
  };
}

const INDICATOR_HINT =
  "Fields marked [Yes/No] follow this workbook's convention: 'X' means the " +
  "source confirms it (present/true), 'N' means the source explicitly says " +
  "it's not offered (absent/false), and blank means the source doesn't " +
  "address it either way. Decide each one only from what the source text " +
  "actually says — never guess.";

// Signatures of bot-protection/challenge stub pages (Incapsula, Cloudflare,
// Akamai/PerimeterX, DataDome, generic "Access Denied" walls). These sites
// respond HTTP 200 with a tiny JS-challenge shell instead of real content —
// if fed to the AI as-is, the model has nothing real to read and can fall
// back on its own general knowledge instead of the actual page (e.g.
// guessing a well-known industry hotline number instead of reporting "no
// value found"). Caught here so the record is reported as blocked/unreachable
// instead of silently producing a hallucinated field value.
const BOT_BLOCK_SIGNATURES = [
  /incapsula/i,
  /request unsuccessful/i,
  /attention required[\s\S]{0,40}cloudflare/i,
  /checking your browser before accessing/i,
  /needs to review the security of your connection/i,
  /pardon our interruption/i,
  /datadome/i,
  /perimeterx/i,
  /access denied/i,
];

function looksLikeBotBlockPage(html: string, pageText: string): boolean {
  // Real pages can legitimately mention e.g. "access denied" deep in a
  // large page without being a block wall — only trust the signature when
  // the actual readable text is also suspiciously small, matching the
  // stub-page shape these challenge services actually return.
  if (pageText.length > 1500) return false;
  return BOT_BLOCK_SIGNATURES.some((re) => re.test(html) || re.test(pageText));
}

// Deterministic block/not-found responses — retrying the exact same request
// gets the exact same answer, so a retry would only waste time.
const NON_RETRYABLE_STATUS = new Set([401, 403, 404, 410]);

/** Fetches a page with one retry on genuinely transient failures (DNS hiccup,
 *  connection reset, timeout, 5xx/429) — not on deterministic block/not-found
 *  responses, where retrying identically can't change the outcome. The retry
 *  gets a longer timeout, since a slow-but-real site is a common cause of the
 *  first attempt timing out. */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  attempts = 2,
): Promise<{ html: string; httpStatus: number | null; error: string | null }> {
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeoutMs = 20000 + (attempt - 1) * 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: "follow", signal: controller.signal, headers });
      clearTimeout(timer);
      if (res.ok) return { html: await res.text(), httpStatus: res.status, error: null };
      lastStatus = res.status;
      if (NON_RETRYABLE_STATUS.has(res.status)) {
        return { html: "", httpStatus: res.status, error: `HTTP ${res.status}` };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 1500));
  }
  return { html: "", httpStatus: lastStatus, error: lastError };
}

function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

// Values the model sometimes echoes back when it means "I don't know" —
// treated the same as an actual empty value, not a real answer.
const BLANK_SENTINELS = new Set(["unknown", "n/a", "na", "null", "none", "nil", "-", "—", ""]);

function isBlankLike(value: string): boolean {
  return BLANK_SENTINELS.has(value.trim().toLowerCase());
}

// Zero-width/invisible characters the model can emit that render as nothing:
// U+200B-200D (zero-width space/non-joiner/joiner), U+2060 (word joiner),
// U+FEFF (zero-width no-break space / BOM), U+00AD (soft hyphen). Without
// stripping these, two values that look pixel-identical can compare unequal.
const INVISIBLE_CHARS_RE = new RegExp("[\u200B\u200C\u200D\u2060\uFEFF\u00AD]", "g");

function normalize(value: string): string {
  const text = value
    .normalize("NFKC")
    .replace(INVISIBLE_CHARS_RE, "")
    .replace(/[\s\n\r]+/g, " ")
    .trim()
    .toLowerCase();
  // Numeric values that only differ by formatting — "341.00" vs "341",
  // "$1,200" vs "1200", "60€" vs "60 EUR" — are the same value, not a real
  // change. Currency/percent symbols are stripped only for this equality
  // check; the original strings (with symbols intact) are still what's shown
  // and stored. Currency itself is tracked by its own dedicated field in
  // these datasets, so stripping the symbol here can't hide a real change.
  const numericCandidate = text
    .replace(/[$€£¥₹]/g, "")
    .replace(/\b(usd|eur|gbp|jpy|inr)\b/g, "")
    .replace(/,/g, "")
    .replace(/%$/, "")
    .trim();
  const asNumber = Number(numericCandidate);
  if (numericCandidate !== "" && Number.isFinite(asNumber)) return String(asNumber);
  return text;
}

/** Small HTML -> text extractor — no DOM/cheerio dependency needed for the
 *  purpose here: give the AI prompt readable page content. */
export function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutScripts.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/** Groups fields by their configured category, in first-seen order, so the
 *  prompt reads like a reference document instead of a flat list of
 *  abbreviated column codes. */
export function groupFieldsForPrompt(
  config: PromptConfig,
  fields: string[],
): Map<string, { field: string; label: string; indicator: boolean }[]> {
  const groups = new Map<string, { field: string; label: string; indicator: boolean }[]>();
  for (const field of fields) {
    const { group, label, indicator } = describeField(config, field);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ field, label, indicator });
  }
  return groups;
}

export function buildPrompt(
  config: PromptConfig,
  entityName: string,
  url: string,
  pageText: string,
  current: Record<string, string>,
  fields: string[],
): string {
  const groups = groupFieldsForPrompt(config, fields);
  const sections = [...groups.entries()].map(([group, items]) => {
    const lines = items.map(({ field, label, indicator }) => {
      const value = current[field];
      const shown = value && value.trim() ? `"${value}"` : "no value on file";
      const tag = indicator ? " [Yes/No]" : "";
      return `  - ${field} = ${label}${tag} (current: ${shown})`;
    });
    return `${group}:\n${lines.join("\n")}`;
  });
  const hasIndicatorFields = [...groups.values()].some((items) => items.some((i) => i.indicator));

  return `You are refreshing a ${config.entityLabel} data-monitoring record by reading the ${config.entityLabel}'s own website. Each field below is given as "code = plain-English meaning" so you understand exactly what's being asked, grouped by category.

${config.entityLabel[0]!.toUpperCase()}${config.entityLabel.slice(1)}: ${entityName}
Source URL: ${url}
${hasIndicatorFields ? INDICATOR_HINT : ""}

Website text below is split into "### Page: <url>" sections — the homepage
plus a few subpages that were also fetched because most fields aren't on the
homepage. Use whichever section actually answers each field; it's normal for
different fields to come from different pages.
---
${pageText}
---

For each field below, decide its CURRENT correct value using its plain-English
meaning and ONLY what the website text above actually says:
- If the website text clearly states the value for that meaning, return that
  value (a plain string or number — never the word "unknown", "n/a", or
  similar placeholder).${
    hasIndicatorFields
      ? `
- For a [Yes/No] field: return "X" if the website confirms it, "N" if the
  website explicitly says it's not available, or leave it out entirely if the
  website simply doesn't mention it.`
      : ""
  }
- If the website text does not address a field at all, and a current value is
  shown for it, repeat that exact current value unchanged.
- If the website text does not address a field, and there is no current
  value, return JSON null for it (not a string).
Never invent a value that isn't directly supported by the website text or the
current value shown — accuracy matters more than completeness. Use ONLY the
website text above, never outside/general knowledge — e.g. never guess a
well-known industry hotline, helpline, or vanity phone number just because it
would be a plausible fit for this type of business; if the page text doesn't
literally show a value, treat it as not found.

Fields, grouped by category:
${sections.join("\n\n")}

Respond with ONLY a single JSON object mapping each field CODE (not its
label) above to its value. No prose, no markdown code fences, no explanation.`;
}

export function parseAiJson(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in AI response");
  return JSON.parse(match[0]);
}

export async function callOpenAI(apiKey: string, model: string, prompt: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You extract structured data from website text and respond with strict JSON only.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI response had no content");
    return text as string;
  } finally {
    clearTimeout(timer);
  }
}

export function findRelevantLinks(html: string, baseUrl: string, keywords: string[], limit = 4): string[] {
  const base = new URL(baseUrl);
  const found = new Map<string, number>(); // url -> score (more keyword hits = higher priority)
  const linkRe = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const hrefRaw = m[1]!;
    const text = m[2]!.replace(/<[^>]+>/g, " ").toLowerCase();
    let url: URL;
    try {
      url = new URL(hrefRaw, base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    if (!/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    const key = url.toString();
    if (key === base.toString()) continue;

    const haystack = `${text} ${hrefRaw.toLowerCase()}`;
    const hits = keywords.filter((k) => haystack.includes(k)).length;
    if (hits === 0) continue;
    found.set(key, Math.max(found.get(key) ?? 0, hits));
  }
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url]) => url);
}

async function fetchPageText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FredaMonitoringRefresh/1.0)" },
    });
    if (!res.ok) return "";
    return htmlToText(await res.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

const MAX_COMBINED_TEXT = 24000;

/** Fetches the homepage plus a handful of same-site subpages likely to
 *  actually contain the tracked details, and combines them into one text
 *  blob for the AI, each section labelled with its URL. */
export async function gatherSiteText(homepageHtml: string, homepageUrl: string, keywords: string[]): Promise<string> {
  const sections = [`### Page: ${homepageUrl}\n${htmlToText(homepageHtml)}`];
  let total = sections[0]!.length;

  const subPages = findRelevantLinks(homepageHtml, homepageUrl, keywords);
  const subTexts = await Promise.all(subPages.map((u) => fetchPageText(u, 12000)));
  for (let i = 0; i < subPages.length; i++) {
    const text = subTexts[i];
    if (!text || !text.trim() || total >= MAX_COMBINED_TEXT) continue;
    const section = `### Page: ${subPages[i]}\n${text}`;
    sections.push(section);
    total += section.length;
  }
  return sections.join("\n\n").slice(0, MAX_COMBINED_TEXT);
}

export function diffFields(fields: string[], current: Record<string, string>, extracted: Record<string, unknown> | null): FieldDiff[] {
  return fields.map((field) => {
    const oldValue = (current[field] ?? "").trim();
    const oldIsBlankLike = isBlankLike(oldValue);
    const rawNew = extracted ? extracted[field] : undefined;
    let newValue = rawNew === null || rawNew === undefined ? oldValue : String(rawNew).trim();
    // The model sometimes echoes "UNKNOWN"/"N/A"/etc. instead of returning
    // null when it truly doesn't know — treat that as "no answer", not a value.
    if (isBlankLike(newValue) && !oldIsBlankLike) newValue = oldValue;
    else if (isBlankLike(newValue)) newValue = oldValue; // both sides blank-like ("N/A" etc) — nothing to report

    // A field whose ORIGINAL value was already a blank-like placeholder
    // ("N/A", "-", …) is treated as having no real value when deciding
    // Added/Deleted, so re-confirming "still nothing" doesn't read as a
    // deletion of data that was never really there.
    const oldEffective = oldIsBlankLike ? "" : oldValue;
    const newEffective = isBlankLike(newValue) ? "" : newValue;

    let changeType: ChangeType;
    if (!oldEffective && newEffective) changeType = "Added";
    else if (oldEffective && !newEffective) changeType = "Deleted";
    else if (normalize(oldValue) !== normalize(newValue)) changeType = "Modified";
    else changeType = "Verified";

    return { field, oldValue, newValue, changeType };
  });
}

export async function refreshOne(
  config: PromptConfig,
  target: RefreshTarget,
  fields: string[],
  apiKey: string,
  model: string,
): Promise<HotelRefreshResult> {
  const startedAt = Date.now();
  const base = { id: target.id, name: target.name, url: target.url, checkedAt: new Date().toISOString() };
  const url = normalizeUrl(target.url);

  if (!url) {
    return { ...base, reachable: false, httpStatus: null, error: "No URL", durationMs: 0, diffs: [] };
  }

  const fetchResult = await fetchWithRetry(url, { "User-Agent": "Mozilla/5.0 (compatible; FredaMonitoringRefresh/1.0)" });
  if (fetchResult.error) {
    return {
      ...base, reachable: false, httpStatus: fetchResult.httpStatus,
      error: fetchResult.error, durationMs: Date.now() - startedAt, diffs: [],
    };
  }
  const html = fetchResult.html;
  const httpStatus = fetchResult.httpStatus;

  const pageText = await gatherSiteText(html, url, config.relevantLinkKeywords);
  if (!pageText.trim()) {
    return { ...base, reachable: true, httpStatus, error: "Page had no readable text", durationMs: Date.now() - startedAt, diffs: [] };
  }
  if (looksLikeBotBlockPage(html, pageText)) {
    return {
      ...base, reachable: false, httpStatus,
      error: "Blocked by bot/security protection (site returned a challenge page, not real content)",
      durationMs: Date.now() - startedAt, diffs: [],
    };
  }

  if (!apiKey) {
    // No AI configured — reachability confirmed, but fields can't be re-extracted.
    return { ...base, reachable: true, httpStatus, error: "AI not configured", durationMs: Date.now() - startedAt, diffs: [] };
  }

  // One field at a time in a large prompt makes the model default to
  // "unchanged" for almost everything (verified empirically — a small
  // prompt against the same page text correctly found real answers the
  // full-field prompt missed). Splitting by category keeps each call
  // focused enough that the model actually reads for the answer instead of
  // playing it safe.
  const groups = [...groupFieldsForPrompt(config, fields).entries()];
  const extracted: Record<string, unknown> = {};
  const groupErrors: string[] = [];

  await Promise.all(
    groups.map(async ([groupName, items]) => {
      const groupFields = items.map((i) => i.field);
      try {
        const prompt = buildPrompt(config, target.name, target.url, pageText, target.currentValues, groupFields);
        const raw = await callOpenAI(apiKey, model, prompt, 45000);
        const parsed = parseAiJson(raw);
        // Only accept keys this group actually asked about — groups run in
        // parallel, and if a response ever echoes a field that belongs to a
        // different group (models don't always follow "only these fields"
        // perfectly), it must never be allowed to overwrite that other
        // group's answer depending on which call happens to finish last.
        for (const field of groupFields) {
          if (field in parsed) extracted[field] = parsed[field];
        }
      } catch (err) {
        groupErrors.push(`${groupName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  if (groupErrors.length === groups.length) {
    return {
      ...base, reachable: true, httpStatus,
      error: `AI extraction failed: ${groupErrors.join("; ")}`,
      durationMs: Date.now() - startedAt, diffs: [],
    };
  }

  return {
    ...base, reachable: true, httpStatus,
    error: groupErrors.length ? `Partial extraction — failed groups: ${groupErrors.join("; ")}` : null,
    durationMs: Date.now() - startedAt,
    diffs: diffFields(fields, target.currentValues, extracted),
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export async function runFullRefresh(
  config: PromptConfig,
  targets: RefreshTarget[],
  fields: string[],
  apiKey: string,
  model: string,
  // Each record now fans out into one OpenAI call per attribute group (~4-7),
  // so a lower record-level concurrency keeps total in-flight requests sane.
  concurrency = 3,
): Promise<RefreshOutcome> {
  const results = await mapWithConcurrency(targets, concurrency, (t) => refreshOne(config, t, fields, apiKey, model));
  return {
    results,
    checkedAt: new Date().toISOString(),
    aiConfigured: Boolean(apiKey),
    reachableCount: results.filter((r) => r.reachable).length,
    totalCount: results.length,
  };
}
