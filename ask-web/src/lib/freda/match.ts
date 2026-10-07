import type { AgentRecord, Catalog, SolutionRecord, SolutionSourceRecord } from "@/lib/catalog/types";
import { regionCodeForCountry } from "./extract";
import type { AgentHit, Gap, MatchKind, Requirement, SolutionHit } from "./types";

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "need",
  "want",
  "show",
  "list",
  "data",
  "in",
  "of",
  "a",
  "an",
  "to",
  "me",
  "i",
  "please",
]);

const SYNONYMS: Record<string, string[]> = {
  hotels: ["hotel", "hospitality", "venue", "venues", "tariff"],
  hotel: ["hotels", "hospitality", "venue", "tariff"],
  pricing: ["price", "prices", "tariff", "nightly"],
  price: ["pricing", "prices", "tariff"],
  hospitals: ["hospital", "healthcare", "clinic", "doctor", "provider"],
  hospital: ["hospitals", "healthcare", "clinic", "physician"],
  doctors: ["doctor", "physician", "practitioners"],
  specialties: ["speciality", "specialty"],
  flights: ["flight", "airline", "travel"],
  flight: ["flights", "airline", "travel"],
  amazon: ["marketplace", "ecommerce", "e-commerce", "product"],
};

const USE_CASE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "financial_filings", pattern: /\b(annual reports?|financial statements?|filings?|bse|nse|edgar)\b/i },
  { name: "healthcare", pattern: /\b(hospitals?|clinics?|doctors?|physicians?|healthcare|providers?)\b/i },
  { name: "hospitality", pattern: /\b(hotel|resort|restaurant|venue|hospitality|tariff)\b/i },
  { name: "travel", pattern: /\b(flights?|airlines?|ota|kayak)\b/i },
  { name: "education", pattern: /\b(school districts?|public schools?|k-12|teachers?|nces)\b/i },
  { name: "registry", pattern: /\b(registry|gst|companies house|lei|beneficial owner|incorporation)\b/i },
  { name: "legal", pattern: /\b(attorney|advocate|law firm)\b/i },
  { name: "company_directory", pattern: /\b(firmographic|company profiles?|tech(?:nology)? companies|list of (?:tech(?:nology)? )?companies|address and phone)\b/i },
];

function useCasesOf(text: string, req: Requirement): Set<string> {
  const found = new Set<string>();
  const blob = [text, req.entityType, req.industry, req.objective].filter(Boolean).join(" ");
  for (const entry of USE_CASE_PATTERNS) {
    if (entry.pattern.test(blob)) found.add(entry.name);
  }
  if (/hotels?/i.test(req.entityType || text)) {
    found.add("hospitality");
    if (req.attributes.some((attr) => /pric|avail|review/i.test(attr))) found.add("travel");
  }
  if (/flights?|airlines?/i.test(req.entityType || text)) found.add("travel");
  if (/school districts?|teachers?/i.test(req.entityType || text)) found.add("education");
  if (/compan/i.test(req.entityType || "") && !found.has("registry") && !found.has("financial_filings")) {
    found.add("company_directory");
  }
  return found;
}

function solutionUseCases(solution: SolutionRecord): Set<string> {
  const blob = `${solution.id} ${solution.name} ${solution.category} ${solution.tagline} ${solution.description}`;
  const found = new Set<string>();
  for (const entry of USE_CASE_PATTERNS) {
    if (entry.pattern.test(blob)) found.add(entry.name);
  }
  if (solution.id === "ds-travel") {
    found.add("travel");
    found.add("hospitality");
  }
  if (solution.id === "ds-hospitality-venues") found.add("hospitality");
  if (solution.id === "ds-healthcare-providers") found.add("healthcare");
  if (solution.id === "ds-firmographic") found.add("company_directory");
  if (solution.id === "ds-financial") found.add("financial_filings");
  if (solution.id === "ds-registry") found.add("registry");
  if (solution.id === "ds-us-public-school-district-workforce") found.add("education");
  if (solution.id === "ds-funding") found.add("funding");
  return found;
}

function tokens(text: string): string[] {
  const base = text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
  const extra: string[] = [];
  for (const token of base) {
    extra.push(...(SYNONYMS[token] ?? []));
  }
  return [...new Set([...base, ...extra])];
}

function overlap(a: string, b: string): number {
  const setB = new Set(tokens(b));
  return tokens(a).filter((token) => setB.has(token)).length;
}

