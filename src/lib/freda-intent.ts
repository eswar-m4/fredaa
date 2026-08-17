/**
 * Ask Freda - intent reader.
 *
 * Turns the user's free-text opening request into pre-filled answers so the
 * chat only asks what is still missing. Deterministic keyword matching - no
 * guessing, no invented facts.
 */
import botsData from "@/data/bots.json";
import { lookupOnboarded, type OnboardedHit } from "@/lib/onboarded";
import { SECTORS, GEO_LABEL, OTHER_PREFIX, type Answers, type Focus, type GeoId, type SectorId } from "@/lib/freda-firmographic";

type RawBot = { name?: string; url?: string; category?: string };
const BOTS = ((botsData as { bots?: RawBot[] }).bots || []) as RawBot[];

const SECTOR_HINTS: Record<SectorId, string[]> = {
  tech: ["software", "saas", "tech", "technology", "it services", "cyber", "cybersecurity", "ai", "artificial intelligence", "startup", "startups"],
  bfsi: ["bank", "banks", "banking", "insurance", "insurer", "insurers", "fintech", "nbfc", "lending", "broker", "wealth", "payments"],
  healthcare: ["hospital", "hospitals", "clinic", "clinics", "healthcare", "diagnostic", "diagnostics", "pharma", "medical", "doctor", "doctors", "biotech", "dental"],
  manufacturing: ["manufacturing", "manufacturer", "manufacturers", "factory", "plant", "chemical", "automotive", "industrial", "supplier", "textile"],
  retail: ["retail", "retailer", "store", "stores", "supermarket", "grocery", "ecommerce", "e-commerce", "fashion", "d2c", "brand"],
  travel: ["hotel", "hotels", "restaurant", "restaurants", "airline", "airlines", "travel", "resort", "resorts", "hospitality", "cafe", "cafes", "tour", "tours", "cruise", "homestay", "venue", "venues"],
  telecom: ["telecom", "operator", "broadband", "isp", "media", "broadcast", "ott", "publisher"],
  energy: ["energy", "power", "solar", "renewable", "oil", "gas", "utility", "utilities"],
  services: ["consulting", "consultant", "law firm", "attorney", "legal", "accounting", "agency", "staffing", "bpo"],
  generic: [],
};

