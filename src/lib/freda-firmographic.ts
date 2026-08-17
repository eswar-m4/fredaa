/**
 * Freda AI - firmographic solution consultant.
 *
 * Scope for now: FIRMOGRAPHIC data only (company-level facts).
 * Seven industry-neutral questions; only the OPTIONS change per industry.
 * Sector-specific attributes come from the sector attribute library below and
 * are never hard-coded into the universal questionnaire.
 */

export type Option = { id: string; label: string; hint?: string };
export type Question = {
  id: string;
  text: string;
  help?: string;
  options: Option[];
  multi?: boolean;
  allowOther?: boolean;
};

export const OTHER_PREFIX = "other:";
export const isOther = (v: string) => v.startsWith(OTHER_PREFIX);
export const otherText = (v: string) => v.slice(OTHER_PREFIX.length);
export function optionLabel(q: Question, id: string): string {
  if (isOther(id)) return otherText(id);
  return q.options.find((o) => o.id === id)?.label ?? id;
}

export type Answers = Record<string, string[]>;

export type SectorId =
  | "tech"
  | "bfsi"
  | "healthcare"
  | "manufacturing"
  | "retail"
  | "travel"
  | "telecom"
  | "energy"
  | "services"
  | "generic";

type Sector = {
  id: SectorId;
  label: string;
  /** noun used in copy: "airline", "hospital", ... */
  noun: string;
  /** sub-categories used to qualify which companies belong in the dataset */
  segments: string[];
  /** sector attribute library - offered on top of the standardized core set */
  extraAttributes: string[];
  /** curated third-party sources for this sector (company website is always #1) */
  sources: string[];
  /** rough number of qualifying entities per geography scope */
  universe: Record<GeoId, number>;
};

const plural = (n: string) => (n.endsWith("y") ? n.slice(0, -1) + "ies" : n + "s");

export type GeoId = "india" | "us" | "emea" | "apac" | "namer" | "global";

export const GEO_LABEL: Record<GeoId, string> = {
  india: "India",
  us: "United States",
  emea: "Europe / EMEA",
  apac: "APAC",
  namer: "North America",
  global: "Global",
};