function countryMatches(agentCountry: string, wanted?: string): boolean {
  if (!wanted || !agentCountry) return false;
  const a = agentCountry.toLowerCase();
  const w = wanted.toLowerCase();
  if (a === w) return true;
  if (wanted === "US" && ["us", "usa"].includes(a)) return true;
  if (wanted === "UK" && ["uk", "united kingdom"].includes(a)) return true;
  if (wanted === "India" && ["india", "in", "delhi"].includes(a)) return true;
  return a.includes(w) || w.includes(a);
}

function refreshCovers(options: string[], cadence: string, requested?: string): { ok: boolean; gap?: string } {
  if (!requested) return { ok: true };
  const blob = `${options.join(" ")} ${cadence}`.toLowerCase();
  const req = requested.toLowerCase();
  if (req.includes("15") && (blob.includes("real-time") || blob.includes("custom") || blob.includes("on-demand"))) {
    return {
      ok: false,
      gap: `Requested ${requested}; this capability lists ${cadence} as default (options include ${options.join(", ")}). Sub-hourly status cadence is not explicitly indexed.`,
    };
  }
  if (req.includes("real-time") && blob.includes("real-time")) return { ok: true };
  if (req.includes("hourly") && (blob.includes("hourly") || blob.includes("real-time"))) return { ok: true };
  if (req.includes("daily") && blob.includes("daily")) return { ok: true };
  if (req.includes("weekly") && blob.includes("weekly")) return { ok: true };
  if (req.includes("monthly") && blob.includes("monthly")) return { ok: true };
  if (req.includes("quarterly") && blob.includes("quarterly")) return { ok: true };
  if (blob.includes(req.split(" ")[0])) return { ok: true };
  return {
    ok: false,
    gap: `Requested refresh ${requested} is not listed on this capability (default ${cadence}; options: ${options.join(", ") || "not specified"}).`,
  };
}

function toAgentHit(agent: AgentRecord, score: number, reasons: string[]): AgentHit {
  return {
    id: agent.id,
    name: agent.name,
    sourceUrl: agent.sourceUrl,
    category: agent.category,
    industry: agent.industry,
    country: agent.country,
    dataType: agent.dataType,
    description: agent.description,
    complexity: agent.complexity,
    datapoints: agent.datapoints,
    project: agent.project,
    estimatedRecords: agent.estimatedRecords,
    score,
    reasons,
  };
}

function toSolutionHit(
  solution: SolutionRecord,
  sources: SolutionSourceRecord[],
  score: number,
  reasons: string[],
): SolutionHit {
  return {
    id: solution.id,
    name: solution.name,
    category: solution.category,
    tagline: solution.tagline,
    description: solution.description,
    coverage: solution.coverage,
    accuracy: solution.accuracy,
    countriesCovered: solution.countriesCovered,
    refreshCadence: solution.refreshCadence,
    refreshOptions: solution.refreshOptions,
    sourceCount: solution.sourceCount,
    sourceNames: solution.sourceNames,
    attributeCount: solution.attributeCount,
    attributes: solution.attributes,
    records: solution.records,
    score,
    reasons,
    relatedSources: sources,
  };
}

export interface MatchResult {
  kind: MatchKind;
  agents: AgentHit[];
  solutions: SolutionHit[];
  gaps: Gap[];
}

