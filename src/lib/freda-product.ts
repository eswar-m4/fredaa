/**
 * Freda AI - product / pricing consultant.
 *
 * Product & pricing asks ("scrape Amazon for product pricing") have nothing to
 * do with firmographic filters like revenue or headcount, so they get their own
 * short, relevant questionnaire and their own proposal builder.
 */
import {
  isOther,
  otherText,
  type Answers,
  type Proposal,
  type Question,
  type WorkflowNode,
  SECTORS,
} from "@/lib/freda-firmographic";

const slug = (s: string) => s.toLowerCase().replace(/\W+/g, "-");

export const PRODUCT_CATEGORIES = [
  "Electronics & appliances",
  "Fashion & apparel",
  "Grocery & FMCG",
  "Home & furniture",
  "Beauty & personal care",
  "Health & pharma",
  "Toys, baby & games",
  "Books & media",
  "Auto parts & accessories",
  "Industrial / MRO",
];

export const MARKETPLACES = [
  "Amazon",
  "Flipkart",
  "Walmart",
  "eBay",
  "Target",
  "Best Buy",
  "Myntra / Ajio",
  "BigBasket / Blinkit",
  "Google Shopping",
  "Brand's own website",
];

const PRICE_BANDS: Record<string, string> = {
  p1: "Budget (under $25 / ₹2,000)",
  p2: "Mid ($25 - $100 / ₹2,000 - ₹8,000)",
  p3: "Premium ($100 - $500)",
  p4: "High-end ($500+)",
  anyprice: "No price filter",
};

const SKU_BANDS: Record<string, string> = {
  s1: "Under 1,000 SKUs",
  s2: "1,000 - 10,000 SKUs",
  s3: "10,000 - 100,000 SKUs",
  s4: "100,000+ SKUs",
};

const SKU_COUNT: Record<string, number> = { s1: 800, s2: 6500, s3: 45000, s4: 180000 };

export const PRODUCT_ATTRIBUTES = [
  "Selling price",
  "MRP / list price",
  "Discount %",
  "Currency",
  "Availability / stock status",
  "Seller name",
  "Buy-box winner",
  "Star rating",
  "Review count",
  "Product variants (size / colour)",
  "Brand",
  "Category / browse path",
  "Product images",
  "Shipping cost & delivery ETA",
  "Coupons & offers",
  "Price history / change flag",
];

const MANDATORY = ["Product title", "Product URL", "SKU / ASIN", "Marketplace", "Captured date"];

const FRESH_CADENCE: Record<string, string> = {
  hourly: "Hourly",
  rt: "Daily",
  d7: "Weekly",
  d30: "Monthly",
  once: "One-time",
};

const FRESH_LABEL: Record<string, string> = {
  hourly: "Hourly price checks",
  rt: "Daily refresh",
  d7: "Weekly refresh",
  d30: "Monthly refresh",
  once: "One-time snapshot",
};

/** Product questionnaire - only what actually shapes a pricing crawl. */
export function buildProductQuestions(answers: Answers = {}): Question[] {
  const scope = answers["pscope"]?.[0] ?? "";
  const q: Question[] = [
    {
      id: "pscope",
      text: "Which products should we track?",
      help: "This decides how we find the pages - a list, a search, or a whole category.",
      options: [
        { id: "list", label: "I'll share a SKU / ASIN / URL list", hint: "We track exactly those products" },
        { id: "keywords", label: "Search keywords", hint: "e.g. 'wireless earbuds' top results" },
        { id: "category", label: "A full category / browse node", hint: "Everything under a category tree" },
        { id: "brand", label: "Specific brands or sellers", hint: "Own brand or competitor catalogue" },
        { id: "bestseller", label: "Best-sellers / top-ranked only", hint: "Rank-led sample" },
      ],
      allowOther: true,
    },
    {
      id: "pcategory",
      text: "Which product categories are in scope?",
      help: "Category decides the attributes worth extracting.",
      multi: true,
      options: [...PRODUCT_CATEGORIES.map((c) => ({ id: slug(c), label: c })), { id: "allcat", label: "All categories" }],
      allowOther: true,
    },
    {
      id: "pmarket",
      text: "Which marketplaces or sites should we cover?",
      help: "The brand's own website is always included as the reference price.",
      multi: true,
      options: [...MARKETPLACES.map((m) => ({ id: slug(m), label: m })), { id: "anymarket", label: "Recommend the right ones for me" }],
      allowOther: true,
    },
    {
      id: "pgeo",
      text: "Which marketplace geography / storefront?",
      help: "Prices and availability differ by storefront (amazon.in vs amazon.com).",
      options: [
        { id: "india", label: "India" },
        { id: "us", label: "United States" },
        { id: "uk", label: "United Kingdom" },
        { id: "emea", label: "Europe / EMEA" },
        { id: "apac", label: "APAC" },
        { id: "global", label: "Multiple storefronts" },
      ],
      allowOther: true,
    },
    {
      id: "pprice",
      text: "Any price range that should qualify?",
      help: "Skip it if you want the full price ladder.",
      multi: true,
      options: Object.keys(PRICE_BANDS).map((k) => ({ id: k, label: PRICE_BANDS[k] })),
      allowOther: true,
    },
  ];

  if (scope !== "list") {
    q.push({
      id: "pskus",
      text: "Roughly how many products should the dataset hold?",
      help: "Drives crawl volume and delivery time.",
      options: Object.keys(SKU_BANDS).map((k) => ({ id: k, label: SKU_BANDS[k] })),
      allowOther: true,
    });
  }

  q.push({
    id: "pfields",
    text: "Which product fields should every record contain?",
    help: `Always included: ${MANDATORY.join(", ")}.`,
    multi: true,
    options: PRODUCT_ATTRIBUTES.map((a) => ({ id: slug(a), label: a })),
    allowOther: true,
  });

  q.push({
    id: "fresh",
    text: "How often should prices be refreshed?",
    help: "Pricing moves fast - most price-intelligence feeds run daily or hourly.",
    options: [
      { id: "hourly", label: "Hourly", hint: "Fast-moving / deal tracking" },
      { id: "rt", label: "Daily", hint: "Standard price intelligence" },
      { id: "d7", label: "Weekly" },
      { id: "d30", label: "Monthly" },
      { id: "once", label: "One-time snapshot" },
    ],
    allowOther: true,
  });

  return q;
}

