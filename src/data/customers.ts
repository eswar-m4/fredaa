/**
 * FreDA — existing-customer workspace demo data.
 *
 * Deterministic (hash based) so server and client render identical values.
 */

export type ChangeType = "Added" | "Deleted" | "Modified" | "Verified";

export type AdmvCounts = { added: number; deleted: number; modified: number; verified: number };

export type ProjectHistoryPoint = { label: string; records: number; accuracy: number };

export type Project = {
  id: string;
  customerId: string;
  name: string;
  source: string;
  websiteUrl: string;
  datapoints: string[];
  records: number;
  admv: AdmvCounts;
  freshness: number;
  accuracy: number;
  coverage: number;
  frequency: "Daily" | "Weekly" | "Monthly";
  lastRefreshHrs: number;
  nextRefreshHrs: number;
  status: "Healthy" | "Review pending" | "Refreshing" | "Attention";
  pendingReview: number;
  history: ProjectHistoryPoint[];
};

export type Customer = {
  id: string;
  name: string;
  shortName: string;
  industry: string;
  accountManager: string;
  since: string;
  projects: Project[];
};

export type ReviewRecord = {
  id: string;
  projectId: string;
  entity: string;
  datapoint: string;
  oldValue: string;
  newValue: string;
  changeType: ChangeType;
  confidence: number;
  source: string;
  detectedHrs: number;
};

/* ------------------------------------------------------------------ */

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
function rnd(seed: string, min: number, max: number) {
  return min + ((hash(seed) % 1000) / 1000) * (max - min);
}
function pick<T>(seed: string, arr: T[]): T {
  return arr[hash(seed) % arr.length]!;
}
function int(seed: string, min: number, max: number) {
  return Math.round(rnd(seed, min, max));
}

const DP_SETS: Record<string, string[]> = {
  education: [
    "Institution name", "Campus city", "Program name", "Program level", "Discipline",
    "Tuition fee", "Duration", "Intake month", "Accreditation", "Faculty count",
    "Enrollment size", "Delivery mode", "Course code", "Credit hours", "Prerequisite",
    "Contact email", "Phone", "Website", "LinkedIn", "Last verified",
  ],
  finance: [
    "Entity name", "Legal name", "LEI code", "Jurisdiction", "Regulator",
    "License type", "License status", "AUM band", "Compliance officer", "Registered address",
    "Sanctions flag", "PEP flag", "Risk tier", "Parent entity", "Ownership %",
    "Filing date", "Filing type", "Contact email", "Phone", "Website",
  ],
  b2b: [
    "Company name", "Legal name", "Domain", "HQ city", "HQ country",
    "Employee count", "Revenue band", "Industry", "SIC code", "Founded year",
    "Tech stack", "Funding stage", "Last funding", "CEO name", "Decision maker",
    "Email pattern", "Phone", "LinkedIn", "Careers page", "Last verified",
  ],
  media: [
    "Title", "Author", "Publisher", "ISBN", "Edition",
    "Publish date", "Format", "Price", "Currency", "Availability",
    "Category", "Sub category", "Page count", "Language", "Rating",
    "Review count", "Retailer", "Product URL", "Image URL", "Last verified",
  ],
  retail: [
    "Product title", "Brand", "SKU", "MRP", "Selling price",
    "Discount %", "Stock status", "Seller", "Fulfilment", "Rating",
    "Review count", "Category", "Variant", "Colour", "Size",
    "Shipping fee", "Return window", "Product URL", "Image URL", "Last verified",
  ],
};

type Spec = {
  id: string;
  name: string;
  shortName: string;
  industry: string;
  accountManager: string;
  since: string;
  dpSet: keyof typeof DP_SETS;
  projects: Array<{ name: string; source: string; url: string; records: number; freq: Project["frequency"] }>;
};

