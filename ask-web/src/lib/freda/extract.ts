import type { Catalog } from "@/lib/catalog/types";
import type { IntentFamily, QueryKind, Requirement } from "./types";
import { emptyRequirement } from "./types";

const CITY_TO_COUNTRY: Record<string, string> = {
  chennai: "India",
  mumbai: "India",
  delhi: "India",
  bengaluru: "India",
  bangalore: "India",
  hyderabad: "India",
  kolkata: "India",
  pune: "India",
  london: "UK",
  manchester: "UK",
  birmingham: "UK",
  "new york": "US",
  chicago: "US",
  seattle: "US",
  sydney: "Australia",
  melbourne: "Australia",
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  India: ["india", "indian", "bharat"],
  US: ["us", "usa", "united states", "america", "american"],
  UK: ["uk", "united kingdom", "britain", "british", "england"],
  Australia: ["australia", "australian", "au"],
  Canada: ["canada", "canadian"],
  Germany: ["germany", "german"],
  France: ["france", "french"],
  Singapore: ["singapore"],
  UAE: ["uae", "dubai", "united arab emirates"],
  Italy: ["italy", "italian"],
  Thailand: ["thailand", "thai"],
  Portugal: ["portugal", "portuguese"],
  China: ["china", "chinese"],
  Japan: ["japan", "japanese"],
  Brazil: ["brazil", "brazilian"],
};

const FREQUENCY_PATTERNS: { pattern: RegExp; value: string; recurring: Requirement["recurring"] }[] =
  [
    { pattern: /\bevery\s+15\s*min(ute)?s?\b/i, value: "Every 15 minutes", recurring: "recurring" },
    { pattern: /\b15[-\s]?minute\b/i, value: "Every 15 minutes", recurring: "recurring" },
    { pattern: /\breal[-\s]?time\b|\blive\b/i, value: "Real-time", recurring: "recurring" },
    { pattern: /\bhourly\b|\bevery hour\b/i, value: "Hourly", recurring: "recurring" },
    { pattern: /\bdaily\b|\bevery day\b/i, value: "Daily", recurring: "recurring" },
    { pattern: /\bweekly\b|\bevery week\b/i, value: "Weekly", recurring: "recurring" },
    { pattern: /\bmonthly\b|\bevery month\b/i, value: "Monthly", recurring: "recurring" },
    { pattern: /\bquarterly\b/i, value: "Quarterly", recurring: "recurring" },
    { pattern: /\bon[-\s]?demand\b/i, value: "On-demand", recurring: "one-time" },
    { pattern: /\bone[-\s]?time\b|\bonce\b/i, value: "One-time", recurring: "one-time" },
  ];

const FAMILY_PATTERNS: { family: IntentFamily; pattern: RegExp; industry?: string; entity?: string }[] =
  [
    {
      family: "healthcare",
      pattern: /\b(hospital|hospitals|clinic|clinics|doctor|doctors|physician|healthcare|specialt(?:y|ies)|nabh|practo)\b/i,
      industry: "Healthcare",
      entity: "Healthcare providers",
    },
    {
      family: "hospitality",
      pattern: /\b(hotel|hotels|resort|restaurant|restaurants|venue|venues|hospitality|tariff|nightly)\b/i,
      industry: "Hospitality",
      entity: "Hotels, restaurants and venues",
    },
    {
      family: "travel",
      pattern: /\b(flight|flights|airline|ota|booking\.com|expedia|kayak|cruise|holiday package)\b/i,
      industry: "Travel",
      entity: "Travel data",
    },
    {
      family: "product",
      pattern: /\b(product|sku|pricing|price|prices|ecommerce|e-commerce|marketplace|amazon|walmart|asin)\b/i,
      industry: "Commerce",
      entity: "Product / pricing data",
    },
    {
      family: "financial",
      pattern: /\b(annual report|10-k|10-q|financial statement|filings?|balance sheet|p&l|bse|nse|edgar)\b/i,
      industry: "Financial",
      entity: "Financial statements / annual reports",
    },
    {
      family: "registry",
      pattern: /\b(registry|gst|gstin|mca|companies house|lei|beneficial owner|incorporation)\b/i,
      industry: "Company",
      entity: "Company registry / compliance records",
    },
    {
      family: "firmographic",
      pattern: /\b(firmographic|company profile|company data|b2b companies|headcount|technograph|tech(?:nology)? companies|list of (?:tech(?:nology)? )?companies)\b/i,
      industry: "Company",
      entity: "Companies",
    },
    {
      family: "jobs",
      pattern: /\b(job posting|job listings|open roles|indeed|careers page)\b/i,
      industry: "Jobs",
      entity: "Job postings",
    },
    {
      family: "legal",
      pattern: /\b(attorney|advocate|law firm|bar council|legal)\b/i,
      industry: "Legal",
      entity: "Attorneys and law firms",
    },
    {
      family: "insurance",
      pattern: /\b(insurance|premium|policybazaar|irdai)\b/i,
      industry: "Insurance",
      entity: "Insurance plans",
    },
    {
      family: "automotive",
      pattern: /\b(dealer|dealership|vin|car rental|automotive|used car|on-road price)\b/i,
      industry: "Automotive",
      entity: "Automotive inventory / dealers",
    },
    {
      family: "contacts",
      pattern: /\b(people|contacts|emails?|decision[-\s]?makers?|linkedin)\b/i,
      industry: "People",
      entity: "People and contacts",
    },
    {
      family: "news",
      pattern: /\b(news|intent signal|headline|m&a)\b/i,
      industry: "News & Media",
      entity: "News and intent signals",
    },
    {
      family: "reviews",
      pattern: /\b(reviews?|reputation|ratings?)\b/i,
      industry: "Competitive",
      entity: "Reviews / reputation data",
    },
    {
      family: "location",
      pattern: /\b(store locator|poi|point of interest|opening hours|nap data)\b/i,
      industry: "Location",
      entity: "Location / POI data",
    },
    {
      family: "real_estate",
      pattern: /\b(real estate|property listing|zillow|rightmove)\b/i,
      industry: "Real Estate",
      entity: "Real estate listings",
    },
  ];

