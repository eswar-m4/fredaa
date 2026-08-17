/**
 * Demo workspace data.
 *
 * The portal reads jobs from the backend (`/api/v1/demo/jobs`) and falls back to the
 * local jobs cache. In demo/presentation mode the backend may be unavailable, so we
 * seed a realistic set of jobs, projects and review numbers into that same cache.
 * Every screen (Dashboard, Monitoring, Review, Export) then shows populated data.
 */
import { readJobsCache, writeJobsCache } from "@/lib/jobs-cache";

export const DEMO_PROJECTS = [
  "All Data",
  "Healthcare India",
  "Hospitality APAC",
  "Retail Price Watch",
  "Insurance Aggregators",
  "Automotive Rentals",
  "Legal Directory",
] as const;

export type DemoProject = (typeof DEMO_PROJECTS)[number];

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function iso(offsetMs: number) {
  return new Date(Date.now() - offsetMs).toISOString();
}

type Seed = {
  id: string;
  project: Exclude<DemoProject, "All Data">;
  source: string;
  website_url: string;
  mode: "By Source" | "By Dataset";
  status: "Running" | "Review Pending" | "Completed";
  records: number;
  changes_detected: number;
  added: number;
  deleted: number;
  verified: number;
  approved_count: number;
  rejected_count: number;
  frequency: "Daily" | "Weekly" | "Monthly";
  scope: string;
  ageDays: number;
  urgent?: boolean;
};