const SPECS: Spec[] = [
  {
    id: "ntm",
    name: "NTM Global",
    shortName: "NTM",
    industry: "Market Intelligence",
    accountManager: "Priya Nair",
    since: "Mar 2022",
    dpSet: "b2b",
    projects: [
      { name: "Enterprise Accounts EMEA", source: "company websites", url: "https://ntm.example.com", records: 184200, freq: "Daily" },
      { name: "Technographics Feed", source: "builtwith.com", url: "https://builtwith.com", records: 96400, freq: "Daily" },
      { name: "Funding & M&A Signals", source: "crunchbase.com", url: "https://crunchbase.com", records: 41800, freq: "Weekly" },
      { name: "Decision Maker Contacts", source: "linkedin.com", url: "https://linkedin.com", records: 268900, freq: "Weekly" },
      { name: "Hiring Intent Monitor", source: "careers pages", url: "https://ntm.example.com/jobs", records: 58300, freq: "Daily" },
    ],
  },
  {
    id: "cengage",
    name: "Cengage Learning",
    shortName: "Cengage",
    industry: "Education Publishing",
    accountManager: "Arun Kumar",
    since: "Jul 2021",
    dpSet: "education",
    projects: [
      { name: "Course Catalog — US Universities", source: "university sites", url: "https://cengage.example.com", records: 312400, freq: "Weekly" },
      { name: "Textbook Pricing Watch", source: "amazon.com", url: "https://amazon.com", records: 148600, freq: "Daily" },
      { name: "Faculty & Department Directory", source: "university sites", url: "https://cengage.example.com/faculty", records: 92100, freq: "Monthly" },
      { name: "Accreditation Registry", source: "accreditation bodies", url: "https://chea.org", records: 18400, freq: "Monthly" },
      { name: "Competitor Title Coverage", source: "pearson.com", url: "https://pearson.com", records: 64700, freq: "Weekly" },
    ],
  },
  {
    id: "ibg",
    name: "IBG Partners",
    shortName: "IBG",
    industry: "Investment Banking",
    accountManager: "Meera Suresh",
    since: "Jan 2023",
    dpSet: "finance",
    projects: [
      { name: "Private Company Financials", source: "filings portals", url: "https://sec.gov", records: 74300, freq: "Weekly" },
      { name: "Deal Pipeline Tracker", source: "press releases", url: "https://ibg.example.com/deals", records: 22900, freq: "Daily" },
      { name: "Ownership & Cap Table", source: "registry data", url: "https://opencorporates.com", records: 41200, freq: "Monthly" },
      { name: "Regulatory Filings Monitor", source: "sec.gov", url: "https://sec.gov", records: 133800, freq: "Daily" },
      { name: "Sector Comparables", source: "exchange sites", url: "https://nyse.com", records: 28600, freq: "Weekly" },
    ],
  },
  {
    id: "candid",
    name: "Candid Data",
    shortName: "Candid",
    industry: "Nonprofit Intelligence",
    accountManager: "Rahul Iyer",
    since: "Sep 2022",
    dpSet: "b2b",
    projects: [
      { name: "Nonprofit Org Profiles", source: "irs.gov", url: "https://irs.gov", records: 421600, freq: "Monthly" },
      { name: "Grant Award Feed", source: "grants.gov", url: "https://grants.gov", records: 88400, freq: "Weekly" },
      { name: "Foundation Leadership", source: "foundation sites", url: "https://candid.example.com", records: 54200, freq: "Monthly" },
      { name: "Program Impact Reports", source: "annual reports", url: "https://candid.example.com/reports", records: 19700, freq: "Monthly" },
      { name: "Donor Event Signals", source: "eventbrite.com", url: "https://eventbrite.com", records: 33500, freq: "Weekly" },
    ],
  },
  {
    id: "nice",
    name: "NICE Actimize",
    shortName: "NICE",
    industry: "Financial Crime & Compliance",
    accountManager: "Sneha Raman",
    since: "Nov 2020",
    dpSet: "finance",
    projects: [
      { name: "Sanctions & Watchlists", source: "ofac.treasury.gov", url: "https://ofac.treasury.gov", records: 96800, freq: "Daily" },
      { name: "PEP Registry Refresh", source: "government registries", url: "https://nice.example.com/pep", records: 142300, freq: "Daily" },
      { name: "Adverse Media Monitor", source: "news publishers", url: "https://nice.example.com/media", records: 288100, freq: "Daily" },
      { name: "Regulator Enforcement Actions", source: "fca.org.uk", url: "https://fca.org.uk", records: 37400, freq: "Weekly" },
      { name: "Beneficial Ownership", source: "opencorporates.com", url: "https://opencorporates.com", records: 118900, freq: "Monthly" },
    ],
  },
];

