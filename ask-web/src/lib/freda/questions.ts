import type { IntentFamily, Requirement } from "./types";

export interface Question {
  field: string;
  prompt: string;
}

const BANKS: Record<IntentFamily, Question[]> = {
  healthcare: [
    { field: "entityType", prompt: "What provider or facility type do you need — hospitals, clinics, labs, or individual doctors?" },
    { field: "geography", prompt: "Which geography or market should this cover?" },
    { field: "attributes", prompt: "Which fields matter besides what you already mentioned — specialties, services, doctors, contacts?" },
    { field: "sources", prompt: "Do you have specific hospital/clinic websites or directories, or should Freda suggest sources from the catalog?" },
    { field: "frequency", prompt: "How often should this dataset refresh?" },
  ],
  hospitality: [
    { field: "entityType", prompt: "Are you looking for hotels, resorts, restaurants, or mixed venues?" },
    { field: "geography", prompt: "Which country or city should the coverage include?" },
    { field: "attributes", prompt: "Which outputs do you need — tariffs, availability, amenities, menus, review scores?" },
    { field: "sources", prompt: "Do you want specific OTAs or property sites, or should Freda suggest catalog sources?" },
    { field: "frequency", prompt: "What refresh cadence do you need?" },
  ],
  travel: [
    { field: "entityType", prompt: "Is this flight, hotel, holiday-package, or mixed travel data?" },
    { field: "geography", prompt: "Which markets or routes should be covered?" },
    { field: "attributes", prompt: "Which fields are required — price, availability, status, reviews?" },
    { field: "sources", prompt: "Which OTAs or airline/hotel sites should we use, if you have a preference?" },
    { field: "frequency", prompt: "How frequently should this refresh?" },
  ],
  product: [
    { field: "productCategory", prompt: "Which product category or assortment should we cover?" },
    { field: "attributes", prompt: "Which pricing fields matter — current price, list price, promo, seller, stock?" },
    { field: "sources", prompt: "Which marketplace or retailer sites should be included?" },
    { field: "geography", prompt: "Which market or storefront geography?" },
    { field: "frequency", prompt: "How often should prices be refreshed?" },
  ],
  financial: [
    { field: "extras.reportKind", prompt: "What do you need from the annual reports — original reports, extracted financial data, or both?" },
    { field: "extras.listed", prompt: "Should this cover listed companies, private companies, or both?" },
    { field: "extras.exchange", prompt: "Any specific exchange (for example BSE, NSE, SEC EDGAR)?" },
    { field: "geography", prompt: "Which geography or filing jurisdiction?" },
    { field: "frequency", prompt: "Is this a one-time pull or a recurring refresh, and at what cadence?" },
  ],
  firmographic: [
    { field: "industry", prompt: "Which industry or sector should the company universe include?" },
    { field: "geography", prompt: "Which geography or market?" },
    { field: "attributes", prompt: "Which company attributes are required (identity, industry, size, leadership, registry IDs)?" },
    { field: "frequency", prompt: "One-time extract or recurring refresh — and how often?" },
  ],
  registry: [
    { field: "geography", prompt: "Which registry jurisdiction?" },
    { field: "attributes", prompt: "Which registry fields — legal name, directors, filings, UBOs, identifiers?" },
    { field: "sources", prompt: "Any specific registry portals besides what you already named?" },
    { field: "frequency", prompt: "What refresh cadence do you need?" },
  ],
  jobs: [
    { field: "geography", prompt: "Which markets should job postings cover?" },
    { field: "attributes", prompt: "Which fields — title, location, salary, description, posted date?" },
    { field: "sources", prompt: "Any specific job boards or career sites?" },
    { field: "frequency", prompt: "How often should this refresh?" },
  ],
  legal: [
    { field: "geography", prompt: "Which geography should attorney/firm coverage include?" },
    { field: "attributes", prompt: "Which fields — practice areas, bar registration, fees, offices?" },
    { field: "sources", prompt: "Any specific legal directories or firm websites?" },
    { field: "frequency", prompt: "What refresh cadence?" },
  ],
  insurance: [
    { field: "extras.planType", prompt: "Which plan types — health, motor, life, travel?" },
    { field: "geography", prompt: "Which market?" },
    { field: "attributes", prompt: "Which fields — premiums, sum insured, claim ratios, riders?" },
    { field: "sources", prompt: "Insurer sites, aggregators, or both?" },
    { field: "frequency", prompt: "How often should plans refresh?" },
  ],
  automotive: [
    { field: "entityType", prompt: "Is this dealer inventory, on-road pricing, or rentals?" },
    { field: "geography", prompt: "Which market?" },
    { field: "attributes", prompt: "Which fields — VIN, price, dealer contacts, fleet availability?" },
    { field: "sources", prompt: "OEM sites, classifieds, or rental operators?" },
    { field: "frequency", prompt: "What refresh cadence?" },
  ],
  contacts: [
    { field: "industry", prompt: "Any industry filter for the contacts?" },
    { field: "geography", prompt: "Which geography?" },
    { field: "attributes", prompt: "Which people fields — name, title, email, phone, LinkedIn?" },
    { field: "frequency", prompt: "One-time or recurring, and how often?" },
  ],
  news: [
    { field: "entityType", prompt: "Which entities or topics should be monitored?" },
    { field: "geography", prompt: "Any market filter?" },
    { field: "attributes", prompt: "Which signals — headlines, M&A, leadership, hiring, sentiment?" },
    { field: "frequency", prompt: "How frequently should the feed refresh?" },
  ],
  reviews: [
    { field: "sources", prompt: "Which review platforms?" },
    { field: "entityType", prompt: "What is the business or product scope?" },
    { field: "geography", prompt: "Which geography?" },
    { field: "frequency", prompt: "What refresh cadence?" },
  ],
  location: [
    { field: "entityType", prompt: "Which brands or location types?" },
    { field: "geography", prompt: "Which markets?" },
    { field: "attributes", prompt: "Which fields — NAP, hours, geo, ratings?" },
    { field: "frequency", prompt: "How often should locations refresh?" },
  ],
  real_estate: [
    { field: "geography", prompt: "Which market?" },
    { field: "attributes", prompt: "Which listing fields — price, beds/baths, agent, photos, history?" },
    { field: "sources", prompt: "Any preferred portals?" },
    { field: "frequency", prompt: "What refresh cadence?" },
  ],
  generic: [
    { field: "entityType", prompt: "What entity or data type are you trying to collect?" },
    { field: "geography", prompt: "Which geography or market?" },
    { field: "sources", prompt: "Do you have source websites, or should Freda suggest catalog sources?" },
    { field: "attributes", prompt: "Which output fields are required?" },
    { field: "frequency", prompt: "Is this one-time or recurring, and how often should it refresh?" },
  ],
};