const GEO_HINTS: Record<GeoId, string[]> = {
  india: ["india", "chennai", "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "pune", "kolkata"],
  us: ["usa", "u.s.", "united states", "america", "new york", "california", "texas"],
  emea: ["europe", "emea", "uk", "united kingdom", "germany", "france", "spain", "italy"],
  apac: ["apac", "asia", "singapore", "japan", "australia", "china"],
  namer: ["north america", "canada"],
  global: ["global", "worldwide", "all countries"],
};

const FRESH_HINTS: Record<string, string[]> = {
  rt: ["real time", "real-time", "daily", "continuous", "every day"],
  d7: ["weekly", "every week"],
  d30: ["monthly", "every month"],
  d90: ["quarterly", "every quarter"],
  annual: ["annual", "yearly", "once a year"],
  once: ["one-time", "one time", "snapshot", "just once"],
};

const ATTR_HINTS: { id: string; label: string; words: string[] }[] = [
  { id: "primary-phone", label: "Primary phone", words: ["phone", "contact number", "telephone"] },
  { id: "operating-locations", label: "Operating locations", words: ["address", "location", "branches", "outlets"] },
  { id: "employee-count", label: "Employee count", words: ["employee", "headcount", "staff size"] },
  { id: "annual-revenue", label: "Annual revenue", words: ["revenue", "turnover", "sales figure"] },
  { id: "year-founded", label: "Year founded", words: ["founded", "incorporation year", "established"] },
  { id: "company-description", label: "Company description", words: ["description", "about the company"] },
  { id: "ownership-type", label: "Ownership type", words: ["ownership", "public or private"] },
  { id: "sub-industry", label: "Sub-industry", words: ["sub industry", "sub-industry", "segment"] },
];

export const FOCUS_LABEL: Record<Focus, string> = {
  reviews: "Reviews & ratings",
  contact: "Contact details",
  locations: "Locations & addresses",
  financial: "Financials",
  people: "People & leadership",
  tech: "Technology stack",
  pricing: "Pricing & tariffs",
};

const FOCUS_HINTS: Record<Focus, string[]> = {
  reviews: ["review", "reviews", "rating", "ratings", "stars review", "feedback", "sentiment", "testimonial", "testimonials"],
  contact: ["phone", "contact number", "telephone", "email", "contact details", "contacts"],
  locations: ["address", "addresses", "location", "locations", "branches", "outlets", "stores", "opening hours"],
  financial: ["revenue", "turnover", "financial", "financials", "profit", "ebitda", "funding", "valuation"],
  people: ["executive", "executives", "founder", "founders", "leadership", "decision maker", "headcount", "employees"],
  tech: ["tech stack", "technology stack", "cms", "analytics", "hosting"],
  pricing: ["price", "prices", "pricing", "tariff", "tariffs", "menu", "packages", "plans"],
};

/** Star / class hints that answer the sector "type" question up front. */
const PROFILE_HINTS: { words: string[]; label: string }[] = [
  { words: ["5 star", "five star", "luxury"], label: "5-star / luxury" },
  { words: ["4 star", "four star"], label: "4-star / upper upscale" },
  { words: ["3 star", "three star"], label: "3-star / midscale" },
  { words: ["2 star", "two star", "1 star", "one star", "budget"], label: "1-2 star / budget" },
  { words: ["boutique", "heritage"], label: "Boutique & heritage" },
  { words: ["multi speciality", "multi-speciality", "multispeciality"], label: "Multi-speciality hospitals" },
  { words: ["diagnostic", "diagnostics", "lab", "labs"], label: "Diagnostic labs & imaging" },
  { words: ["clinic", "clinics"], label: "Clinics & polyclinics" },
];

const slugify = (s: string) => s.toLowerCase().replace(/\W+/g, "-");

/** Which data family the request belongs to - drives which questionnaire runs. */
export type Family = "firmographic" | "product";

const PRODUCT_WORDS = [
  "product price", "product pricing", "product prices", "product data", "product catalogue", "product catalog",
  "sku", "skus", "asin", "mrp", "buy box", "buybox", "listing", "listings", "marketplace", "marketplaces",
  "ecommerce", "e-commerce", "catalogue", "catalog", "price comparison", "competitor pricing", "price monitoring",
  "price tracking", "out of stock", "stock availability", "deal", "deals", "discount", "discounts",
];

const MARKETPLACE_WORDS = ["amazon", "flipkart", "walmart", "ebay", "target", "best buy", "myntra", "ajio", "bigbasket", "blinkit", "google shopping", "shopify", "etsy", "alibaba"];

export type Intent = {
  raw: string;
  answers: Answers;
  /** human-readable list of what Freda already understood */
  captured: { label: string; value: string }[];
  /** what the user is actually after - drives which questions and fields appear */
  focus: Focus[];
  /** firmographic vs product & pricing */
  family: Family;
  /** agents already onboarded that match sites the user named */
  agentHits: { site: string; hit: OnboardedHit }[];
  /** sites the user named that are not onboarded yet */
  newSites: string[];
  /** true when the ask is clearly outside the firmographic / public-web scope */
  outOfScope: boolean;
  topN: number | null;
};



const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** whole-word match so "chennai" never matches "ai" and "start" never matches "startup" */
const wordRe = (w: string) => new RegExp(`(^|[^a-z0-9])${escape(w)}([^a-z0-9]|$)`, "i");
const has = (text: string, words: string[]) => words.some((w) => wordRe(w).test(text));
const score = (text: string, words: string[]) => words.filter((w) => wordRe(w).test(text)).length;

function detectSites(text: string) {
  const found = new Set<string>();
  const domains = text.match(/\b[a-z0-9][a-z0-9-]*\.(com|in|io|org|net|co|gov|co\.uk|co\.in)\b/gi) || [];
  domains.forEach((d) => found.add(d.toLowerCase()));
  for (const bot of BOTS) {
    const host = String(bot.url || "")
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    if (!host) continue;
    const base = host.split(".")[0];
    if (base.length >= 4 && new RegExp(`\\b${base}\\b`, "i").test(text)) found.add(host.toLowerCase());
  }
  return [...found];
}

export function detectFamily(raw: string): Family {
  const text = ` ${raw.toLowerCase()} `;
  const productish = score(text, PRODUCT_WORDS) + score(text, MARKETPLACE_WORDS);
  const priceish = has(text, ["price", "prices", "pricing", "cost", "costs"]);
  // "amazon pricing", "sku catalogue", "competitor price monitoring" -> product family
  if (productish >= 2) return "product";
  if (productish === 1 && priceish) return "product";
  return "firmographic";
}

/** Pre-fills for the product & pricing questionnaire. */
function readProductAnswers(text: string) {
  const answers: Answers = {};
  const captured: { label: string; value: string }[] = [];

  const markets = MARKETPLACE_WORDS.filter((m) => wordRe(m).test(text)).map((m) =>
    m.replace(/\b\w/g, (c) => c.toUpperCase()),
  );
  if (markets.length) {
    answers["pmarket"] = markets.map(slugify);
    captured.push({ label: "Marketplaces", value: markets.join(", ") });
  }

  const CATS: [string, string[]][] = [
    ["Electronics & appliances", ["electronics", "mobile", "mobiles", "phone", "phones", "laptop", "laptops", "appliance", "appliances", "tv"]],
    ["Fashion & apparel", ["fashion", "apparel", "clothing", "footwear", "shoes"]],
    ["Grocery & FMCG", ["grocery", "groceries", "fmcg", "food"]],
    ["Home & furniture", ["furniture", "home decor", "kitchenware"]],
    ["Beauty & personal care", ["beauty", "cosmetics", "skincare", "personal care"]],
    ["Health & pharma", ["pharma", "medicine", "medicines", "supplements"]],
    ["Toys, baby & games", ["toys", "baby", "games"]],
    ["Books & media", ["books", "media"]],
    ["Auto parts & accessories", ["auto parts", "spare parts", "tyres", "accessories"]],
    ["Industrial / MRO", ["industrial", "mro", "tools"]],
  ];
  const cats = CATS.filter(([, w]) => has(text, w)).map(([label]) => label);
  if (cats.length) {
    answers["pcategory"] = cats.map(slugify);
    captured.push({ label: "Categories", value: cats.join(", ") });
  }

  const GEOS: [string, string, string[]][] = [
    ["india", "India", ["india", "indian", ".in", "flipkart", "myntra", "bigbasket", "blinkit"]],
    ["us", "United States", ["usa", "u.s.", "united states", "america"]],
    ["uk", "United Kingdom", ["uk", "united kingdom", "britain"]],
    ["emea", "Europe / EMEA", ["europe", "emea"]],
    ["apac", "APAC", ["apac", "singapore", "australia"]],
  ];
  const geo = GEOS.find(([, , w]) => has(text, w));
  if (geo) {
    answers["pgeo"] = [geo[0]];
    captured.push({ label: "Storefront", value: geo[1] });
  }

  if (has(text, ["my list", "our list", "sku list", "asin list", "url list", "i have a list"])) {
    answers["pscope"] = ["list"];
    captured.push({ label: "Product scope", value: "Your SKU / ASIN list" });
  } else if (has(text, ["best seller", "best sellers", "bestseller", "bestsellers", "top ranked", "top selling"])) {
    answers["pscope"] = ["bestseller"];
    captured.push({ label: "Product scope", value: "Best-sellers / top-ranked" });
  } else if (has(text, ["category", "categories", "browse node", "entire catalogue", "entire catalog"])) {
    answers["pscope"] = ["category"];
    captured.push({ label: "Product scope", value: "Full category / browse node" });
  }

  const fields = ["Selling price", "MRP / list price", "Discount %"];
  if (has(text, ["price", "prices", "pricing"])) {
    answers["pfields"] = fields.map(slugify);
    captured.push({ label: "Fields", value: fields.join(", ") });
  }

  return { answers, captured };
}

export function readIntent(raw: string): Intent {
  const text = ` ${raw.toLowerCase()} `;
  const answers: Answers = {};
  const captured: { label: string; value: string }[] = [];
  const family = detectFamily(raw);

  // named sites -> already-onboarded agents (same for every family)
  const resolveSites = () => {
    const agentHits: Intent["agentHits"] = [];
    const newSites: string[] = [];
    for (const s of detectSites(raw)) {
      const hit = lookupOnboarded(s);
      if (hit) agentHits.push({ site: s, hit });
      else newSites.push(s);
    }
    return { agentHits, newSites };
  };

  if (family === "product") {
    const p = readProductAnswers(text);
    const { agentHits, newSites } = resolveSites();
    return {
      raw,
      answers: p.answers,
      captured: p.captured,
      focus: ["pricing"],
      family,
      agentHits,
      newSites,
      outOfScope: false,
      topN: null,
    };
  }




  // industry - pick the sector with the most whole-word hits, not the first one
  let sector: SectorId | null = null;
  let best = 0;
  for (const key of Object.keys(SECTOR_HINTS) as SectorId[]) {
    if (key === "generic") continue;
    const s = score(text, SECTOR_HINTS[key]);
    if (s > best) {
      best = s;
      sector = key;
    }
  }
  if (sector) {
    answers["sector"] = [sector];
    captured.push({ label: "Industry", value: SECTORS[sector].label });
  }

  // segment - match the sector's own sub-categories
  if (sector) {
    const segs = SECTORS[sector].segments.filter((s) =>
      s
        .toLowerCase()
        .split(/[&,/]| and /)
        .map((p) => p.trim())
        .filter((p) => p.length > 3)
        .some((p) => text.includes(p)),
    );
    if (segs.length) {
      answers["segment"] = segs.map((s) => s.toLowerCase().replace(/\W+/g, "-"));
      captured.push({ label: "Segments", value: segs.join(", ") });
    }
  }

  // geography
  let geo: GeoId | null = null;
  let geoWord = "";
  for (const key of Object.keys(GEO_HINTS) as GeoId[]) {
    const hit = GEO_HINTS[key].find((w) => wordRe(w).test(text));
    if (hit) {
      geo = key;
      geoWord = hit;
      break;
    }
  }
  if (geo) {
    const city = ["chennai", "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "pune", "kolkata", "new york", "california", "texas", "singapore", "canada"].includes(geoWord);
    answers["geo"] = city ? [OTHER_PREFIX + geoWord.replace(/\b\w/g, (c) => c.toUpperCase())] : [geo];
    captured.push({ label: "Geography", value: city ? geoWord.replace(/\b\w/g, (c) => c.toUpperCase()) : GEO_LABEL[geo] });
  }

  // refresh frequency
  for (const [id, words] of Object.entries(FRESH_HINTS)) {
    if (has(text, words)) {
      answers["fresh"] = [id];
      captured.push({ label: "Refresh", value: words[0] });
      break;
    }
  }

  // list sourcing
  const topMatch = raw.match(/top\s+(\d{1,6})/i);
  const topN = topMatch ? Number(topMatch[1]) : null;
  if (topN) {
    answers["universe"] = ["top"];
    captured.push({ label: "Company list", value: `Top ${topN.toLocaleString()} by size` });
  } else if (has(text, ["i have a list", "our list", "my list", "enrich", "existing list", "upload"])) {
    answers["universe"] = ["upload"];
    captured.push({ label: "Company list", value: "You already have the list" });
  } else if (has(text, ["registry", "mca", "companies house", "sec edgar", "directory"])) {
    answers["universe"] = ["registry"];
    captured.push({ label: "Company list", value: "From a registry / directory" });
  } else if (has(text, ["listed compan", "public compan", "nse", "bse", "nasdaq"])) {
    answers["universe"] = ["listed"];
    captured.push({ label: "Company list", value: "Public / listed only" });
  } else if (has(text, ["private compan", "unlisted"])) {
    answers["universe"] = ["private"];
    captured.push({ label: "Company list", value: "Private / unlisted only" });
  }

  // size filters
  if (has(text, ["by revenue", "revenue over", "revenue above", "largest by revenue", "$1b", "billion"])) {
    answers["revenue"] = ["r4"];
    captured.push({ label: "Revenue band", value: "$1B+" });
  }
  if (has(text, ["enterprise", "5000+ employees", "large compan"])) {
    answers["employees"] = ["large"];
    captured.push({ label: "Employee band", value: "5,000+ employees" });
  } else if (has(text, ["sme", "smb", "small business", "startup"])) {
    answers["employees"] = ["micro", "smb"];
    captured.push({ label: "Employee band", value: "Under 500 employees" });
  }

  // what the user is actually after
  const focus = (Object.keys(FOCUS_HINTS) as Focus[]).filter((f) => has(text, FOCUS_HINTS[f]));
  if (focus.length) captured.push({ label: "Looking for", value: focus.map((f) => FOCUS_LABEL[f]).join(", ") });

  // type / class (star rating, facility type, ...)
  const profiles = PROFILE_HINTS.filter((p) => has(text, p.words));
  if (profiles.length) {
    answers["profile"] = profiles.map((p) => slugify(p.label));
    captured.push({ label: "Type / class", value: profiles.map((p) => p.label).join(", ") });
  }

  // attributes
  const attrs = ATTR_HINTS.filter((a) => has(text, a.words));
  if (attrs.length) {
    answers["core"] = attrs.map((a) => a.id);
    captured.push({ label: "Attributes", value: attrs.map((a) => a.label).join(", ") });
  }


  // named sites -> already-onboarded agents
  const { agentHits, newSites } = resolveSites();

  const outOfScope = has(text, [
    "personal email",
    "personal phone",
    "behind login",
    "login required",
    "paywall",
    "scrape linkedin profiles",
    "credit card",
    "resume",
    "cv database",
  ]);

  return { raw, answers, captured, focus, family, agentHits, newSites, outOfScope, topN };
}

/** Short, on-topic reply for anything the interview does not cover. */
export function fallbackReply(raw: string): string | null {
  const t = raw.toLowerCase();
  if (/\b(price|pricing|cost|quote|how much)\b/.test(t))
    return "I can't quote pricing here - I scope the solution (sources, attributes, volume, timeline) and the team prices it once the request is submitted.";
  if (/\b(login|password|paywall|behind a login)\b/.test(t))
    return "We only collect what a visitor can see on public pages - no logins, paywalls or personal data.";
  if (/\b(personal|individual|resume|cv)\b/.test(t) && /\b(email|phone|data)\b/.test(t))
    return "Personal contact data is out of scope. I can scope company-level (firmographic) fields from public pages instead.";
  if (/\b(ecommerce price|product price|reviews|occupancy|poi)\b/.test(t))
    return "Right now I'm scoped to firmographic (company-level) solutions. Other data families are coming - for those, raise it with the team from the dashboard.";
  return null;
}