export const SECTORS: Record<SectorId, Sector> = {
  tech: {
    id: "tech",
    label: "Technology & SaaS",
    noun: "technology company",
    segments: ["B2B SaaS", "Enterprise software", "IT services & consulting", "Cybersecurity", "Data & AI", "Consumer technology"],
    extraAttributes: ["Product lines", "Pricing tiers", "Tech stack", "Funding stage", "Investors", "Customer logos"],
    sources: ["Company websites (About, Pricing, Careers)", "Crunchbase", "G2", "Capterra", "LinkedIn company pages", "Tracxn"],
    universe: { india: 9500, us: 42000, emea: 28000, apac: 21000, namer: 46000, global: 118000 },
  },
  bfsi: {
    id: "bfsi",
    label: "Banking, Financial Services & Insurance",
    noun: "financial institution",
    segments: ["Commercial & retail banks", "NBFCs & lending platforms", "Life & general insurers", "Asset & wealth managers", "Payments & fintech", "Brokerages & capital markets"],
    extraAttributes: ["Regulator licence number", "Assets under management", "Branch count", "Product lines", "Solvency / capital ratio", "Listed vs unlisted"],
    sources: ["Institution official websites", "RBI / SEC / FCA registers", "IRDAI & regulator filings", "Annual reports & investor decks", "Stock exchange disclosures", "LEI (GLEIF) records"],
    universe: { india: 640, us: 5200, emea: 4300, apac: 3100, namer: 5600, global: 12800 },
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare & Life Sciences",
    noun: "healthcare provider",
    segments: ["Hospitals", "Clinics & day-care centres", "Diagnostics & imaging", "Pharmaceuticals", "Medical devices", "Biotechnology", "HealthTech"],
    extraAttributes: ["Bed count", "Specialities offered", "Accreditation (NABH / JCI)", "Number of branches", "Doctor count", "Regulatory approvals"],
    sources: ["Provider official websites", "NABH / JCI accreditation lists", "State health department registries", "Practo", "Google Business listings", "Annual reports"],
    universe: { india: 4200, us: 6100, emea: 9800, apac: 12400, namer: 7000, global: 31000 },
  },
  manufacturing: {
    id: "manufacturing",
    label: "Manufacturing & Industrial",
    noun: "manufacturer",
    segments: ["Automotive & components", "Chemicals & process", "Electronics & electricals", "Metals, mining & materials", "Food & beverage processing", "Textiles & apparel"],
    extraAttributes: ["Plant locations", "Production capacity", "Product categories", "Certifications (ISO)", "Export markets", "Supply-chain tier"],
    sources: ["Company websites", "IndiaMART / ThomasNet supplier profiles", "Industry association member lists", "Export-import public records", "Annual reports", "Company registry filings"],
    universe: { india: 22000, us: 31000, emea: 38000, apac: 46000, namer: 34000, global: 142000 },
  },
  retail: {
    id: "retail",
    label: "Retail & Consumer",
    noun: "retail chain",
    segments: ["Grocery & supermarkets", "Fashion & apparel", "Electronics & appliances", "Pharmacy & wellness", "Home, furniture & decor", "D2C / online-first brands"],
    extraAttributes: ["Store count", "Store formats", "Categories sold", "Private label share", "E-commerce presence", "Cities operated in"],
    sources: ["Brand corporate websites", "Store-locator pages", "Retail association directories", "Annual reports", "Google Business listings", "Marketplace seller pages"],
    universe: { india: 2600, us: 7400, emea: 8100, apac: 9200, namer: 8200, global: 26000 },
  },
  travel: {
    id: "travel",
    label: "Travel & Hospitality",
    noun: "travel operator",
    segments: ["Airlines & aviation operators", "Hotels & resorts", "Restaurants & F&B chains", "Travel agencies & OTAs", "Cruise & rail operators", "Tour & experience operators"],
    extraAttributes: ["Property / outlet count", "Room or seat inventory", "Star rating or format", "Fleet size", "Cities served", "Franchise vs owned"],
    sources: ["Brand corporate websites", "Booking.com property pages", "TripAdvisor business listings", "IATA / tourism board registries", "Association directories", "Franchise disclosure documents"],
    universe: { india: 1800, us: 3400, emea: 5200, apac: 6100, namer: 3900, global: 15600 },
  },
  telecom: {
    id: "telecom",
    label: "Telecom & Media",
    noun: "telecom or media company",
    segments: ["Mobile & fixed-line operators", "ISPs & broadband", "Tower & infrastructure", "Broadcast & TV", "Publishing & digital media", "Streaming & OTT"],
    extraAttributes: ["Subscriber base", "Spectrum / licence details", "Coverage footprint", "Network technology", "Channel or title portfolio", "Regulator registration"],
    sources: ["Operator official websites", "Telecom regulator registers (TRAI / FCC / Ofcom)", "Annual reports", "Stock exchange disclosures", "Industry association lists", "Press-release newsrooms"],
    universe: { india: 480, us: 2600, emea: 3400, apac: 3000, namer: 2900, global: 9400 },
  },
  energy: {
    id: "energy",
    label: "Energy & Utilities",
    noun: "energy company",
    segments: ["Oil & gas", "Power generation", "Renewables & clean energy", "Transmission & distribution utilities", "Water & waste utilities", "Energy trading & services"],
    extraAttributes: ["Installed capacity", "Asset / plant locations", "Fuel mix", "Regulatory licences", "Service territory", "Emissions disclosures"],
    sources: ["Company official websites", "Energy regulator registers", "Annual & sustainability reports", "Project databases (IRENA / EIA)", "Stock exchange disclosures", "Industry association directories"],
    universe: { india: 900, us: 4100, emea: 5200, apac: 4600, namer: 4500, global: 14800 },
  },
  services: {
    id: "services",
    label: "Professional & Business Services",
    noun: "services firm",
    segments: ["Consulting & advisory", "Legal services", "Accounting & audit", "Staffing & HR services", "Marketing & creative agencies", "Facilities & BPO services"],
    extraAttributes: ["Practice areas", "Partner / consultant count", "Office locations", "Client industries", "Certifications & memberships", "Billing model"],
    sources: ["Firm official websites", "Professional body registers (ICAI / Bar / ACCA)", "LinkedIn company pages", "Clutch & agency directories", "Chamber of commerce lists", "Company registry filings"],
    universe: { india: 12000, us: 38000, emea: 34000, apac: 26000, namer: 41000, global: 132000 },
  },
  generic: {
    id: "generic",
    label: "Multiple industries",
    noun: "company",
    segments: ["Large enterprises", "Mid-market companies", "Small businesses & startups", "Public sector & PSUs", "Non-profits & associations", "Family-owned / unlisted groups"],
    extraAttributes: ["Product / service lines", "Certifications", "Key executives", "Parent / subsidiary links", "Locations", "Awards & recognitions"],
    sources: ["Company official websites", "Company registry (MCA / Companies House / SOS)", "LinkedIn company pages", "Crunchbase", "Industry association directories", "GLEIF LEI records"],
    universe: { india: 48000, us: 120000, emea: 96000, apac: 88000, namer: 130000, global: 410000 },
  },
};