function buildProject(spec: Spec, p: Spec["projects"][number], idx: number): Project {
  const id = `${spec.id}-p${idx + 1}`;
  const records = p.records;
  const added = int(`${id}-a`, records * 0.004, records * 0.02);
  const deleted = int(`${id}-d`, records * 0.001, records * 0.006);
  const modified = int(`${id}-m`, records * 0.01, records * 0.05);
  const verified = records - added - deleted - modified;
  const status = pick(`${id}-s`, ["Healthy", "Review pending", "Refreshing", "Healthy", "Attention", "Review pending"] as Project["status"][]);
  const gap = p.freq === "Daily" ? 24 : p.freq === "Weekly" ? 168 : 720;
  const lastRefreshHrs = Number(rnd(`${id}-lr`, 0.4, gap * 0.6).toFixed(1));

  const points = p.freq === "Daily" ? 8 : 6;
  const history = Array.from({ length: points }, (_, i) => ({
    label: p.freq === "Daily" ? `D-${points - i}` : p.freq === "Weekly" ? `W-${points - i}` : `M-${points - i}`,
    records: int(`${id}-h${i}`, records * 0.93, records * 1.03),
    accuracy: Number(rnd(`${id}-ha${i}`, 91, 99.4).toFixed(1)),
  }));

  return {
    id,
    customerId: spec.id,
    name: p.name,
    source: p.source,
    websiteUrl: p.url,
    datapoints: DP_SETS[spec.dpSet]!,
    records,
    admv: { added, deleted, modified, verified },
    freshness: Math.max(62, Math.round(100 - (lastRefreshHrs / gap) * 34)),
    accuracy: Number(rnd(`${id}-acc`, 92.4, 99.3).toFixed(1)),
    coverage: Number(rnd(`${id}-cov`, 86.5, 99.5).toFixed(1)),
    frequency: p.freq,
    lastRefreshHrs,
    nextRefreshHrs: Number((gap - lastRefreshHrs).toFixed(1)),
    status,
    pendingReview: status === "Healthy" ? int(`${id}-pr`, 0, 40) : int(`${id}-pr`, 60, 900),
    history,
  };
}

export const CUSTOMERS: Customer[] = SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  shortName: spec.shortName,
  industry: spec.industry,
  accountManager: spec.accountManager,
  since: spec.since,
  projects: spec.projects.map((p, i) => buildProject(spec, p, i)),
}));

export function getCustomer(id: string): Customer {
  return CUSTOMERS.find((c) => c.id === id) ?? CUSTOMERS[0]!;
}

export function allProjects(customer: Customer) {
  return customer.projects;
}

export function rollup(customer: Customer) {
  const p = customer.projects;
  const records = p.reduce((s, x) => s + x.records, 0);
  const admv = p.reduce(
    (s, x) => ({
      added: s.added + x.admv.added,
      deleted: s.deleted + x.admv.deleted,
      modified: s.modified + x.admv.modified,
      verified: s.verified + x.admv.verified,
    }),
    { added: 0, deleted: 0, modified: 0, verified: 0 },
  );
  const pendingReview = p.reduce((s, x) => s + x.pendingReview, 0);
  const accuracy = p.reduce((s, x) => s + x.accuracy, 0) / p.length;
  const coverage = p.reduce((s, x) => s + x.coverage, 0) / p.length;
  const freshness = p.reduce((s, x) => s + x.freshness, 0) / p.length;
  return { records, admv, pendingReview, accuracy, coverage, freshness, projects: p.length };
}

/* ---------------- review records ---------------- */

const ENTITY_PREFIX: Record<string, string[]> = {
  education: ["Northwestern University", "Boston College", "Rice University", "UC Davis", "Emory University", "Purdue University", "Tulane University", "Baylor University"],
  finance: ["Halcyon Capital LLP", "Meridian Trust AG", "Bluefin Securities", "Orion Asset Mgmt", "Kestrel Holdings", "Vantage Credit Union", "Northgate Partners", "Sable Financial"],
  b2b: ["Brightwave Systems", "Corvus Analytics", "Lumen Robotics", "Fernwood Health", "Atlas Freight", "Nimbus Cloudworks", "Petra Materials", "Skyline Retail Grp"],
  media: ["Foundations of Biology", "Applied Econometrics", "Modern World History", "Organic Chemistry 9e", "Intro to Psychology", "Calculus: Early Trans."],
  retail: ["Aurora Blender X2", "Trailhead Backpack 40L", "Nova Desk Lamp", "Peak Running Shoe", "Cedar Coffee Table"],
};

function entityPool(customerId: string) {
  const spec = SPECS.find((s) => s.id === customerId)!;
  return ENTITY_PREFIX[spec.dpSet]!;
}

function valueFor(datapoint: string, seed: string) {
  const dp = datapoint.toLowerCase();
  if (dp.includes("price") || dp.includes("fee") || dp.includes("mrp")) return `$${int(seed, 40, 1800).toLocaleString()}`;
  if (dp.includes("count") || dp.includes("size") || dp.includes("hours") || dp.includes("year")) return String(int(seed, 4, 4200));
  if (dp.includes("email")) return `contact${int(seed, 1, 99)}@example.com`;
  if (dp.includes("phone")) return `+1 (${int(seed, 200, 989)}) ${int(seed + "b", 200, 989)}-${int(seed + "c", 1000, 9999)}`;
  if (dp.includes("url") || dp.includes("website") || dp.includes("linkedin") || dp.includes("domain") || dp.includes("page"))
    return `https://${pick(seed, ["site", "portal", "web", "info"])}${int(seed, 1, 99)}.example.com`;
  if (dp.includes("date") || dp.includes("verified") || dp.includes("month"))
    return `${pick(seed, ["Jan", "Feb", "Mar", "Apr", "Jun", "Sep", "Oct", "Nov"])} ${int(seed, 1, 28)}, 2026`;
  if (dp.includes("status") || dp.includes("flag"))
    return pick(seed, ["Active", "In stock", "Verified", "Clear", "Under review", "Suspended"]);
  if (dp.includes("%")) return `${int(seed, 2, 88)}%`;
  return pick(seed, ["Tier 1", "Amber", "Global", "Regional", "Standard", "Premium", "Grade A", "Category B"]) + " " + int(seed + "x", 10, 99);
}

