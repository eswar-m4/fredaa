import type { Customer } from "@/data/customers";

export type PlaybookSolution = {
  id: string;
  name: string;
  blurb: string;
  group: "Core data" | "Monitoring" | "Enrichment" | "Commercial" | "Compliance";
  sources: number;
  datapoints: number;
  refresh: "Daily" | "Weekly" | "Monthly";
};


type Spec = { id: string; name: string; blurb: string; group: PlaybookSolution["group"]; sources: number; datapoints: number; refresh: PlaybookSolution["refresh"] };

const SPECS: Spec[] = [
  { id: "core-profile", name: "{industry} core profile", blurb: "Entity master with identity, location and classification fields kept continuously verified.", group: "Core data", sources: 4, datapoints: 18, refresh: "Weekly" },
  { id: "entity-discovery", name: "New entity discovery", blurb: "Finds entities that exist in the market but are missing from your master list.", group: "Core data", sources: 7, datapoints: 10, refresh: "Weekly" },
  { id: "change-monitoring", name: "Change & event monitoring", blurb: "Daily delta feed of added, deleted and modified records with confidence scoring.", group: "Monitoring", sources: 6, datapoints: 12, refresh: "Daily" },
  { id: "closure-watch", name: "Closure & inactivity watch", blurb: "Flags entities that shut down, merge or go dormant before they pollute your CRM.", group: "Monitoring", sources: 5, datapoints: 8, refresh: "Weekly" },
  { id: "contact-enrichment", name: "Contact & decision maker enrichment", blurb: "Role-level contacts appended to each verified entity, with pattern validation.", group: "Enrichment", sources: 3, datapoints: 9, refresh: "Monthly" },
  { id: "email-validation", name: "Email & phone validation", blurb: "Syntax, MX and reachability checks on every contact datapoint you already hold.", group: "Enrichment", sources: 2, datapoints: 6, refresh: "Monthly" },
  { id: "firmographics", name: "Firmographic enrichment", blurb: "Employee bands, revenue, ownership and industry codes attached to each record.", group: "Enrichment", sources: 5, datapoints: 16, refresh: "Monthly" },
  { id: "technographics", name: "Technographic signals", blurb: "Detected tech stack, vendors and platform migrations for each verified domain.", group: "Enrichment", sources: 4, datapoints: 11, refresh: "Monthly" },
  { id: "pricing-watch", name: "Competitive pricing & offer watch", blurb: "Price, availability and promotion tracking across the sources you already run.", group: "Commercial", sources: 5, datapoints: 14, refresh: "Daily" },
  { id: "catalog-sync", name: "Catalogue & assortment sync", blurb: "Full SKU/offer catalogue with variants, media and category mapping.", group: "Commercial", sources: 6, datapoints: 20, refresh: "Daily" },
  { id: "stock-availability", name: "Stock & availability tracker", blurb: "Availability, lead time and fulfilment signals refreshed multiple times a day.", group: "Commercial", sources: 4, datapoints: 7, refresh: "Daily" },
  { id: "review-sentiment", name: "Ratings & review intelligence", blurb: "Ratings, volumes and themed sentiment aggregated across public review sites.", group: "Commercial", sources: 6, datapoints: 12, refresh: "Weekly" },
  { id: "location-nap", name: "Location & NAP verification", blurb: "Name, address and phone consistency across directories, maps and your own site.", group: "Core data", sources: 8, datapoints: 10, refresh: "Weekly" },
  { id: "hierarchy", name: "Corporate hierarchy mapping", blurb: "Parent, subsidiary and branch relationships resolved into a single tree.", group: "Core data", sources: 5, datapoints: 9, refresh: "Monthly" },
  { id: "license-registry", name: "Licence & registry verification", blurb: "Regulator and registry checks confirming each entity is active and in good standing.", group: "Compliance", sources: 6, datapoints: 13, refresh: "Monthly" },
  { id: "sanctions", name: "Sanctions & adverse media screening", blurb: "Watchlist, PEP and adverse-media screening tied to your verified entity list.", group: "Compliance", sources: 7, datapoints: 8, refresh: "Daily" },
  { id: "dedupe", name: "Deduplication & golden record", blurb: "Fuzzy match, merge rules and a single surviving golden record per entity.", group: "Core data", sources: 2, datapoints: 15, refresh: "Weekly" },
  { id: "intent", name: "Hiring & expansion intent", blurb: "Job posts, new locations and funding events converted into buying signals.", group: "Monitoring", sources: 6, datapoints: 11, refresh: "Weekly" },
  { id: "custom-build", name: "Custom {industry} build", blurb: "Bring your own source list and datapoint spec — we scope, build and QA it for you.", group: "Core data", sources: 3, datapoints: 20, refresh: "Weekly" },
];

export function solutionsFor(customer: Customer): PlaybookSolution[] {
  return SPECS.map((s) => ({
    ...s,
    name: s.name.replace("{industry}", customer.industry),
  }));
}

export const SOLUTION_GROUPS: PlaybookSolution["group"][] = ["Core data", "Monitoring", "Enrichment", "Commercial", "Compliance"];