/** Always included on every record - not asked. */
const MANDATORY_ATTRIBUTES = ["Legal company name", "Official website", "Headquarters", "Industry"];

/** Standardized optional core attributes offered for every industry. */
const CORE_ATTRIBUTES = [
  "Operating locations",
  "Year founded",
  "Employee count",
  "Annual revenue",
  "Ownership type",
  "Registration / business ID",
  "Primary phone",
  "Sub-industry",
  "Company description",
  "Parent / subsidiary company",
  "Source URL",
  "Data verified date",
];

/* --------------------------- request focus (intent) --------------------------- */

export type Focus = "reviews" | "contact" | "locations" | "financial" | "people" | "tech" | "pricing";

/** Extra attributes surfaced when the user's request points at a specific need. */
export const FOCUS_ATTRIBUTES: Record<Focus, string[]> = {
  reviews: [
    "Average review rating",
    "Total review count",
    "Rating by platform (Google / TripAdvisor / Booking)",
    "Latest review date",
    "Recent review snippets",
    "Sentiment summary",
    "Owner response rate",
    "Review page URL",
  ],
  contact: ["Primary phone", "Alternate phone numbers", "Generic email (info@ / sales@)", "Contact page URL", "Social profile links"],
  locations: ["Operating locations", "Branch / outlet addresses", "Geo coordinates", "Opening hours", "Cities covered"],
  financial: ["Annual revenue", "Profit / EBITDA", "Filing year", "Funding raised", "Investors"],
  people: ["Key executives", "Founder names", "Decision-maker titles", "Employee count"],
  tech: ["Tech stack", "CMS", "Analytics tools", "Hosting provider"],
  pricing: ["Price / tariff points", "Packages or plans", "Discounts & offers", "Currency"],
};

/** Sector-specific classification question - the "what type" gap. */
type ProfileSpec = { text: string; help: string; options: string[] };