const label = (v: string, map: Record<string, string>) => (isOther(v) ? otherText(v) : (map[v] ?? v));
const fromList = (v: string, list: string[]) => (isOther(v) ? otherText(v) : (list.find((x) => slug(x) === v) ?? v));

export function buildProductProposal(answers: Answers, requestLine: string): Proposal {
  const pick = (id: string) => answers[id]?.[0] ?? "";
  const scope = pick("pscope");
  const geo = label(pick("pgeo") || "global", {
    india: "India",
    us: "United States",
    uk: "United Kingdom",
    emea: "Europe / EMEA",
    apac: "APAC",
    global: "Multiple storefronts",
  });

  const cats = (answers["pcategory"] ?? []).filter((v) => v !== "allcat").map((v) => fromList(v, PRODUCT_CATEGORIES));
  const markets = (answers["pmarket"] ?? []).filter((v) => v !== "anymarket").map((v) => fromList(v, MARKETPLACES));
  const prices = (answers["pprice"] ?? []).filter((v) => v !== "anyprice").map((v) => label(v, PRICE_BANDS));
  const fields = (answers["pfields"] ?? []).map((v) => fromList(v, PRODUCT_ATTRIBUTES));
  const attributes = [...MANDATORY, ...fields];

  const skuKey = pick("pskus");
  const est = scope === "list" ? 2500 : (SKU_COUNT[skuKey] ?? 6500);
  const marketCount = markets.length || 3;
  const volume = scope === "list" ? "As per your SKU list" : `~${(est * Math.min(marketCount, 4)).toLocaleString()} product records`;

  const freshId = pick("fresh") || "rt";
  const cadence = FRESH_CADENCE[freshId] ?? "Daily";

  const days = est < 5000 ? 4 : est < 50000 ? 7 : 10;

  const sources: Proposal["sources"] = [
    { name: "Brand / manufacturer official website", kind: "Company website", note: "Reference price and canonical product data - always included" },
    ...(markets.length ? markets : ["Amazon", "Flipkart", "Walmart"]).map((m) => ({
      name: `${m} product & listing pages`,
      kind: "Third-party" as const,
      note: "Public listing pages only - price, offers, availability, ratings",
    })),
    { name: "Google Shopping results", kind: "Third-party", note: "Cross-marketplace price comparison" },
  ];

  const workflow: WorkflowNode[] = [
    { id: "input", label: scope === "list" ? "SKU / URL list" : "Product discovery", kind: "io" },
    { id: "fetch", label: "Crawl & capture listings", kind: "fetch" },
    { id: "extract", label: "AI-based extraction", kind: "llm" },
    { id: "classify", label: "Enrich & classify", kind: "llm" },
    { id: "normalise", label: "Match & dedupe SKUs", kind: "merge" },
    { id: "validate", label: "Validate & QC", kind: "filter" },
    { id: "output", label: "Export price feed", kind: "io" },
  ];

  return {
    sector: SECTORS.retail,
    title: requestLine.trim() ? requestLine.trim().replace(/^\w/, (c) => c.toUpperCase()) : `Product pricing dataset (${geo})`,
    geo,
    sources,
    attributes,
    workflow,
    volume,
    volumeNote: `${cats.length ? cats.join(", ") : "All categories"} across ${marketCount} marketplace${marketCount > 1 ? "s" : ""}`,
    timeline: `${days} working days to first delivery`,
    cadence,
    validation: "Prices cross-checked against the brand's own website",
    route: "openweb",
    routeLabel: "Solutions",
    metadata: [
      { label: "Data family", value: "Product & pricing" },
      {
        label: "Product scope",
        value:
          {
            list: "Client SKU / ASIN list",
            keywords: "Search keywords",
            category: "Full category / browse node",
            brand: "Specific brands or sellers",
            bestseller: "Best-sellers / top-ranked",
          }[scope] ?? "Recommended by Freda",
      },
      { label: "Categories", value: cats.length ? cats.join(", ") : "All categories" },
      { label: "Marketplaces", value: markets.length ? markets.join(", ") : "Recommended by Freda" },
      ...(prices.length ? [{ label: "Price range", value: prices.join(", ") }] : []),
      { label: "Storefront", value: geo },
      ...(skuKey && scope !== "list" ? [{ label: "Catalogue size", value: label(skuKey, SKU_BANDS) }] : []),
      { label: "Freshness", value: FRESH_LABEL[freshId] ?? "Daily refresh" },
      { label: "Refresh", value: cadence },
      { label: "Attributes", value: `${attributes.length} fields (${MANDATORY.length} standard defaults)` },
      { label: "Sources", value: `1 brand site + ${sources.length - 1} marketplace sources` },
      { label: "Change tracking", value: freshId === "once" ? "Snapshot only" : "Price up / down / out-of-stock deltas" },
    ],
  };
}