const ATTRIBUTE_HINTS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bdoctors?\b/i, label: "Doctors" },
  { pattern: /\bspecialt(?:y|ies)\b/i, label: "Specialties" },
  { pattern: /\bservices?\b/i, label: "Services" },
  { pattern: /\baddress(?:es)?\b/i, label: "Address" },
  { pattern: /\bphone(?:\s+numbers?)?\b|\bcontact\b/i, label: "Phone" },
  { pattern: /\bpric(?:e|ing|es)\b/i, label: "Pricing" },
  { pattern: /\bstock|availability|inventory\b/i, label: "Availability" },
  { pattern: /\breviews?\b/i, label: "Reviews" },
  { pattern: /\btariff|nightly\b/i, label: "Tariffs" },
  { pattern: /\bamenities\b/i, label: "Amenities" },
  { pattern: /\bflight status\b/i, label: "Flight status" },
];

const SOURCE_HINTS: { pattern: RegExp; name: string }[] = [
  { pattern: /\bbse\b/i, name: "BSE" },
  { pattern: /\bnse\b/i, name: "NSE" },
  { pattern: /\bcompany websites?\b/i, name: "Company websites" },
  { pattern: /\bsec\s*edgar\b|\bedgar\b/i, name: "SEC EDGAR" },
  { pattern: /\bcompanies house\b/i, name: "Companies House" },
  { pattern: /\bmca\b/i, name: "MCA" },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, term: string): boolean {
  const trimmed = term.trim();
  if (trimmed.length < 2) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "i");
  return pattern.test(text);
}

export function classifyQuery(text: string): QueryKind {
  const q = text.toLowerCase();
  const metadataCue =
    /\b(list the (solution|agent)|solution catalogu?e|agent catalogu?e|how many|what sheets|which sheets|sheet names|catalog contents|what's in the catalog|overview of the catalog|agents by category|solutions by category)\b/.test(
      q,
    );
  const requirementCue =
    /\b(i need|i want|build|extract|refresh|dataset|hospital|hotel|amazon|pricing in|data in|annual report|flight status)\b/.test(
      q,
    ) || /\bin (india|uk|us|chennai|mumbai)\b/.test(q);

  if (metadataCue && !requirementCue) return "metadata";
  if (/\bhow many\b/.test(q) && !requirementCue) return "metadata";
  if (/\bwhat sheets\b|\bsheet names\b/.test(q)) return "metadata";
  if (/\blist the (solution|agent)/.test(q)) return "metadata";
  if (metadataCue && requirementCue) return "requirement";
  return "requirement";
}

export function detectFamily(text: string): IntentFamily {
  for (const entry of FAMILY_PATTERNS) {
    if (entry.pattern.test(text)) return entry.family;
  }
  return "generic";
}