const SECTOR_PROFILE: Record<SectorId, ProfileSpec> = {
  travel: {
    text: "Which property category or class should qualify?",
    help: "Star class or format decides which properties enter the list.",
    options: ["5-star / luxury", "4-star / upper upscale", "3-star / midscale", "1-2 star / budget", "Boutique & heritage", "Serviced apartments & homestays", "Unrated / independent"],
  },
  healthcare: {
    text: "Which type of provider should qualify?",
    help: "Facility type and size shape the list far more than revenue does.",
    options: ["Multi-speciality hospitals", "Single-speciality hospitals", "Clinics & polyclinics", "Diagnostic labs & imaging", "Day-care / surgical centres", "Chains only", "Standalone only"],
  },
  bfsi: {
    text: "Which licence or institution type should qualify?",
    help: "Regulatory class is the cleanest filter in BFSI.",
    options: ["Scheduled / commercial banks", "Co-operative & regional banks", "NBFCs", "Insurers", "Brokers & distributors", "Payment & fintech licences"],
  },
  retail: {
    text: "Which retail format should qualify?",
    help: "Format tells us where the store data lives.",
    options: ["Hypermarket / supermarket", "Speciality chains", "Standalone stores", "Franchise networks", "Online-only / D2C", "Omnichannel"],
  },
  manufacturing: {
    text: "Which type of manufacturer should qualify?",
    help: "Plant type and role in the chain define the universe.",
    options: ["OEMs", "Tier-1 suppliers", "Tier-2 / Tier-3 suppliers", "Contract manufacturers", "Exporters", "MSME units"],
  },
  tech: {
    text: "Which business model should qualify?",
    help: "Model matters more than headcount for tech lists.",
    options: ["B2B SaaS", "Enterprise software vendors", "IT services / consulting", "Product startups", "Marketplaces", "Agencies & implementation partners"],
  },
  telecom: {
    text: "Which type of operator should qualify?",
    help: "Licence and footprint define the universe.",
    options: ["National operators", "Regional ISPs", "Infrastructure providers", "Broadcasters", "Digital publishers", "OTT platforms"],
  },
  energy: {
    text: "Which type of energy business should qualify?",
    help: "Asset class narrows the list quickly.",
    options: ["Generation companies", "Renewable developers", "Distribution utilities", "Oil & gas operators", "EPC & services", "Energy traders"],
  },
  services: {
    text: "Which type of firm should qualify?",
    help: "Practice type is the practical filter here.",
    options: ["Big-four / large firms", "Mid-tier firms", "Boutique practices", "Independent practitioners", "Agencies", "Offshore / BPO units"],
  },
  generic: {
    text: "Which type of organisation should qualify?",
    help: "Pick the closest organisational type.",
    options: ["Large enterprises", "Mid-market", "Small businesses", "Startups", "Public sector", "Non-profits"],
  },
};

/** Full attribute library used for this request - core + sector + focus driven. */
export function attributeLibrary(sectorId: SectorId | null, focus: Focus[] = []) {
  const s = sectorId && sectorId in SECTORS ? SECTORS[sectorId] : SECTORS.generic;
  const focusAttrs: string[] = [];
  for (const f of focus) for (const a of FOCUS_ATTRIBUTES[f] ?? []) if (!focusAttrs.includes(a)) focusAttrs.push(a);
  return {
    core: CORE_ATTRIBUTES.filter((a) => !focusAttrs.includes(a)),
    sector: s.extraAttributes.filter((a) => !focusAttrs.includes(a)),
    focus: focusAttrs,
  };
}

/* ------------------------------ the interview ------------------------------ */

export type QuestionContext = { focus?: Focus[]; answers?: Answers };

/**
 * The questionnaire adapts to the industry and to what the user actually asked
 * for: irrelevant filters are dropped and industry classification is added.
 */