const SEEDS: Seed[] = [
  { id: "J-24101", project: "Healthcare India", source: "apollohospitals.com", website_url: "https://www.apollohospitals.com", mode: "By Source", status: "Running", records: 18420, changes_detected: 612, added: 240, deleted: 38, verified: 17890, approved_count: 15200, rejected_count: 310, frequency: "Daily", scope: "Doctors, departments, contact", ageDays: 0.2 },
  { id: "J-24102", project: "Healthcare India", source: "fortishealthcare.com", website_url: "https://www.fortishealthcare.com", mode: "By Source", status: "Review Pending", records: 9640, changes_detected: 431, added: 118, deleted: 22, verified: 9120, approved_count: 6100, rejected_count: 205, frequency: "Daily", scope: "Hospital network, phone, address", ageDays: 0.6, urgent: true },
  { id: "J-24103", project: "Healthcare India", source: "practo.com", website_url: "https://www.practo.com", mode: "By Dataset", status: "Completed", records: 54210, changes_detected: 2870, added: 1420, deleted: 260, verified: 51800, approved_count: 51800, rejected_count: 940, frequency: "Weekly", scope: "Clinics in South India", ageDays: 2 },
  { id: "J-24104", project: "Hospitality APAC", source: "makemytrip.com", website_url: "https://www.makemytrip.com", mode: "By Dataset", status: "Running", records: 128400, changes_detected: 9840, added: 3120, deleted: 780, verified: 121300, approved_count: 98400, rejected_count: 2100, frequency: "Daily", scope: "Hotel rates, availability", ageDays: 0.1 },
  { id: "J-24105", project: "Hospitality APAC", source: "hotels.com", website_url: "https://www.hotels.com", mode: "By Dataset", status: "Review Pending", records: 86200, changes_detected: 5410, added: 2010, deleted: 410, verified: 80900, approved_count: 61000, rejected_count: 1450, frequency: "Daily", scope: "Property listings, ratings", ageDays: 0.9 },
  { id: "J-24106", project: "Retail Price Watch", source: "amazon.in", website_url: "https://www.amazon.in", mode: "By Dataset", status: "Running", records: 342800, changes_detected: 28410, added: 8120, deleted: 3140, verified: 331200, approved_count: 288000, rejected_count: 6100, frequency: "Daily", scope: "Price, MRP, stock, seller", ageDays: 0.05 },
  { id: "J-24107", project: "Retail Price Watch", source: "flipkart.com", website_url: "https://www.flipkart.com", mode: "By Dataset", status: "Completed", records: 251600, changes_detected: 19240, added: 6210, deleted: 2410, verified: 244100, approved_count: 244100, rejected_count: 4820, frequency: "Daily", scope: "Price, offers, ratings", ageDays: 1.4 },
  { id: "J-24108", project: "Insurance Aggregators", source: "policybazaar.com", website_url: "https://www.policybazaar.com", mode: "By Source", status: "Review Pending", records: 41200, changes_detected: 3120, added: 940, deleted: 210, verified: 39100, approved_count: 26400, rejected_count: 880, frequency: "Weekly", scope: "Premiums, plan features", ageDays: 3, urgent: true },
  { id: "J-24109", project: "Insurance Aggregators", source: "coverfox.com", website_url: "https://www.coverfox.com", mode: "By Source", status: "Completed", records: 18900, changes_detected: 1210, added: 380, deleted: 90, verified: 18100, approved_count: 18100, rejected_count: 410, frequency: "Weekly", scope: "Motor & health plans", ageDays: 6 },
  { id: "J-24110", project: "Automotive Rentals", source: "zoomcar.com", website_url: "https://www.zoomcar.com", mode: "By Dataset", status: "Running", records: 62400, changes_detected: 4810, added: 1620, deleted: 520, verified: 59800, approved_count: 47200, rejected_count: 1180, frequency: "Daily", scope: "Fleet, tariffs, city coverage", ageDays: 0.3 },
  { id: "J-24111", project: "Automotive Rentals", source: "cars24.com", website_url: "https://www.cars24.com", mode: "By Source", status: "Review Pending", records: 73100, changes_detected: 6120, added: 2410, deleted: 810, verified: 69800, approved_count: 41000, rejected_count: 1620, frequency: "Daily", scope: "Listings, price, variant", ageDays: 1.1 },
  { id: "J-24112", project: "Legal Directory", source: "barandbench.com", website_url: "https://www.barandbench.com", mode: "By Source", status: "Completed", records: 12800, changes_detected: 640, added: 210, deleted: 40, verified: 12400, approved_count: 12400, rejected_count: 180, frequency: "Monthly", scope: "Firms, practice areas", ageDays: 12 },
  { id: "J-24113", project: "Legal Directory", source: "lawyered.in", website_url: "https://www.lawyered.in", mode: "By Dataset", status: "Review Pending", records: 26400, changes_detected: 1840, added: 720, deleted: 160, verified: 25100, approved_count: 14800, rejected_count: 520, frequency: "Monthly", scope: "Attorney profiles, city, bar id", ageDays: 8 },
  { id: "J-24114", project: "Healthcare India", source: "yashodahospitals.com", website_url: "https://www.yashodahospitals.com", mode: "By Source", status: "Completed", records: 7400, changes_detected: 290, added: 88, deleted: 14, verified: 7180, approved_count: 7180, rejected_count: 96, frequency: "Weekly", scope: "Departments, doctors", ageDays: 4 },
  { id: "J-24115", project: "Hospitality APAC", source: "zomato.com", website_url: "https://www.zomato.com", mode: "By Dataset", status: "Running", records: 194300, changes_detected: 15420, added: 5120, deleted: 1810, verified: 186200, approved_count: 152000, rejected_count: 3410, frequency: "Daily", scope: "Restaurants, menus, hours", ageDays: 0.15 },
];

export type DemoJob = Record<string, any> & { id: string };

/* ---------- deterministic demo analytics (coverage / accuracy / ADMV / trend) ---------- */

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Stable pseudo-random value in [min, max] for a given seed string. */
function rnd(seed: string, min: number, max: number) {
  return min + (hash(seed) % 1000) / 1000 * (max - min);
}

const ATTRS_BY_PROJECT: Record<string, string[]> = {
  "Healthcare India": ["Facility name", "Website", "Address", "Phone", "Specialities", "Accreditation"],
  "Hospitality APAC": ["Property name", "Website", "City", "Star rating", "Room tariff", "Review score"],
  "Retail Price Watch": ["Product title", "Brand", "MRP", "Selling price", "Stock status", "Seller"],
  "Insurance Aggregators": ["Insurer", "Plan name", "Premium", "Sum insured", "Coverage terms", "Claim ratio"],
  "Automotive Rentals": ["Model", "Variant", "Price", "City availability", "Fuel type", "Dealer name"],
  "Legal Directory": ["Firm name", "Website", "Practice areas", "City", "Bar registration", "Phone"],
};

