// Which standard datasets are actually relevant per workspace industry.
// Existing customers should only see a short, credible shortlist — not the full catalogue.

export type IndustryFit = { ids: string[]; why: string };

const FITS: Record<string, IndustryFit> = {
  "Market Intelligence": {
    ids: ["ds-firmographic", "ds-contacts", "ds-funding", "ds-jobs", "ds-news"],
    why: "Account master, decision makers, funding events, hiring intent and news signals — the sources already wired for your monitoring feeds.",
  },
  "Education Publishing": {
    ids: ["ds-us-public-school-district-workforce", "ds-contacts", "ds-competitor-pricing", "ds-ecommerce", "ds-firmographic"],
    why: "Institution and faculty coverage plus title pricing across retail and campus stores.",
  },
  "Investment Banking": {
    ids: ["ds-financial", "ds-funding", "ds-registry", "ds-firmographic", "ds-news"],
    why: "Filings, ownership registries, deal and funding events sourced from regulators and primary filings portals.",
  },
  "Nonprofit Intelligence": {
    ids: ["ds-registry", "ds-financial", "ds-contacts", "ds-location", "ds-news"],
    why: "Registry status, published financials, leadership contacts and verified locations for grantmakers and recipients.",
  },
  "Financial Crime & Compliance": {
    ids: ["ds-registry", "ds-firmographic", "ds-financial", "ds-news", "ds-location"],
    why: "Entity identity, registry standing, beneficial-owner context and adverse-media signals for screening workflows.",
  },
};

const DEFAULT_FIT: IndustryFit = {
  ids: ["ds-firmographic", "ds-contacts", "ds-registry", "ds-news"],
  why: "Core entity, contact, registry and news coverage that applies to every workspace.",
};

export function industryFit(industry: string): IndustryFit {
  return FITS[industry] ?? DEFAULT_FIT;
}