export function buildQuestions(sectorId: SectorId | null, ctx: QuestionContext = {}): Question[] {
  const s = sectorId ? SECTORS[sectorId] : SECTORS.generic;
  const focus = ctx.focus ?? [];
  const answers = ctx.answers ?? {};
  const universeMode = answers["universe"]?.[0] ?? "";
  const lib = attributeLibrary(sectorId, focus);
  const profile = SECTOR_PROFILE[s.id];

  // When the client brings their own list, headcount/revenue filters are pointless.
  const listIsBuilt = universeMode !== "" && universeMode !== "upload";
  // Review / contact / location style asks are entity-level: revenue rarely qualifies them.
  const sizeLedAsk = !focus.length || focus.some((f) => ["financial", "people"].includes(f));

  const q: Question[] = [
    {
      id: "sector",
      text: "Which type of companies should this dataset cover?",
      help: "Choose the closest industry or describe your own.",
      options: (Object.keys(SECTORS) as SectorId[]).map((k) => ({ id: k, label: SECTORS[k].label })),
      allowOther: true,
    },
    {
      id: "segment",
      text: `Which ${s.label.toLowerCase()} segments should qualify?`,
      help: "Segments come from the industry you picked. Use Other for anything not listed.",
      multi: true,
      options: [...s.segments.map((a) => ({ id: slug(a), label: a })), { id: "all", label: "All segments" }],
      allowOther: true,
    },
    {
      id: "profile",
      text: profile.text,
      help: profile.help,
      multi: true,
      options: [...profile.options.map((o) => ({ id: slug(o), label: o })), { id: "anytype", label: "No type filter" }],
      allowOther: true,
    },
    {
      id: "geo",
      text: "Which geography should be in scope?",
      help: "Use Other for specific countries, states or cities.",
      options: (Object.keys(GEO_LABEL) as GeoId[]).map((k) => ({ id: k, label: GEO_LABEL[k] })),
      allowOther: true,
    },
    {
      id: "universe",
      text: "How should the company list be sourced?",
      help: "Tell us where the list comes from - you can share one, name a registry, or ask the team to build it.",
      options: [
        { id: "upload", label: "I already have a company list", hint: "We enrich the rows you provide" },
        { id: "registry", label: "Pull it from a specific registry or directory", hint: "Name the registry in Other if you like" },
        { id: "top", label: "Top N companies by size", hint: "Ranked by revenue or headcount" },
        { id: "listed", label: "Public / listed companies only", hint: "Public filings available" },
        { id: "private", label: "Private / unlisted companies only" },
        { id: "discover", label: "Ask the Freda team to build the list", hint: "Registries, directories and search" },
      ],
      allowOther: true,
    },
  ];

  if (listIsBuilt) {
    q.push({
      id: "employees",
      text: "Which employee-size bands should qualify?",
      help: "Used to narrow the list we build. Skip it if size doesn't matter.",
      multi: true,
      options: [
        { id: "micro", label: "Under 50 employees" },
        { id: "smb", label: "50 - 500 employees" },
        { id: "mid", label: "500 - 5,000 employees" },
        { id: "large", label: "5,000+ employees" },
        { id: "anysize", label: "No employee filter" },
      ],
      allowOther: true,
    });
    if (sizeLedAsk || universeMode === "top" || universeMode === "listed") {
      q.push({
        id: "revenue",
        text: "Which annual-revenue bands should qualify?",
        help: "Pick as many revenue bands as apply.",
        multi: true,
        options: [
          { id: "r1", label: "Under $10M" },
          { id: "r2", label: "$10M - $100M" },
          { id: "r3", label: "$100M - $1B" },
          { id: "r4", label: "$1B+" },
          { id: "anyrev", label: "No revenue filter" },
        ],
        allowOther: true,
      });
    }
  }

  q.push({
    id: "core",
    text: lib.focus.length
      ? "Which fields should every record contain?"
      : "Which company information should every record contain?",
    help: `Always included: ${MANDATORY_ATTRIBUTES.join(", ")}.${lib.focus.length ? " I've put the fields matching your request first." : ` Add anything else you need, including ${s.label.toLowerCase()} specific fields.`}`,
    multi: true,
    options: [
      ...lib.focus.map((a) => ({ id: slug(a), label: a, hint: "Matches your request" })),
      ...lib.core.map((a) => ({ id: slug(a), label: a })),
      ...lib.sector.map((a) => ({ id: slug(a), label: a, hint: "Industry field" })),
    ],
    allowOther: true,
  });

  q.push({
    id: "fresh",
    text: "How often should the data be refreshed?",
    help: "This sets the scrape frequency and the change-detection cadence.",
    options: [
      { id: "rt", label: "Real-time / continuous scrape", hint: "Data never older than a day" },
      { id: "d7", label: "Weekly refresh", hint: "Data within 7 days" },
      { id: "d30", label: "Monthly refresh", hint: "Data within 30 days" },
      { id: "d90", label: "Quarterly refresh", hint: "Data within 90 days" },
      { id: "annual", label: "Annual refresh", hint: "Reviewed once a year" },
      { id: "once", label: "One-time snapshot", hint: "No refresh" },
    ],
    allowOther: true,
  });

  return q;
}

export function profileLabels(sectorId: SectorId | null, ids: string[]): string[] {
  const s = sectorId && sectorId in SECTORS ? SECTORS[sectorId] : SECTORS.generic;
  const opts = SECTOR_PROFILE[s.id].options;
  return ids
    .filter((v) => v !== "anytype")
    .map((v) => (isOther(v) ? otherText(v) : (opts.find((o) => slug(o) === v) ?? v)));
}