export function extractRequirement(text: string, catalog: Catalog, prior?: Requirement): Requirement {
  const next: Requirement = prior
    ? {
        ...prior,
        sources: [...prior.sources],
        sourceUrls: [...prior.sourceUrls],
        attributes: [...prior.attributes],
        extras: { ...prior.extras },
      }
    : emptyRequirement();

  next.objective = next.objective || text.trim();

  const familyMatch = FAMILY_PATTERNS.find((entry) => entry.pattern.test(text));
  if (familyMatch) {
    next.industry = next.industry || familyMatch.industry;
    next.entityType = next.entityType || familyMatch.entity;
  }
  if (/\btech(?:nology)?\b/i.test(text) && /compan/i.test(next.entityType || text)) {
    next.industry = "Technology";
    next.entityType = next.entityType || "Companies";
  }

  for (const [canonical, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((alias) => hasWord(text, alias))) {
      next.country = next.country || canonical;
      next.geography = next.geography || canonical;
    }
  }

  const lower = text.toLowerCase();
  for (const [city, country] of Object.entries(CITY_TO_COUNTRY)) {
    if (hasWord(lower, city)) {
      const pretty = city.replace(/\b\w/g, (c) => c.toUpperCase());
      next.city = next.city || pretty;
      next.country = next.country || country;
      next.geography = next.city && next.country ? `${next.city}, ${next.country}` : next.geography || country;
    }
  }

  for (const freq of FREQUENCY_PATTERNS) {
    if (freq.pattern.test(text)) {
      next.frequency = next.frequency || freq.value;
      next.recurring = next.recurring || freq.recurring;
    }
  }

  for (const hint of ATTRIBUTE_HINTS) {
    if (hint.pattern.test(text) && !next.attributes.includes(hint.label)) {
      next.attributes.push(hint.label);
    }
  }
  next.attributes = next.attributes
    .map((item) => item.replace(/\s+in\s+(india|uk|us|usa|the united states)\b/i, "").trim())
    .filter((item) => item && !/^(in|the|a|an)$/i.test(item));
  if (next.attributes.some((item) => /^all available fields$/i.test(item))) {
    next.attributes = ["All available fields"];
  }

  const urlMatches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const url of urlMatches) {
    if (!next.sourceUrls.includes(url)) next.sourceUrls.push(url);
  }

  const named = findNamedSources(text, catalog);
  for (const name of named) {
    if (!next.sources.includes(name)) next.sources.push(name);
  }

  for (const hint of SOURCE_HINTS) {
    if (hint.pattern.test(text) && !next.sources.includes(hint.name)) next.sources.push(hint.name);
  }

  if (/\b(bse|nse|mca)\b/i.test(text) && !next.country) {
    next.country = "India";
    next.geography = next.geography || "India";
  }

  return next;
}

export function findNamedSources(text: string, catalog: Catalog): string[] {
  const hits: { name: string; length: number }[] = [];
  const seen = new Set<string>();

  const candidates = new Set<string>();
  for (const agent of catalog.agents) {
    if (agent.name) candidates.add(agent.name);
  }
  for (const source of catalog.sources) {
    if (source.name) candidates.add(source.name);
  }
  for (const solution of catalog.solutions) {
    for (const name of solution.sourceNames) candidates.add(name);
  }

  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  const remaining = text;

  for (const name of sorted) {
    if (name.length < 3) continue;
    if (/^(other|listing|directory|registry)$/i.test(name)) continue;
    const aliases = sourceAliases(name);
    if (!aliases.some((alias) => hasWord(remaining, alias))) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ name, length: name.length });
  }

  const acronyms = text.match(/\b[A-Z]{2,5}\b/g) ?? [];
  for (const acronym of acronyms) {
    if (["THE", "AND", "FOR", "FROM", "WITH"].includes(acronym)) continue;
    for (const name of sorted) {
      if (!new RegExp(`\\b${escapeRegExp(acronym)}\\b`, "i").test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ name, length: name.length });
    }
  }

  return hits.map((hit) => hit.name);
}

function sourceAliases(name: string): string[] {
  const aliases = [name];
  const beforeParen = name.split("(")[0].trim();
  if (/^[A-Z0-9][A-Z0-9.&]{1,5}$/.test(beforeParen)) aliases.push(beforeParen);
  return aliases;
}

export function regionCodeForCountry(country?: string): string[] {
  if (!country) return [];
  const map: Record<string, string[]> = {
    India: ["IN", "India"],
    US: ["US", "USA", "US-CA", "US-DE", "US-NY"],
    UK: ["UK", "GB"],
    Australia: ["AU"],
    Canada: ["CA"],
    Germany: ["DE"],
    France: ["FR"],
    Singapore: ["SG"],
    Japan: ["JP"],
    China: ["CN"],
    Brazil: ["BR"],
    Italy: ["IT"],
    Spain: ["ES"],
    "Hong Kong": ["HK"],
  };
  return map[country] ?? [country];
}

export function familyFromRequirement(req: Requirement, text: string): IntentFamily {
  return detectFamily([text, req.entityType, req.industry, req.objective].filter(Boolean).join(" "));
}