export function reviewRecordsFor(project: Project, count = 24): ReviewRecord[] {
  const pool = entityPool(project.customerId);
  return Array.from({ length: count }, (_, i) => {
    const seed = `${project.id}-rr-${i}`;
    const datapoint = project.datapoints[hash(seed + "dp") % project.datapoints.length]!;
    const changeType = pick(seed + "ct", ["Modified", "Modified", "Added", "Deleted", "Verified"] as ChangeType[]);
    const oldValue = changeType === "Added" ? "—" : valueFor(datapoint, seed + "old");
    const newValue = changeType === "Deleted" ? "—" : valueFor(datapoint, seed + "new");
    return {
      id: `${project.id}-R${1000 + i}`,
      projectId: project.id,
      entity: `${pool[hash(seed + "e") % pool.length]}`,
      datapoint,
      oldValue,
      newValue,
      changeType,
      confidence: Number(rnd(seed + "cf", 71, 99.5).toFixed(1)),
      source: project.source,
      detectedHrs: Number(rnd(seed + "dt", 0.3, 48).toFixed(1)),
    };
  });
}

/* ---------------- dashboard side panels ---------------- */

export type ActionItem = {
  id: string;
  projectId: string;
  project: string;
  action: string;
  records: number;
  priority: "Critical" | "High" | "Medium";
  age: string;
};

export function actionsFor(customer: Customer): ActionItem[] {
  const templates = [
    "Approve changed contact details",
    "Confirm removed records",
    "Layout change — re-map 3 fields",
    "Verify price movement > 30%",
    "Resolve duplicate entities",
    "Validate newly added records",
    "Re-check low-confidence extractions",
  ];
  return customer.projects
    .map((p, i) => ({
      id: `${p.id}-act`,
      projectId: p.id,
      project: p.name,
      action: templates[hash(p.id + "act") % templates.length]!,
      records: Math.max(12, Math.round(p.pendingReview * 0.6)),
      priority: (p.status === "Attention" ? "Critical" : p.pendingReview > 400 ? "High" : "Medium") as ActionItem["priority"],
      age: pick(p.id + "age", ["Today", "Today", "2 days ago", "5 days ago", "Last week"]),
      _i: i,
    }))
    .sort((a, b) => b.records - a.records)
    .map(({ _i, ...rest }) => rest);
}

export type DevItem = {
  id: string;
  title: string;
  stage: "Scoping" | "Source discovery" | "Build in progress" | "QA & validation" | "UAT with customer";
  progress: number;
  eta: string;
  owner: string;
};

const DEV_TITLES: Record<string, string[]> = {
  ntm: ["Add 6 new EMEA source sites", "Firmographic enrichment v2", "Intent scoring model refresh"],
  cengage: ["Syllabus PDF parsing pipeline", "Add 40 community colleges", "Textbook edition de-duplication"],
  ibg: ["Cap table lineage graph", "Add EU filings coverage", "Deal press-release classifier"],
  candid: ["Form 990 extraction upgrade", "Grant taxonomy remap", "Board member linkage"],
  nice: ["Adverse media NLP scoring", "Add 12 regulator feeds", "Real-time sanctions delta API"],
};

export function devPipeline(customer: Customer): DevItem[] {
  const stages: DevItem["stage"][] = ["Scoping", "Source discovery", "Build in progress", "QA & validation", "UAT with customer"];
  return (DEV_TITLES[customer.id] ?? DEV_TITLES.ntm!).map((title, i) => {
    const seed = `${customer.id}-dev-${i}`;
    const stage = stages[(hash(seed) + i) % stages.length]!;
    const progress = { Scoping: 15, "Source discovery": 38, "Build in progress": 64, "QA & validation": 82, "UAT with customer": 93 }[stage];
    return {
      id: `DEV-${3000 + hash(seed) % 900}`,
      title,
      stage,
      progress,
      eta: `${int(seed + "eta", 2, 18)} working days`,
      owner: pick(seed + "own", ["priya.n", "arun.k", "meera.s", "rahul.i", "sneha.r"]),
    };
  });
}

export function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function hrsAgo(h: number) {
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function inHrs(h: number) {
  if (h < 1) return `in ${Math.round(h * 60)}m`;
  if (h < 24) return `in ${Math.round(h)}h`;
  return `in ${Math.round(h / 24)}d`;
}