function slug(s: string) {
  return s.toLowerCase().replace(/\W+/g, "-");
}


/* -------------------------------- proposal -------------------------------- */

export type WorkflowNode = { id: string; label: string; kind: "io" | "fetch" | "llm" | "filter" | "merge" };

export type Proposal = {
  sector: Sector;
  title: string;
  geo: string;
  sources: { name: string; kind: "Company website" | "Third-party"; note: string }[];
  attributes: string[];
  workflow: WorkflowNode[];
  volume: string;
  volumeNote: string;
  timeline: string;
  cadence: string;
  validation: string;
  route: "targeted" | "openweb" | "new";
  routeLabel: string;
  metadata: { label: string; value: string }[];
};

const SIZE_SHARE: Record<string, number> = { micro: 0.45, smb: 0.3, mid: 0.16, large: 0.09 };

const EMP_LABEL: Record<string, string> = {
  micro: "Under 50",
  smb: "50 - 500",
  mid: "500 - 5,000",
  large: "5,000+",
  anysize: "No employee filter",
};

const REV_LABEL: Record<string, string> = {
  r1: "Under $10M",
  r2: "$10M - $100M",
  r3: "$100M - $1B",
  r4: "$1B+",
  anyrev: "No revenue filter",
};

const FRESH_CADENCE: Record<string, string> = {
  rt: "Daily",
  d7: "Weekly",
  d30: "Monthly",
  d90: "Quarterly",
  annual: "Annually",
  once: "One-time",
};

const FRESH_LABEL: Record<string, string> = {
  rt: "Real-time / continuous",
  d7: "Weekly refresh",
  d30: "Monthly refresh",
  d90: "Quarterly refresh",
  annual: "Annual refresh",
  once: "One-time snapshot",
};