const EXTRA_SOURCES: Record<string, string[]> = {
  "Healthcare India": ["Company website", "practo.com", "justdial.com", "lybrate.com", "google maps"],
  "Hospitality APAC": ["Company website", "booking.com", "agoda.com", "tripadvisor.com", "zomato.com"],
  "Retail Price Watch": ["Company website", "amazon.in", "flipkart.com", "myntra.com", "nykaa.com"],
  "Insurance Aggregators": ["Company website", "policybazaar.com", "coverfox.com", "bankbazaar.com", "irdai.gov.in"],
  "Automotive Rentals": ["Company website", "cardekho.com", "cars24.com", "zoomcar.com", "spinny.com"],
  "Legal Directory": ["Company website", "barandbench.com", "lawrato.com", "vidhikarya.com", "justdial.com"],
};

function buildAnalytics(s: Seed) {
  const attrs = ATTRS_BY_PROJECT[s.project] ?? ["Name", "Website", "City", "Phone", "Email", "Category"];
  const sourceNames = s.mode === "By Dataset" ? EXTRA_SOURCES[s.project] ?? ["Company website"] : ["Company website", s.source];

  const attribute_breakdown = attrs.map((label, i) => {
    const cov = rnd(`${s.id}-attr-${label}`, 0.72, 0.99);
    const nonNull = Math.round(s.records * cov);
    return {
      attribute_key: label.toLowerCase().replace(/\W+/g, "_"),
      attribute_label: label,
      attr_coverage: Number(cov.toFixed(3)),
      non_null_values: nonNull,
      total_records_in_scope: s.records,
      _i: i,
    };
  });

  const source_breakdown = sourceNames.map((label) => {
    const cov = rnd(`${s.id}-src-${label}`, 0.68, 0.98);
    const requested = Math.round(s.records / sourceNames.length);
    return {
      source_key: label.toLowerCase().replace(/\W+/g, "_"),
      source_label: label,
      source_coverage: Number(cov.toFixed(3)),
      records_requested_from_source: requested,
      records_returned_by_source: Math.round(requested * cov),
      filled_fields: attrs.slice(0, 4).map((a) => ({ attribute_key: a.toLowerCase().replace(/\W+/g, "_") })),
    };
  });

  const reviewSlice = (label: string, key: string, total: number) => {
    const acc = rnd(`${s.id}-acc-${label}`, 0.86, 0.995);
    const reviewed = Math.max(40, Math.round(total * rnd(`${s.id}-rev-${label}`, 0.05, 0.18)));
    const approved = Math.round(reviewed * acc);
    return {
      key,
      label,
      coverage: Number(rnd(`${s.id}-cov-${label}`, 0.72, 0.99).toFixed(3)),
      reviewed,
      approved,
      rejected: reviewed - approved,
      accuracy: Number(acc.toFixed(3)),
      total,
      items: [] as string[],
    };
  };

  const review_summary = {
    updatedAt: iso(s.ageDays * DAY),
    overall: {
      reviewed: s.approved_count + s.rejected_count,
      approved: s.approved_count,
      rejected: s.rejected_count,
      accuracy: Number((s.approved_count / Math.max(1, s.approved_count + s.rejected_count)).toFixed(3)),
    },
    sourceBreakdown: source_breakdown.map((r) => reviewSlice(r.source_label, r.source_key, r.records_returned_by_source)),
    attributeBreakdown: attribute_breakdown.map((r) => reviewSlice(r.attribute_label, r.attribute_key, s.records)),
  };

  const runs = s.frequency === "Daily" ? 8 : s.frequency === "Weekly" ? 6 : 4;
  const refresh_history = Array.from({ length: runs }, (_, i) => ({
    run: i + 1,
    ran_at: iso((runs - i) * DAY + s.ageDays * DAY),
    rows: Math.round(s.records * rnd(`${s.id}-rows-${i}`, 0.92, 1.02)),
    accuracy_rate: Math.round(rnd(`${s.id}-hist-${i}`, 88, 99)),
  }));

  const admv = {
    Added: s.added,
    Deleted: s.deleted,
    Modified: Math.max(0, s.changes_detected - s.added - s.deleted),
    Verified: s.verified,
  };

  return { coverage: { source_breakdown, attribute_breakdown }, review_summary, refresh_history, admv };
}

