/**
 * Ask Freda - capability matcher.
 *
 * Decides whether an already-onboarded agent or an existing solution template
 * satisfies the user's request, before any question is asked.
 *
 * Matching is domain-aware on purpose: a shared keyword is never enough.
 * "Amazon product pricing" must not resolve to an automotive dealer-pricing
 * template just because both mention pricing, so a candidate only survives when
 * its data family AND its domain (entity / sector / category) line up, and the
 * attributes the user asked for actually exist in the template's output.
 */
import { DATASETS, type Dataset } from "@/data/datasets";
import { VERTICAL_DATASETS } from "@/data/vertical-datasets";
import type { Family } from "@/lib/freda-intent";
import { FOCUS_ATTRIBUTES, type Focus, type SectorId } from "@/lib/freda-firmographic";

export type Coverage = "full" | "partial" | "none";

export type SolutionMatch = {
  dataset: Dataset;
  coverage: Exclude<Coverage, "none">;
  /** what the template does NOT cover - drives the follow-up questions */
  gaps: string[];
  /** plain-language reasons the template was picked */
  reasons: string[];
};

export type AgentMatch = {
  coverage: Exclude<Coverage, "none">;
  gaps: string[];
};

/* ----------------------------- domain mapping ----------------------------- */

/** Data family -> the only catalogue categories that can legitimately serve it. */
const FAMILY_CATEGORIES: Record<Family, Dataset["category"][]> = {
  product: ["Commerce", "Competitive"],
  firmographic: [
    "Company",
    "People",
    "Education",
    "Location",
    "Automotive",
    "Real Estate",
    "Travel",
    "Hospitality",
    "Healthcare",
    "Legal",
    "Insurance",
    "Jobs",
    "Financial",
    "News & Media",
  ],
};

/** Sector answered / detected -> categories that genuinely serve that sector. */
const SECTOR_CATEGORIES: Partial<Record<SectorId, Dataset["category"][]>> = {
  tech: ["Company", "Jobs"],
  bfsi: ["Financial", "Insurance", "Legal", "Company"],
  healthcare: ["Healthcare"],
  manufacturing: ["Company", "Automotive"],
  retail: ["Company", "Location"],
  travel: ["Hospitality", "Travel", "Location"],
  telecom: ["News & Media", "Company"],
  energy: ["Company"],
  services: ["Company", "Legal", "People"],
  generic: ["Company"],
};

/** Entity words that must appear in the template itself, not just the query. */
const stem = (w: string) => w.replace(/(ings|ing|ies|es|s)$/, "");
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
      .map(stem),
  );

const STOP = new Set([
  "data",
  "with",
  "from",
  "that",
  "this",
  "into",
  "list",
  "need",
  "want",
  "please",
  "scrape",
  "website",
  "websites",
  "site",
  "sites",
  "page",
  "pages",
  "every",
  "their",
  "info",
  "details",
  "dataset",
  "solution",
]);

function attributeLabels(d: Dataset) {
  return d.outputAttributes.map((a) => a.label.toLowerCase());
}

/** Does the template expose something for this focus area? */
function focusCovered(d: Dataset, focus: Focus) {
  const labels = attributeLabels(d).join(" | ");
  const wanted = FOCUS_ATTRIBUTES[focus] ?? [];
  return wanted.some((w) =>
    w
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((x) => x.length > 3 && !STOP.has(x))
      .some((x) => labels.includes(stem(x))),
  );
}

const FOCUS_LABEL: Record<Focus, string> = {
  reviews: "ratings & reviews",
  contact: "contact details",
  locations: "locations & addresses",
  financial: "financials",
  people: "people & leadership",
  tech: "technology stack",
  pricing: "pricing",
};

/* ------------------------------ agent match ------------------------------- */

/**
 * An onboarded agent fully covers the ask only when the user pointed at those
 * sites and nothing wider - no "all", no top-N, no multi-source comparison.
 */
export function assessAgentMatch(raw: string, opts: { agentHits: number; newSites: number; topN: number | null }): AgentMatch | null {
  if (!opts.agentHits) return null;
  const t = ` ${raw.toLowerCase()} `;
  const gaps: string[] = [];
  if (opts.newSites) gaps.push("the other sites you named are not onboarded yet");
  if (opts.topN) gaps.push("a ranked top-list has to be built first");
  if (/\b(all|every|across|compare|comparison|competitor|competitors|marketplaces|nationwide|country[- ]wide)\b/.test(t))
    gaps.push("you want coverage beyond those sites");
  return { coverage: gaps.length ? "partial" : "full", gaps };
}

/* ----------------------------- solution match ----------------------------- */

export function matchSolution(
  raw: string,
  ctx: { family: Family; sector: SectorId | null; focus: Focus[] },
): SolutionMatch | null {
  const catalog = [...VERTICAL_DATASETS, ...DATASETS];
  const allowed = new Set<string>(FAMILY_CATEGORIES[ctx.family]);
  const sectorCats = ctx.sector ? new Set<string>(SECTOR_CATEGORIES[ctx.sector] ?? []) : null;
  const want = tokens(raw);

  let best: { d: Dataset; score: number; entityHits: number; sectorHit: boolean } | null = null;

  for (const d of catalog) {
    if (!allowed.has(d.category)) continue;

    const sectorHit = sectorCats ? sectorCats.has(d.category) : false;
    // categories are listed best-first per sector, so honour that ranking
    const catRank = ctx.sector ? (SECTOR_CATEGORIES[ctx.sector] ?? []).indexOf(d.category) : -1;
    const rankBonus = catRank >= 0 ? Math.max(0, 3 - catRank) : 0;
    if (sectorCats && !sectorHit) continue; // wrong domain - never match on keywords alone

    const own = tokens(`${d.name} ${d.category} ${d.tagline}`);
    const entityHits = [...own].filter((w) => want.has(w)).length;
    const focusHits = ctx.focus.filter((f) => focusCovered(d, f)).length;

    // domain evidence is mandatory: either the sector maps to this category, or
    // the request names the same entity at least twice.
    // product asks have no sector to lean on, so one entity hit plus a covered
    // attribute is enough evidence; firmographic asks need two entity hits.
    const need = ctx.family === "product" ? 1 : 2;
    if (!sectorHit && (entityHits < need || (need === 1 && !focusHits))) continue;

    const descHits = [...tokens(d.description)].filter((w) => want.has(w)).length;
    const score = (sectorHit ? 4 : 0) + rankBonus + entityHits * 2 + focusHits + Math.min(descHits, 3) * 0.5;
    if (!best || score > best.score) best = { d, score, entityHits, sectorHit };
  }

  if (!best) return null;

  const gaps: string[] = [];
  for (const f of ctx.focus) if (!focusCovered(best.d, f)) gaps.push(FOCUS_LABEL[f]);

  const reasons: string[] = [];
  if (best.sectorHit) reasons.push(`same domain (${best.d.category})`);
  if (best.entityHits) reasons.push("same entity type");
  const covered = ctx.focus.filter((f) => focusCovered(best!.d, f));
  if (covered.length) reasons.push(`already carries ${covered.map((f) => FOCUS_LABEL[f]).join(", ")}`);

  // with no stated attribute focus we can't honestly claim full coverage
  const full = !gaps.length && ctx.focus.length > 0;
  return { dataset: best.d, coverage: full ? "full" : "partial", gaps, reasons };
}