export function matchRequirement(query: string, req: Requirement, catalog: Catalog): MatchResult {
  const q = query.toLowerCase();
  const wantedCases = useCasesOf(query, req);
  const agentHits: AgentHit[] = [];

  for (const agent of catalog.agents) {
    let score = 0;
    const reasons: string[] = [];
    const hay = [agent.name, agent.category, agent.industry, agent.dataType, agent.description, agent.country]
      .join(" ")
      .toLowerCase();

    if (req.sources.some((source) => sourceOverlapsAgent(source, agent))) {
      score += 100;
      reasons.push(`Named source matches Agent ${agent.name}`);
    } else if (hasLooseName(q, agent.name)) {
      score += 85;
      reasons.push(`Query names Agent ${agent.name}`);
    }

    if (agent.hostname && q.includes(agent.hostname)) {
      score += 90;
      reasons.push(`Source domain ${agent.hostname} appears in the request`);
    }

    if (countryMatches(agent.country, req.country)) {
      score += 22;
      reasons.push(`Geography ${agent.country}`);
    }

    const semantic = overlap(
      query,
      `${agent.name} ${agent.category} ${agent.industry} ${agent.dataType} ${agent.description}`,
    );
    if (semantic) {
      score += semantic * 8;
      if (semantic >= 2) reasons.push(`Data/entity overlap with ${agent.dataType || agent.category}`);
    }

    if (req.entityType && hay.includes(req.entityType.split(" ")[0].toLowerCase())) {
      score += 10;
    }

    if (score >= 25) agentHits.push(toAgentHit(agent, score, reasons));
  }

  agentHits.sort((a, b) => b.score - a.score);
  const topAgents = uniqueBy(cutHits(agentHits, 40), (hit) => `${hit.name}|${hit.sourceUrl}`).slice(0, 6);

  const solutionHits: SolutionHit[] = [];
  for (const solution of catalog.solutions) {
    const related = catalog.sources.filter((source) => source.solutionId === solution.id);
    let score = 0;
    const reasons: string[] = [];
    const blob = [
      solution.name,
      solution.category,
      solution.tagline,
      solution.description,
      solution.sourceNames.join(" "),
      solution.attributes.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    const solCases = solutionUseCases(solution);
    const shared = [...wantedCases].some((item) => solCases.has(item));
    if (wantedCases.size && !shared) continue;

    const semantic = overlap(query, blob);
    score += semantic * 6;
    if (semantic >= 2) reasons.push(`Use-case overlap with ${solution.name}`);

    if (req.industry && solution.category.toLowerCase().includes(req.industry.toLowerCase())) {
      score += 35;
      reasons.push(`Category ${solution.category}`);
    } else if (req.industry && blob.includes(req.industry.toLowerCase())) {
      score += 20;
      reasons.push(`Industry mentioned on ${solution.name}`);
    }

    for (const attr of req.attributes) {
      const found = solution.attributes.some((item) => item.toLowerCase().includes(attr.toLowerCase())) ||
        blob.includes(attr.toLowerCase());
      if (found) {
        score += 12;
        reasons.push(`Attribute coverage: ${attr}`);
      }
    }

    for (const sourceName of req.sources) {
      const onSolution = solution.sourceNames.some((item) =>
        item.toLowerCase().includes(sourceName.toLowerCase()),
      );
      const onRows = related.some((row) => row.name.toLowerCase().includes(sourceName.toLowerCase()));
      if (onSolution || onRows) {
        score += 40;
        reasons.push(`Source ${sourceName} is listed on this Solution`);
      }
    }

    const regions = regionCodeForCountry(req.country);
    const regionHits = related.filter(
      (row) =>
        regions.some((code) => row.region.toUpperCase() === code.toUpperCase()) ||
        sourceLooksLikeCountry(row.name, req.country),
    );
    if (regionHits.length) {
      score += 22;
      reasons.push(
        `${req.country} sources on this Solution: ${regionHits
          .map((row) => row.name)
          .slice(0, 4)
          .join(", ")}`,
      );
    }

    if (req.frequency) {
      const refresh = refreshCovers(solution.refreshOptions, solution.refreshCadence, req.frequency);
      if (refresh.ok) {
        score += 10;
        reasons.push(`Refresh options include a path for ${req.frequency}`);
      }
    }

    if (score >= 24) solutionHits.push(toSolutionHit(solution, related, score, reasons));
  }

  solutionHits.sort((a, b) => b.score - a.score);
  const topSolutions = cutHits(solutionHits, 36).slice(0, 4);

  const gaps = collectGaps(req, topAgents, topSolutions, catalog);
  const bestAgent = topAgents[0]?.score ?? 0;
  const bestSolution = topSolutions[0]?.score ?? 0;
  const best = Math.max(bestAgent, bestSolution);

  let kind: MatchKind = "none";
  if (best >= 80 && gaps.filter((gap) => gap.field !== "city").length === 0) {
    kind = "existing";
  } else if (best >= 80 && gaps.length <= 1 && !gaps.some((gap) => gap.field === "source-missing")) {
    kind = "existing";
  } else if (best >= 55 && gaps.length <= 2) {
    kind = gaps.length ? "partial" : "existing";
  } else if (best >= 40) {
    kind = "partial";
  } else {
    kind = "none";
  }

  if (kind === "existing" && gaps.some((gap) => gap.field === "source-missing" || gap.field === "refresh" || gap.field === "attribute")) {
    kind = "partial";
  }

  return { kind, agents: topAgents, solutions: topSolutions, gaps };
}

function cutHits<T extends { score: number }>(hits: T[], minKeep: number): T[] {
  if (!hits.length) return [];
  const max = hits[0].score;
  const floor = max >= 90 ? Math.max(75, max - 40) : minKeep;
  return hits.filter((hit) => hit.score >= floor);
}

function sourceOverlapsAgent(source: string, agent: AgentRecord): boolean {
  const sourceLower = source.toLowerCase();
  const nameLower = agent.name.toLowerCase();
  if (sourceLower === nameLower) return true;
  if (nameLower.length > 5 && sourceLower.includes(nameLower)) return true;
  const acronym = source.match(/^([A-Z]{2,5})\b/);
  if (acronym) {
    const code = acronym[1].toLowerCase();
    if (nameLower.startsWith(code) || nameLower.includes(` ${code} `)) return true;
    const host = agent.hostname.split(".")[0] ?? "";
    if (host.startsWith(code) && code.length >= 3) return true;
  }
  return false;
}

function sourceLooksLikeCountry(sourceName: string, country?: string): boolean {
  if (!country) return false;
  const n = sourceName.toLowerCase();
  if (n.includes(country.toLowerCase())) return true;
  if (country === "India") {
    return /\b(mca|bse|nse|practo|makemytrip|goibibo|policybazaar|irdai|fssai|nabh|cardekho|carwale|udyam|gst|apollo|lybrate|justdial|sulekha|vakilsearch|lawrato|zoomcar|revv|savaari|vahan|bar council of india)\b/i.test(
      n,
    );
  }
  if (country === "UK") return /\b(companies house|rightmove|argos|john lewis)\b/i.test(n);
  if (country === "US") return /\b(sec edgar|zillow|realtor|walmart|target)\b/i.test(n);
  return false;
}

function hasLooseName(query: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  const pattern = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return pattern.test(query);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function collectGaps(
  req: Requirement,
  agents: AgentHit[],
  solutions: SolutionHit[],
  catalog: Catalog,
): Gap[] {
  const gaps: Gap[] = [];

  if (req.city) {
    const cityInCatalog = [...agents, ...solutions].some((hit) =>
      JSON.stringify(hit).toLowerCase().includes(req.city!.toLowerCase()),
    );
    if (!cityInCatalog) {
      gaps.push({
        field: "city",
        detail: `City-level coverage for ${req.city} is not explicitly indexed. Country/market matching was used instead.`,
      });
    }
  }

  if (req.country && agents.length === 0) {
    const countryAgents = catalog.agents.filter((agent) => countryMatches(agent.country, req.country)).length;
    if (countryAgents === 0 && solutions.every((sol) => sol.relatedSources.every((src) => !src.region))) {
      gaps.push({
        field: "geography",
        detail: `No Agent in the catalog is explicitly tagged for ${req.country}.`,
      });
    }
  }

  for (const source of req.sources) {
    if (/company websites?/i.test(source)) continue;
    const agentExists = catalog.agents.some((agent) => sourceOverlapsAgent(source, agent));
    const sourceExists = catalog.sources.some((row) => row.name.toLowerCase().includes(source.toLowerCase()));
    if (!agentExists && sourceExists) {
      gaps.push({
        field: "source-missing",
        detail: `${source} appears as a Solution source, but no dedicated Agent is indexed under that name.`,
      });
    } else if (!agentExists && !sourceExists) {
      gaps.push({
        field: "source-missing",
        detail: `${source} is not present in the Agent or source catalog.`,
      });
    }
  }

  if (req.frequency && solutions.length) {
    const refresh = refreshCovers(
      solutions[0].refreshOptions,
      solutions[0].refreshCadence,
      req.frequency,
    );
    if (!refresh.ok && refresh.gap) {
      gaps.push({ field: "refresh", detail: refresh.gap });
    }
  }

  for (const attr of req.attributes) {
    const covered = solutions.some(
      (sol) =>
        sol.attributes.some((item) => item.toLowerCase().includes(attr.toLowerCase())) ||
        sol.tagline.toLowerCase().includes(attr.toLowerCase()) ||
        sol.description.toLowerCase().includes(attr.toLowerCase()),
    ) || agents.some((agent) => `${agent.dataType} ${agent.description}`.toLowerCase().includes(attr.toLowerCase()));
    if (!covered && /status/i.test(attr)) {
      gaps.push({
        field: "attribute",
        detail: `Requested field “${attr}” is not listed on the closest catalog capabilities (they describe price, product, or availability fields instead).`,
      });
    }
  }

  return uniqueBy(gaps, (gap) => gap.detail);
}

export function suggestSources(req: Requirement, catalog: Catalog, solutionIds: string[]): SolutionSourceRecord[] {
  const regions = regionCodeForCountry(req.country);
  const pool = solutionIds.length
    ? catalog.sources.filter((source) => solutionIds.includes(source.solutionId))
    : catalog.sources;

  const ranked = pool
    .map((source) => {
      let score = 0;
      if (regions.some((code) => source.region.toUpperCase() === code.toUpperCase())) score += 5;
      if (req.country && source.name.toLowerCase().includes(req.country.toLowerCase())) score += 3;
      if (req.entityType && source.solutionName.toLowerCase().includes(req.entityType.split(" ")[0].toLowerCase())) {
        score += 2;
      }
      return { source, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.source);

  const unique = uniqueBy(ranked, (row) => row.name.toLowerCase());
  return unique.slice(0, 8);
}