export const DEMO_JOBS: DemoJob[] = SEEDS.map((s) => {
  const created = s.ageDays * DAY + 3 * DAY;
  const refreshed = s.ageDays * DAY;
  const nextGap = s.frequency === "Daily" ? DAY : s.frequency === "Weekly" ? 7 * DAY : 30 * DAY;
  const analytics = buildAnalytics(s);
  return {
    id: s.id,
    project: s.project,
    source: s.source,
    source_name: s.source,
    website_url: s.website_url,
    mode: s.mode,
    status: s.status,
    records: s.records,
    rows: s.records,
    changes_detected: s.changes_detected,
    added_count: s.added,
    deleted_count: s.deleted,
    verified_count: s.verified,
    approved_count: s.approved_count,
    rejected_count: s.rejected_count,
    freshness: Math.max(70, 100 - Math.round(s.ageDays * 3)),
    frequency: s.frequency,
    scope: s.scope,
    filters: JSON.stringify({ project: s.project, scope: s.scope }),
    delivery: "S3 + API",
    created_at: iso(created),
    last_refresh: iso(refreshed),
    next_refresh: new Date(Date.now() - refreshed + nextGap).toISOString(),
    refresh_count: s.frequency === "Daily" ? 42 : s.frequency === "Weekly" ? 12 : 4,
    dataset_path: s.mode === "By Dataset" ? `datasets/${s.source.replace(/\./g, "-")}.csv` : "",
    coverage: analytics.coverage,
    review_summary: analytics.review_summary,
    review_summary_updated_at: analytics.review_summary.updatedAt,
    admv: analytics.admv,
    refresh_history: analytics.refresh_history,
    is_urgent: Boolean(s.urgent),
    isUrgent: Boolean(s.urgent),
    complexity: s.records > 100000 ? "High" : s.records > 30000 ? "Medium" : "Low",
    estimated_onboarding_time: s.records > 100000 ? "5-7 days" : "2-3 days",
    isDemoSeed: true,
  };
});


/** In-flight solution requests raised from the Freda AI consultant. */
export const DEMO_SOLUTION_REQUESTS = [
  {
    id: "SR-3081",
    title: "Top CRM product companies - APAC",
    category: "B2B Software",
    stage: "Admin review",
    progress: 35,
    volume: "~4,200 companies",
    eta: "6 working days",
    raisedBy: "priya.n",
    raisedAgo: "2 days ago",
  },
  {
    id: "SR-3079",
    title: "Attorney profiles - Tier 2 cities",
    category: "Legal",
    stage: "Source discovery",
    progress: 60,
    volume: "~18,600 profiles",
    eta: "4 working days",
    raisedBy: "arun.k",
    raisedAgo: "4 days ago",
  },
  {
    id: "SR-3074",
    title: "EV charging network tariffs",
    category: "Automotive",
    stage: "Build in progress",
    progress: 82,
    volume: "~9,400 stations",
    eta: "2 working days",
    raisedBy: "meera.s",
    raisedAgo: "9 days ago",
  },
];

/** Action-needed rows for the dashboard (mirrors the ops whiteboard). */
export const DEMO_ACTIONS = [
  { project: "Retail Price Watch", recs: 1840, action: "Verify price drops > 40%", status: "Today", date: "Today" },
  { project: "Healthcare India", recs: 431, action: "Approve changed phone numbers", status: "Today", date: "Today" },
  { project: "Insurance Aggregators", recs: 312, action: "Layout change - re-map fields", status: "Last Week", date: "3 days ago" },
  { project: "Automotive Rentals", recs: 620, action: "Confirm deleted listings", status: "Last Week", date: "5 days ago" },
  { project: "Legal Directory", recs: 148, action: "Duplicate attorney records", status: "Last Month", date: "18 days ago" },
  { project: "Hospitality APAC", recs: 902, action: "Rate mismatch vs. company site", status: "Today", date: "Today" },
];

let seeded = false;

/** Seeds demo jobs into the local cache once, so demo screens are never empty. */
export function seedDemoJobs() {
  if (seeded || typeof window === "undefined") return;
  seeded = true;
  const existing = readJobsCache();
  const demoIds = new Set(DEMO_JOBS.map((j) => j.id));
  // Always refresh the demo rows so newly added analytics land in stale caches.
  const kept = existing.filter((j: any) => !demoIds.has(String(j?.id ?? "")));
  writeJobsCache([...kept, ...DEMO_JOBS]);
}