function filled(req: Requirement, field: string): boolean {
  if (field === "geography") return Boolean(req.geography || req.country || req.city);
  if (field === "attributes") return req.attributes.length > 0;
  if (field === "sources") return req.sources.length > 0 || req.sourceUrls.length > 0;
  if (field === "frequency") return Boolean(req.frequency || req.recurring);
  if (field === "entityType") return Boolean(req.entityType);
  if (field === "industry") return Boolean(req.industry);
  if (field === "productCategory") return Boolean(req.productCategory || req.extras.productCategory);
  if (field.startsWith("extras.")) {
    const key = field.slice("extras.".length);
    return Boolean(req.extras[key]);
  }
  return Boolean((req as unknown as Record<string, unknown>)[field]);
}

export function nextQuestions(
  family: IntentFamily,
  req: Requirement,
  asked: string[],
  limit = 1,
): Question[] {
  const bank = BANKS[family] ?? BANKS.generic;
  const pending = bank.filter((question) => !filled(req, question.field) && !asked.includes(question.field));
  return pending.slice(0, limit);
}

export function isRequirementComplete(family: IntentFamily, req: Requirement): boolean {
  const hasEntity = Boolean(req.entityType || req.objective);
  const hasGeo = Boolean(req.geography || req.country) || family === "news" || family === "contacts";
  const hasRefresh = Boolean(req.frequency || req.recurring);
  const hasSourceOrDefer = req.sources.length > 0 || req.sourceUrls.length > 0 || req.extras.sourcesDeferred === "true";
  return hasEntity && hasGeo && hasRefresh && hasSourceOrDefer;
}

export function applyAnswer(req: Requirement, field: string, text: string): Requirement {
  const next = {
    ...req,
    sources: [...req.sources],
    sourceUrls: [...req.sourceUrls],
    attributes: [...req.attributes],
    extras: { ...req.extras },
  };
  const trimmed = text.trim();
  if (field === "geography") {
    next.geography = trimmed;
  } else if (field === "entityType") {
    next.entityType = trimmed;
  } else if (field === "industry") {
    next.industry = trimmed;
  } else if (field === "attributes") {
    const parts = trimmed.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
    if (parts.some((part) => /^all available fields$/i.test(part)) || /^all available fields$/i.test(trimmed)) {
      next.attributes = ["All available fields"];
    } else {
      next.attributes = parts.length ? parts : next.attributes;
    }
  } else if (field === "sources") {
    if (/suggest|catalog|you (choose|pick|recommend)/i.test(trimmed)) {
      next.extras.sourcesDeferred = "true";
    } else {
      for (const part of trimmed.split(/[,;]/).map((item) => item.trim()).filter(Boolean)) {
        if (!next.sources.includes(part)) next.sources.push(part);
      }
    }
  } else if (field === "frequency") {
    next.frequency = trimmed;
    if (/one[-\s]?time/i.test(trimmed)) next.recurring = "one-time";
    else next.recurring = "recurring";
  } else if (field === "productCategory") {
    next.productCategory = trimmed;
  } else if (field.startsWith("extras.")) {
    next.extras[field.slice("extras.".length)] = trimmed;
  }
  return next;
}