export function buildProposal(answers: Answers, requestLine: string, focus: Focus[] = []): Proposal {
  const pick = (id: string) => answers[id]?.[0] ?? "";
  const sectorId = (pick("sector") in SECTORS ? pick("sector") : "generic") as SectorId;
  const s = SECTORS[sectorId];
  const geoId = (pick("geo") in GEO_LABEL ? pick("geo") : "global") as GeoId;
  const geoLabel = isOther(pick("geo")) ? otherText(pick("geo")) : GEO_LABEL[geoId];

  // volume
  const base = s.universe[geoId];
  const sizes = (answers["employees"] ?? []).filter((v) => v in SIZE_SHARE);
  const revenueSel = (answers["revenue"] ?? []).filter((v) => ["r1", "r2", "r3", "r4"].includes(v));
  const segmentSel = (answers["segment"] ?? []).filter((v) => v !== "all");
  const share = sizes.length ? Math.min(1, sizes.reduce((a, k) => a + (SIZE_SHARE[k] ?? 0.2), 0)) : 1;
  const universeMode = pick("universe");
  const factor =
    universeMode === "listed"
      ? 0.15
      : universeMode === "top"
        ? 0.25
        : universeMode === "upload"
          ? 0.6
          : universeMode === "registry"
            ? 0.7
            : universeMode === "private"
              ? 0.85
              : 1;
  const est = Math.max(60, Math.round((base * share * factor) / 10) * 10);

  const profileSel = profileLabels(sectorId, answers["profile"] ?? []);

  // attributes
  const chosen = answers["core"] ?? [];
  const lib = attributeLibrary(sectorId, focus);
  const optional = [
    ...lib.focus.filter((a) => chosen.includes(slug(a))),
    ...lib.core.filter((a) => chosen.includes(slug(a))),
    ...lib.sector.filter((a) => chosen.includes(slug(a))),
    ...chosen.filter(isOther).map(otherText),
  ];
  const extraSel = [...lib.sector, ...lib.focus].filter((a) => chosen.includes(slug(a)));
  const attributes = [...MANDATORY_ATTRIBUTES, ...optional];


  const freshId = pick("fresh") || "d30";
  const cadence = FRESH_CADENCE[freshId] ?? "Monthly";

  // timeline
  const sizeDays = est < 500 ? 3 : est < 5000 ? 5 : est < 50000 ? 8 : 12;
  const totalDays = sizeDays + 1 + Math.ceil(extraSel.length / 4);

  const sources: Proposal["sources"] = [
    { name: `Official ${s.noun} websites`, kind: "Company website", note: "Primary source of truth - always included" },
    ...s.sources.slice(1).map((n) => ({ name: n, kind: "Third-party" as const, note: "Public pages only, used to fill gaps and corroborate" })),
  ];

  const route: Proposal["route"] = universeMode === "upload" ? "openweb" : sectorId === "generic" ? "new" : "openweb";

  return {
    sector: s,
    title: requestLine.trim()
      ? requestLine.trim().replace(/^\w/, (c) => c.toUpperCase())
      : `${s.label} - firmographic dataset (${geoLabel})`,
    geo: geoLabel,
    sources,
    attributes,
    workflow: buildWorkflow("cross", universeMode, extraSel.length > 0),
    volume: `~${est.toLocaleString()} records`,
    volumeNote: `${s.label} in ${geoLabel}${sizes.length ? ", filtered to the selected size bands" : ""}`,
    timeline: `${totalDays} working days to first delivery`,
    cadence,
    validation: "Every field cross-checked against the official company website",
    route,
    routeLabel: route === "openweb" ? "Solutions" : route === "new" ? "New solution" : "Agents",
    metadata: [
      { label: "Data family", value: "Firmographic" },
      { label: "Industry", value: s.label },
      {
        label: "Segments",
        value: segmentSel.length
          ? segmentSel.map((v) => (isOther(v) ? otherText(v) : (s.segments.find((x) => slug(x) === v) ?? v))).join(", ")
          : "All segments",
      },
      ...(profileSel.length ? [{ label: "Type / class", value: profileSel.join(", ") }] : []),
      ...(sizes.length ? [{ label: "Employee size", value: sizes.map((v) => EMP_LABEL[v] ?? v).join(", ") }] : []),
      ...(revenueSel.length ? [{ label: "Revenue size", value: revenueSel.map((v) => REV_LABEL[v] ?? v).join(", ") }] : []),

      { label: "Geography", value: geoLabel },
      {
        label: "Company list",
        value:
          {
            discover: "Built by the Freda team",
            listed: "Public / listed only",
            private: "Private / unlisted only",
            upload: "Client-supplied list",
            top: "Top N by size",
            registry: "Specific registry / directory",
          }[universeMode] ?? "Built by the Freda team",
      },
      { label: "Freshness", value: FRESH_LABEL[freshId] ?? "Within 30 days" },
      { label: "Refresh", value: cadence },
      { label: "Attributes", value: `${attributes.length} fields (4 standard defaults)` },
      { label: "Sources", value: `1 company + ${sources.length - 1} third-party` },
      { label: "Change tracking", value: freshId === "once" ? "Snapshot only" : "Added / changed / deleted deltas" },
    ],
  };
}

function buildWorkflow(validation: string, universeMode: string, hasExtra: boolean): WorkflowNode[] {
  // Deliberately short - a readable, high-level process flow, not an engineering DAG.
  return [
    { id: "input", label: universeMode === "upload" ? "Input list" : "Source discovery", kind: "io" },
    { id: "fetch", label: "Crawl & capture pages", kind: "fetch" },
    { id: "extract", label: "AI-based extraction", kind: "llm" },
    { id: "classify", label: hasExtra ? "Enrich & classify" : "Classify & score", kind: "llm" },
    { id: "normalise", label: "Normalise & dedupe", kind: "merge" },
    {
      id: "validate",
      label: validation === "human" ? "QC + human review" : "Validate & QC",
      kind: "filter",
    },
    { id: "output", label: "Export dataset", kind: "io" },
  ];
}

export const FREDA_BOUNDARIES = [
  "Firmographic scope for now - company-level facts from publicly available pages.",
  "No logins, paywalls, or personal data; only what a visitor can see.",
  "Volume and timeline are estimates, not a binding quote or SLA.",
];
