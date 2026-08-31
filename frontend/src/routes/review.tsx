import { useState, useMemo, useEffect, useRef, useDeferredValue } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, Input } from "@/components/ui-bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X, ExternalLink, Edit3, Save, Eye, Info, Zap, CheckCheck, XCircle, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { jobsCacheUpdatedEventName, readJobsCache, writeJobsCache } from "@/lib/jobs-cache";
import { buildReviewSummary } from "@/lib/review-summary";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Review Queue - FreshData AI" }] }),
  component: Review,
});

type ChangeType = "A" | "D" | "M" | "V" | "N";
type ReviewSort = "latest" | "oldest" | "confidence-high" | "confidence-low";

// Cycle a subtle palette per record group so the 10 attributes of one record visually cluster
const RECORD_GROUP_PALETTE = [
  "bg-info-bg/40",
  "bg-purple-bg/40",
  "bg-warning-bg/30",
  "bg-success-bg/30",
  "bg-secondary/60",
];

function recordGroupBg(record: string) {
  let h = 0;
  for (let i = 0; i < record.length; i++) h = (h * 31 + record.charCodeAt(i)) >>> 0;
  return RECORD_GROUP_PALETTE[h % RECORD_GROUP_PALETTE.length];
}

type JobMode = "By Dataset" | "By Source";

type CoverageAttributeRow = {
  attribute_key: string;
  attribute_label: string;
  non_null_values: number;
  total_records_in_scope: number;
  attr_coverage?: number | null;
};

type CoverageSourceFieldRow = {
  attribute_key: string;
  filled_records: number;
};

type CoverageSourceRow = {
  source_key: string;
  source_label: string;
  records_requested_from_source: number;
  records_returned_by_source: number;
  source_coverage?: number | null;
  filled_attributes: number;
  filled_fields: CoverageSourceFieldRow[];
};

type CoverageRecordRow = {
  record_index: number;
  record_label: string;
  filled_attributes: number;
  expected_attributes: number;
  record_coverage?: number | null;
  filled_fields: string[];
  missing_fields: string[];
};

type ReviewCoverage = {
  job_coverage?: number | null;
  source_coverage?: number | null;
  record_coverage?: number | null;
  records_in_scope?: number | null;
  expected_attributes?: number | null;
  total_filled_cells?: number | null;
  source_requested?: number | null;
  source_returned?: number | null;
  attribute_breakdown?: CoverageAttributeRow[];
  record_breakdown?: CoverageRecordRow[];
  source_breakdown?: CoverageSourceRow[];
  source_kind?: string | null;
};

type ReviewQueueMetrics = {
  pending: number;
  pending_urgent: number;
  approved_today: number;
  approved_today_manual: number;
  approved_today_auto: number;
  rejected_today: number;
  avg_confidence: number;
};

const REVIEW_SAMPLE_CACHE = new Map<string, { rows: any[]; totalSampled: number; sampledCount: number; coverage?: ReviewCoverage | null }>();

type JobRow = {
  id: string;
  source: string;
  domain?: string;
  kind?: string;
  schedule?: string;
  rows: number;
  changedPct?: number; // % changed vs last refresh
  lowConfPct?: number; // % low confidence in this job
  changesText?: string;
  statusText: string;
  reviewStatus: string;
  isDatasetJob: boolean;
  isDbJob?: boolean;
  filters?: string;
  refreshCount?: number;
  mode: JobMode;
  nextRefresh?: string;
  coverage?: ReviewCoverage | null;
  isUrgent?: boolean;
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  legal_name: "Legal Name",
  website: "Website",
  phone: "Phone",
  email: "Email",
  linkedin_url: "LinkedIn URL",
  hq_address: "HQ Address",
  description: "Description",
  employee_count: "Employee Count",
  industry: "Industry",
  registry_number: "Registry Number",
};

// Help helper functions for formatting names
function cleanSourceName(name: string) {
  if (!name) return "";
  let clean = name.trim();
  
  const dashIdxs = [" — ", " - "];
  for (const dash of dashIdxs) {
    const idx = clean.indexOf(dash);
    if (idx !== -1) {
      clean = clean.substring(0, idx).trim();
    }
  }

  if (/^https?:\/\//i.test(clean)) {
    try {
      const url = new URL(clean);
      return url.hostname.replace(/^www\./i, "");
    } catch (e) {
      // Ignore
    }
  }
  clean = clean.replace(/^https?:\/\/(www\.)?/i, "");
  clean = clean.replace(/^www\./i, "");
  const slashIdx = clean.indexOf("/");
  if (slashIdx !== -1) {
    clean = clean.substring(0, slashIdx);
  }
  return clean;
}

const FRIENDLY_NAME_MAP: Record<string, string> = {
  "webmd": "WebMD",
  "instagram": "Instagram",
  "99acres": "99Acres",
  "keysight": "Keysight",
  "turkeybrokers": "TurkeyBrokers",
  "linkedin": "LinkedIn",
  "github": "GitHub",
  "companieshouse": "Companies House (UK)",
  "mca": "MCA (India)",
  "crunchbase": "Crunchbase",
  "secedgar": "SEC EDGAR",
  "napdiscovery": "NAP Discovery",
};

function getSourceDisplayName(source: string) {
  if (!source) return "";
  let clean = cleanSourceName(source);
  
  const dotIdx = clean.indexOf(".");
  let baseName = dotIdx !== -1 ? clean.substring(0, dotIdx) : clean;
  
  const lowerBase = baseName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (FRIENDLY_NAME_MAP[lowerBase]) {
    return FRIENDLY_NAME_MAP[lowerBase];
  }
  return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}

function isValidWebsite(str: string): boolean {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  if (s.startsWith("http://") || s.startsWith("https://")) {
    return true;
  }
  if (s.includes(".") && !s.includes(" ") && !s.includes("@")) {
    const parts = s.split(".");
    const tld = parts[parts.length - 1];
    if (tld && ["com", "co", "io", "net", "org", "in", "us", "uk", "edu", "xyz", "gov"].includes(tld)) {
      return true;
    }
  }
  return false;
}

function findCompanyWebsite(originalRec: any, rec: any): string {
  const keysToTry = ["website", "url", "domain", "website_url", "corp_site", "websiteUrl"];
  
  if (rec) {
    for (const k of keysToTry) {
      if (typeof rec[k] === "string" && isValidWebsite(rec[k])) {
        return rec[k];
      }
    }
  }
  if (originalRec) {
    for (const k of keysToTry) {
      if (typeof originalRec[k] === "string" && isValidWebsite(originalRec[k])) {
        return originalRec[k];
      }
    }
  }

  const valMatches = (obj: any) => {
    if (!obj) return null;
    for (const val of Object.values(obj)) {
      if (typeof val === "string" && isValidWebsite(val)) {
        return val;
      }
    }
    return null;
  };

  const recMatch = valMatches(rec);
  if (recMatch) return recMatch;

  const origMatch = valMatches(originalRec);
  if (origMatch) return origMatch;

  return "";
}

function cleanDomain(urlStr: string): string {
  if (!urlStr) return "example.com";
  let clean = urlStr.trim().toLowerCase();
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    clean = "https://" + clean;
  }
  try {
    const url = new URL(clean);
    return url.hostname.replace(/^www\./i, "");
  } catch (e) {
    let temp = urlStr.replace(/^https?:\/\/(www\.)?/i, "");
    const slashIdx = temp.indexOf("/");
    if (slashIdx !== -1) {
      temp = temp.substring(0, slashIdx);
    }
    return temp;
  }
}

type ConfidenceEvidence = {
  score: number;
  identity_confidence: number;
  attribute_validation: number;
  data_completeness: number;
  freshness: number | null;
  confidence_adjustments: {
    base_confidence: number;
    identity_adjustment: number;
    validation_adjustment: number;
    completeness_adjustment: number;
    freshness_adjustment: number;
    source_bonus: number;
  };
};

function normalizeConfidenceText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function isBlankConfidenceValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  const text = normalizeConfidenceText(value).toLowerCase();
  return ["", "-", "—", "–", "n/a", "na", "none", "null", "unknown", "tbd", "pending", "not available"].includes(text);
}

function normalizeCompanyKey(value: unknown): string {
  return normalizeConfidenceText(value)
    .toLowerCase()
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|sarl)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function textSimilarity(left: string, right: string): number {
  const a = normalizeCompanyKey(left);
  const b = normalizeCompanyKey(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 92;
  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  const overlap = [...tokensA].filter((token) => tokensB.has(token)).length;
  const total = Math.max(tokensA.size, tokensB.size);
  if (!total) return 0;
  return (overlap / total) * 100;
}

function extractEmailDomain(value: unknown): string {
  const text = normalizeConfidenceText(value).toLowerCase();
  if (!text.includes("@")) return "";
  return text.split("@").pop()?.trim().replace(/\.+$/, "") || "";
}

function extractDomainToken(value: unknown): string {
  const domain = cleanDomain(normalizeConfidenceText(value));
  if (!domain || domain === "example.com") return "";
  return domain.split(".")[0].replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const text = normalizeConfidenceText(value);
  if (!text) return null;
  const d = new Date(text.replace("Z", "+00:00"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function reviewRowTimestamp(row: any): number {
  const record = row?.record && typeof row.record === "object" ? row.record : {};
  for (const key of ["scraped_at", "updated_at", "timestamp", "created_at", "fetched_at", "retrieved_at", "published_at", "last_updated"]) {
    const parsed = parseTimestamp(row?.[key] ?? record[key]);
    if (parsed) return parsed.getTime();
  }
  return 0;
}

function buildConfidenceEvidence(
  attr: string,
  value: unknown,
  record: Record<string, unknown> | null | undefined,
  sourceUrl: string,
  recordIndex: number,
): ConfidenceEvidence {
  const isBlank = isBlankConfidenceValue(value);
  const recordCopy = { ...(record || {}) };
  const recordAny = recordCopy as Record<string, any>;
  Object.keys(recordCopy).forEach((key) => {
    if (key.toLowerCase().replace(/[\s-]+/g, "_") === attr.toLowerCase().replace(/[\s-]+/g, "_")) {
      delete recordCopy[key];
    }
  });

  const contextCompany = normalizeCompanyKey(
    recordAny.company_name || recordAny.legal_name || recordAny.company || recordAny.name || recordAny.organization || "",
  );
  const contextWebsite = cleanDomain(findCompanyWebsite(recordCopy, recordCopy));
  const sourceDomain = cleanDomain(sourceUrl || contextWebsite || "");
  const valueText = normalizeConfidenceText(value);
  const valueDomain = cleanDomain(valueText);
  const sourceIsOfficial = sourceUrl ? /(?:^https?:\/\/|company|official)/i.test(sourceUrl) : false;

  let identity = isBlank ? 18 : 55;
  let validation = 0;
  let completeness = 0;

  const companyAlignment = (() => {
    if (!contextCompany) return 0;
    if (["website", "website_url", "domain", "url"].includes(attr)) {
      return textSimilarity(contextCompany, extractDomainToken(valueText));
    }
    if (["email", "email_address", "contact_email"].includes(attr)) {
      return textSimilarity(contextCompany, extractDomainToken(extractEmailDomain(valueText)));
    }
    if (["company_name", "legal_name", "name", "organization"].includes(attr)) {
      return textSimilarity(contextCompany, valueText);
    }
    if (["phone", "contact_phone", "phone_number", "telephone", "mobile"].includes(attr)) {
      return 60;
    }
    if (["hq_address", "address", "street", "hq_city", "hq_state", "hq_country", "country"].includes(attr)) {
      return 50;
    }
    return 35;
  })();

  const sourceAlignment = (() => {
    if (!sourceDomain) return 0;
    if (["website", "website_url", "domain", "url"].includes(attr)) {
      return valueDomain && valueDomain === sourceDomain ? 100 : 45;
    }
    if (["email", "email_address", "contact_email"].includes(attr)) {
      const emailDomain = extractEmailDomain(valueText);
      if (!emailDomain) return 0;
      if (emailDomain === sourceDomain || emailDomain.endsWith(sourceDomain) || sourceDomain.endsWith(emailDomain)) return 90;
      return 30;
    }
    if (["company_name", "legal_name", "name", "organization"].includes(attr)) {
      const valueToken = extractDomainToken(valueText);
      const sourceToken = extractDomainToken(sourceDomain);
      return valueToken && sourceToken && sourceToken.includes(valueToken) ? 75 : 30;
    }
    return sourceIsOfficial ? 55 : 25;
  })();

  const domainAlignment = (() => {
    if (["website", "website_url", "domain", "url"].includes(attr)) {
      if (valueDomain && sourceDomain && valueDomain === sourceDomain) return 100;
      return valueDomain ? textSimilarity(extractDomainToken(valueText), extractDomainToken(sourceDomain)) : 0;
    }
    if (["email", "email_address", "contact_email"].includes(attr)) {
      return textSimilarity(extractDomainToken(extractEmailDomain(valueText)), extractDomainToken(sourceDomain));
    }
    if (["company_name", "legal_name", "name", "organization"].includes(attr)) {
      return textSimilarity(extractDomainToken(valueText), extractDomainToken(sourceDomain));
    }
    return valueText ? 25 : 0;
  })();

  identity = Math.max(
    identity,
    (companyAlignment * 0.45) + (domainAlignment * 0.25) + (sourceAlignment * 0.30) + (sourceIsOfficial ? 5 : 0),
  );

  const attrKey = attr.toLowerCase().replace(/[\s-]+/g, "_");
  if (isBlank) {
    validation = 0;
  } else if (["website", "website_url", "url", "domain"].includes(attrKey)) {
    validation = /^(https?:\/\/)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(valueText) ? 94 : 32;
  } else if (["email", "email_address", "contact_email"].includes(attrKey)) {
    validation = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(valueText) ? 90 : 18;
  } else if (["phone", "contact_phone", "phone_number", "telephone", "mobile"].includes(attrKey)) {
    const digits = valueText.replace(/\D+/g, "");
    validation = digits.length >= 7 && digits.length <= 15 ? 90 : digits.length >= 5 ? 56 : 12;
  } else if (["year_founded", "founded", "foundation_year"].includes(attrKey)) {
    const year = Number.parseInt(valueText.replace(/\D+/g, ""), 10);
    const currentYear = new Date().getUTCFullYear();
    validation = Number.isFinite(year) && year >= 1800 && year <= currentYear ? 90 : 20;
  } else if (["revenue", "annual_revenue", "revenue_range", "employees", "employee_count", "employee_range"].includes(attrKey)) {
    validation = /\d/.test(valueText) ? 88 : 34;
  } else if (["lei"].includes(attrKey)) {
    validation = /^[0-9A-Z]{20}$/i.test(valueText.replace(/\s+/g, "")) ? 96 : 25;
  } else if (["registry_number", "company_number", "cik", "sic_code", "naics_code", "ticker"].includes(attrKey)) {
    validation = valueText.replace(/\W+/g, "").length >= 3 ? 82 : 28;
  } else if (["postal_code", "zip", "zipcode", "postal"].includes(attrKey)) {
    validation = /^[A-Za-z0-9\-\s]{3,10}$/.test(valueText) ? 84 : 26;
  } else {
    validation = valueText.length <= 2 ? 38 : valueText.length <= 5 ? 58 : valueText.length <= 80 ? 84 : valueText.length <= 140 ? 68 : 48;
  }

  if (isBlank) {
    completeness = 0;
  } else {
    completeness = valueText.length <= 2 ? 35 : valueText.length <= 5 ? 60 : valueText.length <= 80 ? 95 : valueText.length <= 140 ? 78 : 56;
    if (/(?:\.\.\.|…)/.test(valueText)) completeness -= 18;
    if (/(?:n\/a|unknown|pending|not available|todo)/i.test(valueText)) completeness -= 25;
    if (/[-/,]$/.test(valueText)) completeness -= 8;
    if ((valueText.match(/\s+/g) || []).length > 20) completeness -= 6;
    completeness = Math.max(0, Math.min(100, completeness));
  }

  let freshness: number | null = null;
  for (const key of ["scraped_at", "updated_at", "timestamp", "created_at", "fetched_at", "retrieved_at", "published_at", "last_updated"]) {
    const parsed = parseTimestamp(recordCopy[key]);
    if (!parsed) continue;
    const ageDays = Math.max(0, (Date.now() - parsed.getTime()) / 86400000);
    freshness = ageDays <= 7 ? 100 : ageDays <= 30 ? 93 : ageDays <= 90 ? 82 : ageDays <= 180 ? 70 : ageDays <= 365 ? 58 : ageDays <= 730 ? 42 : 26;
    break;
  }

  const normalizedValue = normalizeConfidenceText(value).toLowerCase();
  const isMissingValue = normalizedValue === "" || normalizedValue === "-" || normalizedValue === "—" || normalizedValue === "–";
  const isPlaceholderValue = ["n/a", "na", "none", "null", "unknown", "tbd", "pending", "not available"].includes(normalizedValue);

  const identityAdjustment = isMissingValue || isPlaceholderValue ? 0 : identity >= 60 ? 15 : identity >= 50 ? 10 : identity >= 35 ? 5 : 0;
  const validationAdjustment = isMissingValue || isPlaceholderValue ? 0 : validation >= 90 ? 8 : validation >= 70 ? 4 : validation < 40 ? -15 : 0;
  const completenessAdjustment = isPlaceholderValue ? -15 : isMissingValue ? -10 : completeness >= 85 ? 5 : completeness >= 50 ? 0 : -10;
  const freshnessAdjustment = freshness === null ? 0 : freshness >= 90 ? 2 : freshness <= 40 ? -3 : 0;

  let sourceBonus = 0;
  if (valueText) {
    const compareFields = ["website", "url", "domain", "website_url", "linkedin_url", "contact_email", "email", "phone"];
    let trustedMatches = 0;
    compareFields.forEach((field) => {
      if (field === attr.toLowerCase().replace(/[\s-]+/g, "_")) return;
      const candidate = recordAny[field];
      if (isBlankConfidenceValue(candidate)) return;
      const candidateText = normalizeConfidenceText(candidate).toLowerCase();
      if (!candidateText) return;
      if (candidateText === valueText.toLowerCase()) trustedMatches += 1;
    });
    if (sourceUrl && valueText.toLowerCase() && sourceUrl.toLowerCase().includes(valueText.toLowerCase())) {
      trustedMatches += 1;
    }
    sourceBonus = trustedMatches >= 2 ? 3 : trustedMatches === 1 ? 1.5 : 0;
  }

  const score = Math.max(20, Math.min(99, Number((70 + identityAdjustment + validationAdjustment + completenessAdjustment + freshnessAdjustment + sourceBonus).toFixed(1))));
  return {
    score,
    identity_confidence: Number(identity.toFixed(1)),
    attribute_validation: Number(validation.toFixed(1)),
    data_completeness: Number(completeness.toFixed(1)),
    freshness: freshness === null ? null : Number(freshness.toFixed(1)),
    confidence_adjustments: {
      base_confidence: 70,
      identity_adjustment: identityAdjustment,
      validation_adjustment: validationAdjustment,
      completeness_adjustment: completenessAdjustment,
      freshness_adjustment: freshnessAdjustment,
      source_bonus: sourceBonus,
    },
  };
}

function getDeterministicConfidence(
  attr: string,
  prevVal: string,
  newVal: string,
  recordIndex: number,
  record?: Record<string, unknown>,
  sourceUrl?: string,
): number {
  const evidence = buildConfidenceEvidence(attr, newVal, record, sourceUrl || "", recordIndex);
  return evidence.score / 100;
}

// Generate a deterministic sample set for a job (fallback)
function generateSample(job: JobRow, sampleRate: number) {
  const count = Math.round((job.rows * sampleRate) / 100);
  const cap = Math.min(count, 500); // render up to 500 rows for perf
  const attrsByJob: Record<string, string[]> = {
    "J-2841": ["Revenue (FY24)", "Net Income", "Total Assets", "CEO", "Filing Date"],
    "J-2840": ["Registry Number", "Status", "Incorporation Date", "Registered Address", "Directors"],
    "J-2839": ["Product Name", "SKU", "Price", "Category", "Availability"],
    "J-2838": ["Business Name", "Address", "Phone", "Hours", "Category"],
    "J-2837": ["Director Name", "DIN", "Appointment Date", "Company CIN", "Designation"],
    "J-2836": ["Round Type", "Amount Raised", "Lead Investor", "Announced At", "Valuation"],
    "J-2834": ["VIN", "Model", "Price", "Mileage", "Stock Status"],
    "J-2833": ["ASIN", "Title", "Price (GBP)", "Rating", "Rank"],
  };
  const attrs = attrsByJob[job.id] || ["Field A", "Field B", "Field C"];
  const recordPrefix = job.source.split(" ")[0];
  const types: ChangeType[] = ["A", "D", "M", "V"];
  const rows = Array.from({ length: cap }).map((_, i) => {
    const seed = (i * 9301 + 49297) % 233280;
    const r = seed / 233280;
    const attr = attrs[i % attrs.length];
    let changeType: ChangeType;
    const pctSlot = (i * 37) % 100;
    const changedPct = job.changedPct ?? 15;
    if (pctSlot < changedPct * 0.15) changeType = "A";
    else if (pctSlot < changedPct * 0.30) changeType = "D";
    else if (pctSlot < changedPct) changeType = "M";
    else changeType = "V";
    const prev = `${attr.split(" ")[0].toLowerCase()}-${1000 + ((i * 13) % 9000)}`;
    const next = changeType === "V" ? prev : changeType === "D" ? "—" : `${attr.split(" ")[0].toLowerCase()}-${1000 + ((i * 17 + 3) % 9000)}`;
    const conf = getDeterministicConfidence(attr, prev, next, i, { sourceUrl: `https://${job.source.toLowerCase().replace(/[^a-z]/g, "")}.example.com` }, `https://${job.source.toLowerCase().replace(/[^a-z]/g, "")}.example.com`);
    return {
      id: `${job.id}-${i}`,
      record: `${recordPrefix} ${String(10000 + i).slice(-5)}`,
      attribute: attr,
      attributeKey: attr.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      recordIndex: i,
      previous: prev,
      value: next,
      changeType,
      changed: changeType !== "V",
      conf: Math.min(0.99, conf),
      sourceUrl: `https://${job.source.toLowerCase().replace(/[^a-z]/g, "")}.example.com/r/${i}`,
      source: job.source,
    };
  });
  return { rows, totalSampled: count, sampledCount: count };
}

function cleanValue(val: any): string {
  if (val === null || val === undefined) return "";
  const s = String(val).trim();
  if (s === "" || s === "-" || s === "—") return "";
  return s;
}

function cleanReviewValue(val: any): string {
  if (val === null || val === undefined) return "";
  const s = String(val).trim();
  if (["", "-", "null", "n/a", "na", "none", "nan", "unknown"].includes(s.toLowerCase())) return "";
  return s;
}

function determineADMV(prev: any, newVal: any): ChangeType {
  const p = cleanReviewValue(prev);
  const n = cleanReviewValue(newVal);

  if (p === "" && n === "") {
    return "V";
  }
  if (p === "" && n !== "") {
    return "A";
  }
  if (p !== "" && n === "") {
    return "D";
  }
  if (p.toLowerCase() === n.toLowerCase()) {
    return "V";
  }
  return "M";
}

function bucket(c: number): "high" | "medium" | "low" {
  if (c >= 0.9) return "high";
  if (c >= 0.75) return "medium";
  return "low";
}
function bucketTone(b: "high" | "medium" | "low") {
  return b === "high" ? "success" : b === "medium" ? "warning" : "destructive";
}
function changeTone(c: ChangeType) {
  return c === "A" ? "success" : c === "D" ? "destructive" : c === "M" ? "warning" : c === "N" ? "purple" : "info";
}

function QualityCell({ score }: { score?: { approved: number; rejected: number } }) {
  if (!score || score.approved + score.rejected === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const total = score.approved + score.rejected;
  const pct = Math.round((score.approved / total) * 100);
  const tone = pct >= 80 ? "success" : (pct >= 50 ? "warning" : "destructive");
  return (
    <div className="inline-flex flex-col items-center">
      <Badge tone={tone}>
        <div className="text-center font-bold px-1.5 py-0.5 leading-tight text-[12.5px]">
          <div>{pct}%</div>
          <div className="text-[9px] font-normal lowercase leading-none mt-0.5">quality</div>
        </div>
      </Badge>
      <span className="text-[11px] text-muted-foreground mt-1 whitespace-nowrap font-semibold">
        {score.approved}✓ · {score.rejected}• of {total}
      </span>
    </div>
  );
}

function formatCoveragePct(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function coverageTone(value?: number | null): "success" | "warning" | "destructive" | "info" {
  if (value === null || value === undefined || Number.isNaN(value)) return "info";
  if (value >= 0.9) return "success";
  if (value >= 0.75) return "info";
  if (value >= 0.55) return "warning";
  return "destructive";
}

function CoverageStat({
  label,
  value,
  detail,
}: {
  label: string;
  value?: number | null;
  detail?: string;
}) {
  const tone = coverageTone(value);
  return (
    <Card className="p-3 border-border/80 bg-secondary/20">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <Badge tone={tone}>
          <span className="text-[14px] font-bold leading-none">{formatCoveragePct(value)}</span>
        </Badge>
        {detail ? <span className="text-[10.5px] text-muted-foreground text-right">{detail}</span> : null}
      </div>
    </Card>
  );
}

function Chip({ on, onClick, children, tone }: { on?: boolean; onClick: () => void; children: React.ReactNode; tone?: "success" | "warning" | "destructive" | "info" }) {
  const toneCls = on
    ? tone === "success" ? "bg-success-bg text-success border-success/40"
    : tone === "warning" ? "bg-warning-bg text-warning border-warning/40"
    : tone === "destructive" ? "bg-destructive/15 text-destructive border-destructive/40"
    : tone === "info" ? "bg-[#e0f2fe] text-[#0369a1] border-[#0369a1]/30"
    : "bg-primary text-primary-foreground border-primary"
    : "bg-card border-border hover:bg-secondary";
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-md text-[12px] border ${toneCls}`}>
      {children}
    </button>
  );
}

function getAnySiteUploadedFilename(filters: string | null | undefined): string {
  if (!filters || filters === "—" || filters === "–" || filters === "−") return "";
  try {
    const parsed = JSON.parse(filters);
    if (parsed && typeof parsed === "object") {
      const candidates = ["seedFile", "seed_file", "filename", "fileName", "file_name", "inputFile", "input_file"];
      for (const key of candidates) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim().replace(/\.(csv|xlsx|xls|json|jsonl)$/i, "");
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  return "";
}

function countRowsInConfidenceRange(rows: Array<{ conf?: number | null }>, min: number, max: number): number {
  const averages = buildRecordAverageConfidenceMap(rows);
  let count = 0;
  averages.forEach((value) => {
    const confPct = Math.round(value * 100);
    if (confPct >= min && confPct <= max) {
      count += 1;
    }
  });
  return count;
}

function getConfidenceRangeCount(
  job: JobRow,
  limits: { min: number; max: number },
  sample: { rows: Array<{ conf?: number | null }> } | null,
  openJobId: string | null,
): number {
  if (openJobId === job.id && sample) {
    return countRowsInConfidenceRange(sample.rows, limits.min, limits.max);
  }

  // The job list does not carry row-level confidence values, so use the job total
  // until the sampled review grid is opened.
  return job.rows;
}

function groupRowsByDatasetRecord(rows: any[]) {
  const groups: Array<{ key: string; rows: any[] }> = [];
  const indexMap = new Map<string, { key: string; rows: any[] }>();

  rows.forEach((row, index) => {
    const key = String(
      typeof row?.recordIndex === "number"
        ? row.recordIndex
        : row?.record ?? row?.record_id ?? row?.id ?? index,
    );
    const existing = indexMap.get(key);
    if (existing) {
      existing.rows.push(row);
      return;
    }
    const nextGroup = { key, rows: [row] };
    indexMap.set(key, nextGroup);
    groups.push(nextGroup);
  });

  return groups;
}

function getReviewRecordKey(row: any, fallbackIndex: number): string {
  return String(
    typeof row?.recordIndex === "number"
      ? row.recordIndex
      : row?.record ?? row?.record_id ?? row?.id ?? fallbackIndex,
  );
}

function buildRecordAverageConfidenceMap(rows: Array<{ conf?: number | null }>): Map<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();
  rows.forEach((row, index) => {
    if (row.conf === null || row.conf === undefined || Number.isNaN(row.conf)) return;
    const key = getReviewRecordKey(row, index);
    if (!key) return;
    const current = totals.get(key) || { sum: 0, count: 0 };
    current.sum += Number(row.conf);
    current.count += 1;
    totals.set(key, current);
  });

  const averages = new Map<string, number>();
  totals.forEach((value, key) => {
    averages.set(key, value.count > 0 ? value.sum / value.count : 0);
  });
  return averages;
}

function formatNextRefreshDate(isoStr: string | null | undefined): string {
  if (!isoStr) return "Pending";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "Pending";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  } catch (e) {
    return "Pending";
  }
}

function Review() {
  const [modeFilter, setModeFilter] = useState<"All" | JobMode>("All");
  const [jobSort, setJobSort] = useState<"latest" | "oldest" | "id-asc" | "id-desc" | "status">("latest");
  const [jobRates, setJobRates] = useState<Record<string, number>>({});
  const [openJob, setOpenJob] = useState<JobRow | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [changeFilter, setChangeFilter] = useState<"all" | ChangeType>("all");
  const [reviewSort, setReviewSort] = useState<ReviewSort>("latest");
  const [confFilter, setConfFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [activeConfJobId, setActiveConfJobId] = useState<string | null>(null);
  const [confLimits, setConfLimits] = useState<Record<string, { min: number; max: number }>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, "approved" | "rejected" | "auto">>({});
  const [pageOffset, setPageOffset] = useState(0);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  
  const [policyOpen, setPolicyOpen] = useState(false);
  const [modalAutoApprove, setModalAutoApprove] = useState(false);
  const [showAvgConfidence, setShowAvgConfidence] = useState(false);
  const [viewInBulk, setViewInBulk] = useState(false);
  const [bulkSample, setBulkSample] = useState<{ rows: any[]; totalSampled: number; sampledCount: number; coverage?: ReviewCoverage | null } | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const [dbJobs, setDbJobs] = useState<any[]>(() => readJobsCache());
  const [sample, setSample] = useState<{ rows: any[]; totalSampled: number; sampledCount: number; coverage?: ReviewCoverage | null } | null>(null);
  const sampleCacheRef = useRef<Record<string, { rows: any[]; totalSampled: number; sampledCount: number; coverage?: ReviewCoverage | null }>>({});
  const [queueMetrics, setQueueMetrics] = useState<ReviewQueueMetrics>({
    pending: 0,
    pending_urgent: 0,
    approved_today: 0,
    approved_today_manual: 0,
    approved_today_auto: 0,
    rejected_today: 0,
    avg_confidence: 0,
  });

  const baseApiUrl = (() => {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port !== "8131"
    ) {
      return `http://${window.location.hostname}:8131`;
    }
    return "";
  })();

  const handleSave = async (row: any, newValue: string) => {
    try {
      const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs/edit_value`, {
        credentials: "include",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_id: openJob!.id,
          record_index: row.recordIndex,
          attribute: row.attributeKey,
          value: newValue,
        }),
      });

      if (response.ok) {
        const payload = await response.json().catch(() => ({} as any));
        const updatedCoverage = payload?.coverage ?? null;
        const updatedReviewSummary = payload?.review_summary ?? null;
        const normalizedValue = String(newValue ?? "").trim() === "" ? "—" : newValue;
        const nextChangeType = determineADMV(row.previous, normalizedValue);
        toast.success("Changes saved successfully");
        const syncCachedReviewRows = (cache: Record<string, { rows: any[]; coverage?: ReviewCoverage | null }>) => {
          Object.entries(cache).forEach(([key, cached]) => {
            if (!key.startsWith(`${openJob!.id}:`) || !cached?.rows?.length) return;
            cached.rows = cached.rows.map((rowItem: any) => {
              if (rowItem.id !== row.id) return rowItem;
              return {
                ...rowItem,
                value: normalizedValue,
                changed: nextChangeType !== "V",
                changeType: nextChangeType,
              };
            });
            if (updatedCoverage) {
              cached.coverage = updatedCoverage;
            }
          });
        };
        syncCachedReviewRows(sampleCacheRef.current);
        if (bulkSample?.rows?.length) {
          const nextBulk = {
            ...bulkSample,
            rows: bulkSample.rows.map((rowItem: any) => {
              if (rowItem.id !== row.id) return rowItem;
              return {
                ...rowItem,
                value: normalizedValue,
                changed: nextChangeType !== "V",
                changeType: nextChangeType,
              };
            }),
            coverage: updatedCoverage ?? bulkSample.coverage ?? null,
          };
          setBulkSample(nextBulk);
          const bulkKey = `${openJob!.id}:100:review_logic_v6:bulk`;
          sampleCacheRef.current[bulkKey] = nextBulk;
          REVIEW_SAMPLE_CACHE.set(bulkKey, nextBulk);
        }
        setSample((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            rows: prev.rows.map((rowItem) => {
              if (rowItem.id === row.id) {
                return {
                  ...rowItem,
                  value: normalizedValue,
                  changed: nextChangeType !== "V",
                  changeType: nextChangeType,
                };
              }
              return rowItem;
            }),
            coverage: updatedCoverage ?? prev.coverage ?? null,
          };
        });
        if (updatedCoverage || updatedReviewSummary) {
          setDbJobs((jobs) => {
            const nextJobs = jobs.map((job: any) =>
              String(job.id) === String(openJob!.id)
                ? {
                    ...job,
                    coverage: updatedCoverage,
                    review_summary: updatedReviewSummary ?? job.review_summary ?? null,
                    review_summary_updated_at:
                      updatedReviewSummary?.updatedAt || job.review_summary_updated_at || job.last_refresh || job.created_at,
                  }
                : job,
            );
            writeJobsCache(nextJobs);
            return nextJobs;
          });
          setOpenJob((job) =>
            job
              ? {
                  ...job,
                  coverage: updatedCoverage,
                  review_summary: updatedReviewSummary ?? job.review_summary ?? null,
                  review_summary_updated_at:
                    updatedReviewSummary?.updatedAt || job.review_summary_updated_at || job.last_refresh || job.created_at,
                }
              : job,
          );
        }
        setEditing(({ [row.id]: _, ...rest }) => rest);
      } else {
        toast.error("Failed to save changes to backend");
      }
    } catch (err) {
      console.error("Failed to save edit:", err);
      toast.error("An error occurred while saving");
    }
  };

  const handleSaveReview = async () => {
    if (!openJob || !activeSample) return;

    const rowsToPersist = bulkSample?.rows?.length ? bulkSample.rows : visibleRows;

    try {
      const decisions = rowsToPersist.map((r: any) => {
        const key = `${openJob.id}-${r.id}`;
        const status = rowStatus[key];
        const action = status === "rejected" ? "rejected" : "accepted";

        return {
          record_index: r.recordIndex,
          attribute: r.attributeKey,
          previous_value: r.previous,
          enriched_value: r.value,
          admv_status: r.changeType,
          reviewer_action: action,
        };
      });

      const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs/submit_review`, {
        credentials: "include",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_id: openJob.id,
          decisions: decisions,
        }),
      });

      if (response.ok) {
        const summary = buildReviewSummary(rowsToPersist, rowStatus, openJob.coverage || activeSample.coverage || null);
        const rowsAllApproved = rowsToPersist.length > 0 && rowsToPersist.every((r: any) => {
          const key = `${openJob.id}-${r.id}`;
          const status = rowStatus[key];
          return status === "approved" || status === "auto";
        });
        const rowsAllRejected = rowsToPersist.length > 0 && rowsToPersist.every((r: any) => {
          const key = `${openJob.id}-${r.id}`;
          return rowStatus[key] === "rejected";
        });
        const fullReviewedCount = bulkSample?.totalSampled ?? rowsToPersist.length;
        if (rowsAllApproved || rowsAllRejected) {
          summary.overall.reviewed = fullReviewedCount;
          summary.overall.approved = rowsAllApproved ? fullReviewedCount : 0;
          summary.overall.rejected = rowsAllRejected ? fullReviewedCount : 0;
          summary.overall.accuracy = fullReviewedCount > 0 ? summary.overall.approved / fullReviewedCount : 0;
        }
        const persistedJobs = readJobsCache().map((job: any) => {
          if (String(job.id) !== String(openJob.id)) {
            return job;
          }
          return {
            ...job,
            approved_count: summary.overall.approved,
            rejected_count: summary.overall.rejected,
            review_summary: summary,
            review_summary_updated_at: summary.updatedAt,
          };
        });
        writeJobsCache(persistedJobs);
        setDbJobs(persistedJobs);
        setReviewed((s) => ({ ...s, [openJob.id]: true }));
        toast.success("Review saved and finalized successfully");
        setOpenJob(null);
      } else {
        toast.error("Failed to finalize review on the backend");
      }
    } catch (err) {
      console.error("Failed to submit review:", err);
      toast.error("An error occurred while finalizing review");
    }
  };

  async function deleteJobFromReview(jobId: string) {
    try {
      await fetch(`${baseApiUrl}/api/v1/demo/jobs/${jobId}`, { method: "DELETE", credentials: "include" });
    } catch (e) {
      // ignore
    }
    setDbJobs((jobs) => {
      const next = jobs.filter((j: any) => String(j.id) !== String(jobId));
      writeJobsCache(next);
      return next;
    });
    setOpenJob(null);
  }

  async function ensureFullReviewRows() {
    if (!openJob) return [] as any[];
    if (bulkSample?.rows?.length) return bulkSample.rows;

    const bulkRate = 100;
    const bulkKey = `${openJob.id}:${bulkRate}:review_logic_v6:bulk`;
    const cachedBulk = sampleCacheRef.current[bulkKey];
    if (cachedBulk) {
      setBulkSample(cachedBulk);
      return cachedBulk.rows || [];
    }
    const sharedCachedBulk = REVIEW_SAMPLE_CACHE.get(bulkKey);
    if (sharedCachedBulk) {
      sampleCacheRef.current[bulkKey] = sharedCachedBulk;
      setBulkSample(sharedCachedBulk);
      return sharedCachedBulk.rows || [];
    }

    setBulkLoading(true);
    try {
      const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs/review_data?job_id=${openJob.id}&sample_rate=${bulkRate}&sample_offset=0`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Failed to load full review data");
      const data = await response.json();
      sampleCacheRef.current[bulkKey] = data;
      REVIEW_SAMPLE_CACHE.set(bulkKey, data);
      setBulkSample(data);
      return data.rows || [];
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkApprove() {
    if (!openJob) return;
    const rows = await ensureFullReviewRows();
    if (!rows.length) return;
    let count = 0;
    setRowStatus((s) => {
      const next = { ...s };
      rows.forEach((r: any) => {
        const key = `${openJob.id}-${r.id}`;
        if (next[key] === "rejected") {
          return;
        }
        if (next[key] !== "approved" && next[key] !== "auto") count++;
        next[key] = "approved";
      });
      return next;
    });
    toast.success(`Approved ${count} row${count === 1 ? "" : "s"} (entire job)`);
  }

  async function bulkReject() {
    if (!openJob) return;
    const rows = await ensureFullReviewRows();
    if (!rows.length) return;
    let count = 0;
    setRowStatus((s) => {
      const next = { ...s };
      rows.forEach((r: any) => {
        const key = `${openJob.id}-${r.id}`;
        if (next[key] !== "rejected") count++;
        next[key] = "rejected";
      });
      return next;
    });
    toast.success(`Rejected ${count} row${count === 1 ? "" : "s"} (entire job)`);
  }

  // 1. Fetch jobs from database
  useEffect(() => {
    let active = true;
    async function fetchJobs() {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          if (active) {
            // Merge backend rows into the local cache so a freshly launched job
            // stays visible while the server list catches up.
            const mergedJobs = writeJobsCache([...readJobsCache(), ...data]);
            setDbJobs(mergedJobs);
          }
        }
      } catch (err) {
        console.error("Failed to fetch jobs in review queue:", err);
      }
    }
    fetchJobs();
    const interval = setInterval(fetchJobs, 4000);
    const handleCacheUpdate = () => {
      if (!active) return;
      setDbJobs(readJobsCache());
    };
    window.addEventListener(jobsCacheUpdatedEventName(), handleCacheUpdate as EventListener);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener(jobsCacheUpdatedEventName(), handleCacheUpdate as EventListener);
    };
  }, [baseApiUrl]);

  useEffect(() => {
    let active = true;
    async function fetchMetrics() {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/workflows/review-metrics`, { credentials: "include" });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({} as any));
        const metrics = payload?.metrics || payload;
        if (!active || !metrics) return;
        setQueueMetrics({
          pending: Number(metrics.pending ?? 0),
          pending_urgent: Number(metrics.pending_urgent ?? metrics.urgent ?? 0),
          approved_today: Number(metrics.approved_today ?? 0),
          approved_today_manual: Number(metrics.approved_today_manual ?? 0),
          approved_today_auto: Number(metrics.approved_today_auto ?? metrics.auto_today ?? 0),
          rejected_today: Number(metrics.rejected_today ?? 0),
          avg_confidence: Number(metrics.avg_confidence ?? metrics.avgConf ?? 0),
        });
      } catch (err) {
        console.error("Failed to fetch live review metrics:", err);
      }
    }

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [baseApiUrl]);

  // Combine database jobs with static mock jobs
  const datasetJobs = useMemo(() => {
    const dbDataset = dbJobs
      .filter((j: any) => (j.mode === "By Dataset" || j.mode === "Any-Site") && !j.isCustomSource && (j.status === "Review Pending" || j.status === "Completed" || j.status === "Running"))
      .map((j: any) => {
        const isCompleted = j.status === "Completed";
        const isRunning = j.status === "Running";
        const isRefreshing = isRunning && (j.refresh_count || 0) > 0;
        const totalRecords = Number(j.records || 0);
        const changedCount = Number(j.changes_detected || 0);
        const changedPct = totalRecords > 0 ? Math.round((changedCount / totalRecords) * 100) : 0;
        return {
          id: j.id,
          source: j.source,
          rows: totalRecords,
          changedPct: changedPct,
          lowConfPct: j.lowConfPct !== undefined && j.lowConfPct !== null ? j.lowConfPct : 2,
          statusText: isCompleted ? "Completed" : (isRefreshing ? "Refreshing" : (isRunning ? "Running" : "Extraction Completed")),
          reviewStatus: isCompleted ? "Completed" : (isRefreshing ? "Refreshing" : (isRunning ? "Running" : "Review pending")),
          isDatasetJob: true,
          isDbJob: true,
          filters: j.filters,
          refreshCount: j.refresh_count || 0,
          mode: "By Dataset" as JobMode,
          nextRefresh: j.next_refresh,
          approved_count: j.approved_count,
          rejected_count: j.rejected_count,
          coverage: j.coverage || null,
          isUrgent: Boolean(j.is_urgent ?? j.isUrgent),
        };
      });
    return dbDataset as JobRow[];
  }, [dbJobs]);

  const sourceJobs = useMemo(() => {
    const dbSource = dbJobs
      .filter((j: any) => (j.mode === "Site-Specific" || j.mode === "By Source") && (j.status === "Completed" || j.status === "Review Pending" || j.status === "Review" || j.status === "Running"))
      .map((j: any) => {
        const sourceDisplayName = getSourceDisplayName(j.source);
        const domain = cleanSourceName(j.source);
        const refreshCount = j.refresh_count || 0;
        const changesText = j.changes_detected !== undefined && j.changes_detected !== null
          ? (refreshCount > 0
             ? `${Math.round((j.changes_detected / (j.records || 1)) * 100)}% highlighted`
             : "100% new")
          : "—";
        const isCM = j.frequency !== "One-time";
        const isPartial = String(j.scope || "").toLowerCase().includes("partial");
        const kind = isCM ? "Change Monitoring" : (isPartial ? "Custom Scrape" : "Full Scrape");
        const changedPct = j.changes_detected !== undefined && j.changes_detected !== null
          ? Math.round((j.changes_detected / (j.records || 1)) * 100)
          : 15;
        const isCompleted = j.status === "Completed";
        return {
          id: j.id,
          source: sourceDisplayName,
          domain: domain,
          kind: kind,
          schedule: j.frequency || "Weekly",
          rows: j.records || 0,
          changesText: changesText,
          statusText: j.status === "Running" ? "Running" : (isCompleted ? "Completed" : "Extraction Completed"),
          reviewStatus: isCompleted ? "Completed" : "Review pending",
          isDatasetJob: false,
          isDbJob: true,
          filters: j.filters,
          refreshCount: refreshCount,
          mode: "By Source" as JobMode,
          changedPct: changedPct,
          lowConfPct: j.lowConfPct !== undefined && j.lowConfPct !== null ? j.lowConfPct : 2,
          nextRefresh: j.next_refresh,
          approved_count: j.approved_count,
          rejected_count: j.rejected_count,
          coverage: j.coverage || null,
          isUrgent: Boolean(j.is_urgent ?? j.isUrgent),
        };
      });
      
    return dbSource as JobRow[];
  }, [dbJobs]);

  const allJobs = useMemo(() => {
    return [...datasetJobs, ...sourceJobs];
  }, [datasetJobs, sourceJobs]);

  const filteredJobs = useMemo(
    () => allJobs.filter((j) => modeFilter === "All" || j.mode === modeFilter),
    [allJobs, modeFilter],
  );

  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      if (jobSort === "oldest") {
        return String(a.id).localeCompare(String(b.id));
      }
      if (jobSort === "id-asc") return String(a.id).localeCompare(String(b.id));
      if (jobSort === "id-desc") return String(b.id).localeCompare(String(a.id));
      if (jobSort === "status") return String(a.reviewStatus).localeCompare(String(b.reviewStatus));
      return String(b.id).localeCompare(String(a.id));
    });
  }, [filteredJobs, jobSort]);

  const getJobScore = (j: any) => {
    if (j.approved_count !== undefined && j.approved_count !== null) {
      return {
        approved: j.approved_count,
        rejected: j.rejected_count || 0
      };
    }
    const approved = Object.entries(rowStatus).filter(([key, val]) => key.startsWith(`${j.id}-`) && (val === "approved" || val === "auto")).length;
    const rejected = Object.entries(rowStatus).filter(([key, val]) => key.startsWith(`${j.id}-`) && val === "rejected").length;
    return { approved, rejected };
  };

  // Handle query parameter for auto-focusing/highlighting/selecting a job
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("jobId");
    if (!jobId || allJobs.length === 0) return;

    const matchingJob = allJobs.find((j) => j.id === jobId);
    if (matchingJob) {
      setSelectedJobId(jobId);
      if (matchingJob.isDatasetJob) {
        setModeFilter("By Dataset");
      } else {
        setModeFilter("By Source");
      }

      // Scroll/focus that row automatically
      setTimeout(() => {
        const rowEl = document.getElementById(`row-${jobId}`);
        if (rowEl) {
          rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
          rowEl.focus();
        }
      }, 300);

      // Clear the query parameter so it doesn't open again on page refresh/state updates
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [allJobs]);

  // 2. Load preview sample (either local generateSample or backend raw JSON)
  useEffect(() => {
    if (!openJob) {
      return;
    }

    const sampleRate = jobRates[openJob.id] ?? 2;
    const sampleKey = `${openJob.id}:${sampleRate}:review_logic_v6:${viewInBulk ? "bulk" : pageOffset}`;
    const cachedSample = sampleCacheRef.current[sampleKey];
    if (cachedSample) {
      setSample(cachedSample);
      return;
    }
    const sharedCachedSample = REVIEW_SAMPLE_CACHE.get(sampleKey);
    if (sharedCachedSample) {
      sampleCacheRef.current[sampleKey] = sharedCachedSample;
      setSample(sharedCachedSample);
      return;
    }
    setSample(null);

    if (!openJob.isDbJob) {
      const generated = generateSample(openJob, sampleRate);
      sampleCacheRef.current[sampleKey] = generated;
      setSample(generated);
      return;
    }

    const isDatasetJob = openJob.isDatasetJob;

    let active = true;
    if (isDatasetJob) {
      // Dataset job review flow: reuse the backend comparison rows so previous/current values stay aligned.
      const sampleOffset = viewInBulk ? 0 : pageOffset;
      fetch(`${baseApiUrl}/api/v1/demo/jobs/review_data?job_id=${openJob.id}&sample_rate=${sampleRate}&sample_offset=${sampleOffset}`, { credentials: "include", cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load review data");
          return res.json();
        })
        .then((data) => {
          if (!active) return;
          sampleCacheRef.current[sampleKey] = data;
          REVIEW_SAMPLE_CACHE.set(sampleKey, data);
          setSample(data);
        })
        .catch((err) => {
          console.error("Failed to load real dataset for review:", err);
          if (active) {
            setSample({ rows: [], totalSampled: 0, sampledCount: 0 });
          }
        });
    } else {
      // Site-specific (By Source) job review flow: call backend comparison review_data endpoint
      const sampleOffset = viewInBulk ? 0 : pageOffset;
      fetch(`${baseApiUrl}/api/v1/demo/jobs/review_data?job_id=${openJob.id}&sample_rate=${sampleRate}&sample_offset=${sampleOffset}`, { credentials: "include", cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load review data");
          return res.json();
        })
        .then((data) => {
          if (!active) return;
          sampleCacheRef.current[sampleKey] = data;
          REVIEW_SAMPLE_CACHE.set(sampleKey, data);
          setSample(data);
        })
        .catch((err) => {
          console.error("Failed to load site-specific dataset for review:", err);
          if (active) {
            setSample({ rows: [], totalSampled: 0, sampledCount: 0 });
          }
        });
    }

    return () => {
      active = false;
    };
  }, [openJob, jobRates, baseApiUrl, pageOffset, viewInBulk]);

  useEffect(() => {
    if (!openJob || !viewInBulk) {
      setBulkSample(null);
      setBulkLoading(false);
      return;
    }

    const bulkRate = 100;
    const bulkKey = `${openJob.id}:${bulkRate}:review_logic_v6:bulk`;
    const cachedBulk = sampleCacheRef.current[bulkKey];
    if (cachedBulk) {
      setBulkSample(cachedBulk);
      setBulkLoading(false);
      return;
    }
    const sharedCachedBulk = REVIEW_SAMPLE_CACHE.get(bulkKey);
    if (sharedCachedBulk) {
      sampleCacheRef.current[bulkKey] = sharedCachedBulk;
      setBulkSample(sharedCachedBulk);
      setBulkLoading(false);
      return;
    }

    let active = true;
    setBulkLoading(true);
    fetch(`${baseApiUrl}/api/v1/demo/jobs/review_data?job_id=${openJob.id}&sample_rate=${bulkRate}`, { credentials: "include", cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load bulk review data");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        sampleCacheRef.current[bulkKey] = data;
        REVIEW_SAMPLE_CACHE.set(bulkKey, data);
        setBulkSample(data);
      })
      .catch((err) => {
        console.error("Failed to load bulk dataset for review:", err);
        if (active) {
          setBulkSample({ rows: [], totalSampled: 0, sampledCount: 0 });
        }
      })
      .finally(() => {
        if (active) {
          setBulkLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [openJob, viewInBulk, baseApiUrl]);

  const activeSample = viewInBulk ? bulkSample : sample;

  const visibleRows = useMemo(() => {
    if (!activeSample) return [];
    const limits = openJob ? (confLimits[openJob.id] || { min: 0, max: 100 }) : { min: 0, max: 100 };
    const averageConfidenceByRecord = buildRecordAverageConfidenceMap(activeSample.rows);
    const allowedRecordKeys = new Set<string>();
    averageConfidenceByRecord.forEach((value, key) => {
      const confPct = Math.round(value * 100);
      if (confPct >= limits.min && confPct <= limits.max) {
        allowedRecordKeys.add(key);
      }
    });

    const filteredRows = activeSample.rows.filter((r) => {
      if (changeFilter !== "all" && r.changeType !== changeFilter) return false;
      const recordKey = getReviewRecordKey(r, 0);
      return allowedRecordKeys.has(recordKey);
    });
    return filteredRows.sort((a, b) => {
      if (reviewSort === "oldest") return reviewRowTimestamp(a) - reviewRowTimestamp(b);
      if (reviewSort === "confidence-high") return Number(b.conf ?? 0) - Number(a.conf ?? 0);
      if (reviewSort === "confidence-low") return Number(a.conf ?? 0) - Number(b.conf ?? 0);
      return reviewRowTimestamp(b) - reviewRowTimestamp(a);
    });
  }, [activeSample, changeFilter, openJob, confLimits, reviewSort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { A: 0, D: 0, M: 0, V: 0, N: 0, high: 0, medium: 0, low: 0 };
    activeSample?.rows.forEach((r) => {
      c[r.changeType]++;
      if (r.conf !== null && r.conf !== undefined && !isNaN(r.conf)) {
        c[bucket(r.conf)]++;
      }
    });
    return c;
  }, [activeSample]);

  const recordsPerPage = useMemo(() => {
    if (!openJob) return 10;
    const rate = jobRates[openJob.id] ?? 2;
    return Math.max(1, Math.round(((openJob.rows || 10) * rate) / 100));
  }, [openJob, jobRates, sample, viewInBulk]);

  const visibleRecordGroups = useMemo(() => groupRowsByDatasetRecord(visibleRows), [visibleRows]);

  const paginatedRows = useMemo(() => {
    if (viewInBulk) {
      return visibleRows;
    }
    return visibleRows;
  }, [visibleRows, viewInBulk]);

  const deferredVisibleRows = useDeferredValue(visibleRows);
  const deferredPaginatedRows = useDeferredValue(paginatedRows);
  const rowsForDisplay = viewInBulk ? visibleRows : deferredPaginatedRows;

  const startRow = useMemo(() => {
    if (viewInBulk) return visibleRows.length > 0 ? 1 : 0;
    return visibleRecordGroups.length > 0 ? pageOffset + 1 : 0;
  }, [viewInBulk, visibleRows, visibleRecordGroups, pageOffset]);

  const endRow = useMemo(() => {
    if (viewInBulk) return visibleRows.length;
    return visibleRecordGroups.length > 0 ? Math.min(pageOffset + visibleRecordGroups.length, sample?.totalSampled ?? visibleRecordGroups.length) : 0;
  }, [viewInBulk, visibleRows, visibleRecordGroups, pageOffset, sample]);

  const totalPages = useMemo(() => {
    if (viewInBulk) return 1;
    return Math.max(1, Math.ceil((sample?.totalSampled ?? visibleRecordGroups.length) / recordsPerPage));
  }, [viewInBulk, visibleRecordGroups, recordsPerPage, sample]);

  const currentPage = useMemo(() => {
    if (viewInBulk) return 1;
    return Math.floor(pageOffset / recordsPerPage) + 1;
  }, [viewInBulk, pageOffset, recordsPerPage]);

  const shownRows = paginatedRows.length;

  const recordAverageConfidence = useMemo(() => {
    return buildRecordAverageConfidenceMap(activeSample?.rows || []);
  }, [activeSample]);

  const visibleAvgConfidenceBadges = useMemo(() => {
    if (!showAvgConfidence) return [];
    const seen = new Set<string>();
    return rowsForDisplay.flatMap((r) => {
      const recordKey = String(r.recordIndex ?? r.record ?? r.id ?? "");
      if (!recordKey || seen.has(recordKey)) return [];
      seen.add(recordKey);
      const recordAvg = recordAverageConfidence.get(recordKey);
      if (recordAvg === undefined) return [];
      return [{
        id: recordKey,
        label: r.record,
        score: Math.round(recordAvg * 100),
        tone: bucketTone(bucket(recordAvg)) as "success" | "warning" | "destructive" | "info",
      }];
    });
  }, [showAvgConfidence, rowsForDisplay, recordAverageConfidence]);

  useEffect(() => {
    setPageOffset(0);
    setModalAutoApprove(false);
    setViewInBulk(false);
  }, [openJob, changeFilter, confFilter, confLimits]);

  useEffect(() => {
    if (modalAutoApprove && openJob && visibleRows.length > 0) {
      let count = 0;
      setRowStatus((s) => {
        const next = { ...s };
        let changed = false;
        visibleRows.forEach((r) => {
          const key = `${openJob.id}-${r.id}`;
          const isHighConf = r.conf !== null && r.conf !== undefined && !isNaN(r.conf) && r.conf >= 0.85;
          if (!next[key] && isHighConf) {
            next[key] = "auto";
            count++;
            changed = true;
          }
        });
        return changed ? next : s;
      });
      if (count > 0) {
        toast.success(`Auto-approved ${count} high-confidence row${count === 1 ? "" : "s"}`);
      }
    }
  }, [modalAutoApprove, openJob, visibleRows]);

  return (
    <AppLayout>
      <PageHeader
        title="Review Queue"
        subtitle="Solutions jobs use sampling + A/D/M/V change tracking. Agents jobs are reviewed per source (full dump on schedule, or change monitoring with highlighted deltas)."
      />

      <div className="px-7 pb-8 space-y-4">
        {/* Realtime queue metrics - compact */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pending</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.pending}</div>
              <div className="text-[10.5px] text-warning">{queueMetrics.pending_urgent} urgent</div>
            </div>
          </Card>
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Approved today</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.approved_today}</div>
              <div className="text-[10.5px] text-success">incl. {queueMetrics.approved_today_auto} auto</div>
            </div>
          </Card>
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Rejected today</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.rejected_today}</div>
              <div className="text-[10.5px] text-muted-foreground">live count</div>
            </div>
          </Card>
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avg. confidence</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.avg_confidence}%</div>
              <div className="text-[10.5px] text-muted-foreground">across pending</div>
            </div>
          </Card>
        </div>



        {/* Tab / Filter selection bar */}
        <Card className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">Mode</span>
            {[
              { value: "All", label: "All" },
              { value: "By Dataset", label: "Solutions" },
              { value: "By Source", label: "Agents" },
            ].map((m) => (
              <button
                key={m.value}
                onClick={() => setModeFilter(m.value as JobMode)}
                className={`px-3 py-1 rounded-md border text-[12px] ${modeFilter === m.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-secondary"}`}
              >
                {m.label} {m.value !== "All" && <span className="opacity-70">({allJobs.filter((j) => j.mode === m.value).length})</span>}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground">{filteredJobs.length} of {allJobs.length} jobs · {filteredJobs.reduce((s, j) => s + j.rows, 0).toLocaleString()} rows</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Sort</span>
              {[
                { value: "latest", label: "Latest" },
                { value: "oldest", label: "Oldest" },
                { value: "id-asc", label: "ID ↑" },
                { value: "id-desc", label: "ID ↓" },
                { value: "status", label: "Status" },
              ].map((s) => (
                <button
                  key={s.value}
                  onClick={() => setJobSort(s.value as any)}
                  className={`px-2.5 py-1 rounded-md border text-[12px] ${jobSort === s.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-secondary"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Solutions jobs - ADMV sampling table */}
        {(modeFilter === "All" || modeFilter === "By Dataset") && sortedJobs.some((j) => j.mode === "By Dataset") && (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-[14px]">Solutions - sampling review</h3>
              <p className="text-[12px] text-muted-foreground">Set sample % per job, then <strong>Review</strong> to open the sampled grid with A/D/M/V change tracking.</p>
            </div>
            <div className="overflow-auto max-h-[500px] pb-32">
              <table className="w-full text-[12.5px]">
              <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0 z-10 dark:bg-secondary/80">
                <tr>
                  <th className="text-left px-3 py-1.5">Job</th>
                  <th className="text-left px-3 py-1.5">Source</th>
                  <th className="text-right px-3 py-1.5">Rows</th>
                  <th className="text-right px-3 py-1.5">Changed</th>
                  <th className="text-right px-3 py-1.5 w-28">Runs</th>
                  <th className="text-left px-3 py-1.5 w-64">Sample rate</th>
                  <th className="text-left px-3 py-1.5 w-48">Confidence filter</th>
                  <th className="text-left px-3 py-1.5 w-36">Status</th>
                  <th className="text-left px-3 py-1.5 w-28">Coverage</th>
                  <th className="text-left px-3 py-1.5 w-28">Quality</th>
                  <th className="text-right px-3 py-1.5 w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedJobs.filter((j) => j.mode === "By Dataset").map((j) => {
                  const rate = jobRates[j.id] ?? 2;
                  const sampled = Math.max(1, Math.round((j.rows * rate) / 100));
                  const done = reviewed[j.id];
                  const sc = getJobScore(j);
                  const urgentPending = Boolean(j.isUrgent);
                  return (
                    <tr
                      key={j.id}
                      id={`row-${j.id}`}
                      tabIndex={-1}
                      className={`hover:bg-secondary/40 focus:bg-secondary/80 focus:outline-none transition-colors duration-200 ${
                        urgentPending
                          ? "bg-warning-bg/30 border-l-2 border-warning/80"
                          : j.id === selectedJobId
                            ? "bg-info-bg/40 border-l-2 border-info/80"
                            : ""
                      }`}
                    >
                      <td className="px-3 py-1.5 font-mono"><span className="break-all">{j.id}</span></td>
                      <td className="px-3 py-1.5 max-w-[160px] overflow-hidden">
                        <span className="font-semibold truncate block">{j.isDatasetJob ? (getAnySiteUploadedFilename(j.filters) || j.source) : j.source}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{j.rows.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right"><Badge tone={(j.changedPct ?? 0) > 20 ? "warning" : "info"}>{j.changedPct}%</Badge></td>
                      <td className="px-3 py-1.5 text-right text-[12px] font-mono">{j.refreshCount || 0} run{(j.refreshCount || 0) !== 1 ? "s" : ""}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="relative w-20">
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={rate}
                              onChange={(e) => setJobRates((s) => ({ ...s, [j.id]: Math.min(100, Math.max(1, Number(e.target.value) || 1)) }))}
                              className="h-7 text-[12px] pr-5"
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">≈ {sampled.toLocaleString()} row{sampled === 1 ? "" : "s"} selected</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 relative">
                        {(() => {
                          const limits = confLimits[j.id] || { min: 0, max: 100 };
                          const isOpen = activeConfJobId === j.id;
                          const confidenceCount = getConfidenceRangeCount(j, limits, sample, openJob?.id ?? null);
                          return (
                            <div className="relative inline-block text-left">
                              <button
                                type="button"
                                onClick={() => setActiveConfJobId(isOpen ? null : j.id)}
                                className="h-7 px-2.5 text-[12px] w-28 bg-card border border-border rounded flex items-center justify-between text-left cursor-pointer hover:bg-secondary select-none font-sans"
                              >
                                <span>{limits.min}% - {limits.max}%</span>
                                <span className="text-[9px] opacity-60 ml-1">▼</span>
                              </button>

                              {isOpen && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setActiveConfJobId(null)} />
                                  <div className="absolute top-8 left-0 z-50 w-44 bg-card border border-border rounded-md p-2.5 shadow-md flex items-center gap-1.5 text-[11px] font-sans">
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold text-left">Min (%)</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={limits.min}
                                        onChange={(e) => {
                                          const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                                          setConfLimits((s) => ({ ...s, [j.id]: { min: val, max: s[j.id]?.max ?? 100 } }));
                                        }}
                                        className="w-16 h-7 px-1.5 border border-border rounded text-[11px] bg-background text-foreground focus:outline-none"
                                      />
                                    </div>
                                    <span className="mt-4 text-muted-foreground font-semibold">-</span>
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold text-left">Max (%)</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={limits.max}
                                        onChange={(e) => {
                                          const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                                          setConfLimits((s) => ({ ...s, [j.id]: { min: s[j.id]?.min ?? 80, max: val } }));
                                        }}
                                        className="w-16 h-7 px-1.5 border border-border rounded text-[11px] bg-background text-foreground focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                </>
                              )}
                              <div className="text-[11px] text-muted-foreground mt-1">
                                {`${confidenceCount.toLocaleString()} rows matching`}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-1.5">
                        {j.statusText === "Running" || j.statusText === "Refreshing" ? (
                          <Badge tone="info">{j.statusText === "Refreshing" ? "Refreshing" : "Running"}</Badge>
                        ) : j.reviewStatus === "Completed" || reviewed[j.id] ? (
                          <Badge tone="success">Review completed</Badge>
                        ) : (
                          <Badge tone={(sc.approved + sc.rejected > 0) ? "info" : "warning"}>
                            {(sc.approved + sc.rejected > 0) ? "Review in progress" : "Review pending"}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {(() => {
                          const coverageValue = j.coverage?.job_coverage;
                          return coverageValue === null || coverageValue === undefined || Number.isNaN(coverageValue)
                            ? <span className="text-muted-foreground">—</span>
                            : <Badge tone={coverageTone(coverageValue)}>{formatCoveragePct(coverageValue)}</Badge>;
                        })()}
                      </td>
                      <td className="px-3 py-1.5"><QualityCell score={sc} /></td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setOpenJob(j); setChangeFilter("all"); setConfFilter("all"); }}>
                            <Eye className="h-3.5 w-3.5" /> Review
                          </Button>
                          <Button size="sm" variant="outline" title="Download" onClick={() => window.open(`/api/v1/export?run_id=${j.id}&format=xlsx`, "_blank")}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        )}

        {/* Agents jobs - source-centric review (full dump w/ schedule + change monitoring) */}
        {(modeFilter === "All" || modeFilter === "By Source") && sortedJobs.some((j) => j.mode === "By Source") && (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-[14px]">Agents - extraction review</h3>
              <p className="text-[12px] text-muted-foreground">
                Source-specific full dumps run on a schedule (weekly / monthly). Change-monitoring sources highlight what changed since last run.
              </p>
            </div>
            <div className="overflow-auto max-h-[500px] pb-32">
              <table className="w-full text-[12.5px]">
              <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0 z-10 dark:bg-secondary/80">
                <tr>
                  <th className="text-left px-3 py-1.5">Job</th>
                  <th className="text-left px-3 py-1.5">Source</th>
                  <th className="text-right px-3 py-1.5">Rows</th>
                  <th className="text-left px-3 py-1.5 w-44">Type</th>
                  <th className="text-left px-3 py-1.5 w-64">Sample rate</th>
                  <th className="text-left px-3 py-1.5 w-48">Confidence filter</th>
                  <th className="text-left px-3 py-1.5 w-36">Status</th>
                  <th className="text-left px-3 py-1.5 w-28">Coverage</th>
                  <th className="text-left px-3 py-1.5 w-28">Quality</th>
                  <th className="text-right px-3 py-1.5 w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedJobs.filter((j) => j.mode === "By Source").map((j) => {
                  const isCM = j.kind === "Change Monitoring";
                  const schedule = j.schedule || "Weekly";
                  const done = reviewed[j.id];
                  const rate = jobRates[j.id] ?? 2;
                  const sampled = Math.max(1, Math.round((j.rows * rate) / 100));
                  const sc = getJobScore(j);
                  const urgentPending = Boolean(j.isUrgent);
                  return (
                    <tr
                      key={j.id}
                      id={`row-${j.id}`}
                      tabIndex={-1}
                      className={`hover:bg-secondary/40 focus:bg-secondary/80 focus:outline-none transition-colors duration-200 ${
                        urgentPending
                          ? "bg-warning-bg/30 border-l-2 border-warning/80"
                          : j.id === selectedJobId
                            ? "bg-info-bg/40 border-l-2 border-info/80"
                            : ""
                      }`}
                    >
                      <td className="px-3 py-1.5 font-mono">
                        <span className="break-all">{j.id}</span>
                      </td>
                      <td className="px-3 py-1.5 max-w-[160px] overflow-hidden">
                        <div className="font-semibold text-foreground truncate block">{j.source}</div>
                        <div className="text-[10.5px] text-muted-foreground mt-0.5 truncate">{j.domain}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{j.rows.toLocaleString()}</td>
                      <td className="px-3 py-1.5">
                        {j.kind === "Change Monitoring" && (
                          <Badge tone="warning">Change monitoring · {schedule}</Badge>
                        )}
                        {j.kind === "Full Scrape" && (
                          <Badge tone="purple">Full scrape · {schedule}</Badge>
                        )}
                        {j.kind === "Custom Scrape" && (
                          <Badge tone="purple">Partial scrape · {schedule}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="relative w-20">
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={rate}
                              onChange={(e) => setJobRates((s) => ({ ...s, [j.id]: Math.min(100, Math.max(1, Number(e.target.value) || 1)) }))}
                              className="h-7 text-[12px] pr-5"
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">≈ {sampled.toLocaleString()} row{sampled === 1 ? "" : "s"} selected</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 relative">
                        {(() => {
                          const limits = confLimits[j.id] || { min: 0, max: 100 };
                          const isOpen = activeConfJobId === j.id;
                          const confidenceCount = getConfidenceRangeCount(j, limits, sample, openJob?.id ?? null);
                          return (
                            <div className="relative inline-block text-left">
                              <button
                                type="button"
                                onClick={() => setActiveConfJobId(isOpen ? null : j.id)}
                                className="h-7 px-2.5 text-[12px] w-28 bg-card border border-border rounded flex items-center justify-between text-left cursor-pointer hover:bg-secondary select-none font-sans"
                              >
                                <span>{limits.min}% - {limits.max}%</span>
                                <span className="text-[9px] opacity-60 ml-1">▼</span>
                              </button>

                              {isOpen && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setActiveConfJobId(null)} />
                                  <div className="absolute top-8 left-0 z-50 w-44 bg-card border border-border rounded-md p-2.5 shadow-md flex items-center gap-1.5 text-[11px] font-sans">
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold text-left">Min (%)</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={limits.min}
                                        onChange={(e) => {
                                          const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                                          setConfLimits((s) => ({ ...s, [j.id]: { min: val, max: s[j.id]?.max ?? 100 } }));
                                        }}
                                        className="w-16 h-7 px-1.5 border border-border rounded text-[11px] bg-background text-foreground focus:outline-none"
                                      />
                                    </div>
                                    <span className="mt-4 text-muted-foreground font-semibold">-</span>
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold text-left">Max (%)</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={limits.max}
                                        onChange={(e) => {
                                          const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                                          setConfLimits((s) => ({ ...s, [j.id]: { min: s[j.id]?.min ?? 80, max: val } }));
                                        }}
                                        className="w-16 h-7 px-1.5 border border-border rounded text-[11px] bg-background text-foreground focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                </>
                              )}
                              <div className="text-[11px] text-muted-foreground mt-1">
                                {`${confidenceCount.toLocaleString()} rows matching`}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-1.5">
                        {j.reviewStatus === "Completed" || reviewed[j.id] ? (
                          <Badge tone="success">Review completed</Badge>
                        ) : (
                          <Badge tone={(j.statusText === "Running" || j.statusText === "Refreshing") ? "info" : ((sc.approved + sc.rejected > 0) ? "info" : "warning")}>
                            {j.statusText === "Refreshing" ? "Refreshing" : (j.statusText === "Running" ? "Running" : ((sc.approved + sc.rejected > 0) ? "Review in progress" : "Review pending"))}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {(() => {
                          const coverageValue = j.coverage?.job_coverage;
                          return coverageValue === null || coverageValue === undefined || Number.isNaN(coverageValue)
                            ? <span className="text-muted-foreground">—</span>
                            : <Badge tone={coverageTone(coverageValue)}>{formatCoveragePct(coverageValue)}</Badge>;
                        })()}
                      </td>
                      <td className="px-3 py-1.5"><QualityCell score={sc} /></td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setOpenJob(j); setChangeFilter("all"); setConfFilter("all"); }} disabled={j.statusText === "Running" || j.statusText === "Refreshing"}>
                            <Eye className="h-3.5 w-3.5" /> Review
                          </Button>
                          <Button size="sm" variant="outline" title="Download" onClick={() => window.open(`/api/v1/export?run_id=${j.id}&format=xlsx`, "_blank")}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        )}
      </div>

      {/* Sample preview dialog */}
      <Dialog open={!!openJob} onOpenChange={(o) => !o && setOpenJob(null)}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              {openJob?.id} - {openJob ? (getAnySiteUploadedFilename(openJob.filters) || openJob.source) : ""}
            </DialogTitle>
          </DialogHeader>
          {openJob && (
            <div className="space-y-3">
              {!activeSample || (viewInBulk && bulkLoading) ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <span className="flex h-8 w-8 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-8 w-8 bg-primary/80"></span>
                  </span>
                  <span className="text-[13px] text-muted-foreground">Loading review data...</span>
                </div>
              ) : activeSample.rows.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-16">
                  <p className="text-muted-foreground text-sm">No review data available for this job.</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setOpenJob(null)}>Close</Button>
                    <Button variant="destructive" size="sm" onClick={() => void deleteJobFromReview(openJob.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete job
                    </Button>
                  </div>
                </div>
              ) : (
                <>
              <div className="flex items-center justify-between gap-3 flex-wrap text-[12px] text-muted-foreground">
                <div>
                  {viewInBulk ? (
                    <>
                      Bulk view = <strong>{visibleRows.length.toLocaleString()} rows</strong> shown from <strong>{openJob.rows.toLocaleString()}</strong> total.
                    </>
                  ) : (
                    <>
                      Sample <strong>{jobRates[openJob.id] ?? 2}%</strong> = {recordsPerPage.toLocaleString()} of {openJob.rows.toLocaleString()} rows.
                      Showing rows <strong>{startRow.toLocaleString()} - {endRow.toLocaleString()}</strong> · page {currentPage} of {totalPages}.
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setViewInBulk((v) => !v);
                      setPageOffset(0);
                    }}
                    className={`h-8 text-[11px] px-2.5 ${viewInBulk ? "bg-secondary font-semibold text-primary" : ""}`}
                  >
                    {viewInBulk ? "Back to Sample" : "View in Bulk"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={viewInBulk || pageOffset === 0}
                    onClick={() => setPageOffset((prev) => Math.max(0, prev - recordsPerPage))}
                    className="h-8 text-[11px] px-2.5"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={viewInBulk || pageOffset + recordsPerPage >= (sample?.totalSampled ?? visibleRecordGroups.length)}
                    onClick={() => setPageOffset((prev) => prev + recordsPerPage)}
                    className="h-8 text-[11px] px-2.5"
                  >
                    Next
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">A/D/M/V</span>
                    <Chip on={changeFilter === "all"} onClick={() => setChangeFilter("all")}>All</Chip>
                    <Chip on={changeFilter === "A"} onClick={() => setChangeFilter("A")} tone="success">A · {counts.A}</Chip>
                    <Chip on={changeFilter === "D"} onClick={() => setChangeFilter("D")} tone="destructive">D · {counts.D}</Chip>
                    <Chip on={changeFilter === "M"} onClick={() => setChangeFilter("M")} tone="warning">M · {counts.M}</Chip>
                    <Chip on={changeFilter === "V"} onClick={() => setChangeFilter("V")} tone="info">V · {counts.V}</Chip>
                <label className="ml-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Sort
                  <select
                    value={reviewSort}
                    onChange={(event) => setReviewSort(event.target.value as ReviewSort)}
                    className="h-7 rounded-md border border-border bg-card px-2 text-[11px] text-foreground"
                  >
                    <option value="latest">Latest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="confidence-high">Highest confidence</option>
                    <option value="confidence-low">Lowest confidence</option>
                  </select>
                </label>
                <span className="text-[11px] text-muted-foreground ml-auto">{visibleRows.length} rows shown</span>
              </div>

              {/* Bulk actions for current filter */}
              <div className="flex items-center gap-2 flex-wrap rounded-md border border-border bg-secondary/40 px-3 py-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Bulk</span>
                <span className="text-[10.5px] text-muted-foreground">
                  Applies to <strong>{visibleRows.length}</strong> rows in current filter
                  {changeFilter !== "all" && <> · <strong>{changeFilter}</strong> changes</>}
                </span>

                <div className="ml-auto flex items-center gap-2">
                  {(() => {
                    const approved = visibleRows.filter((r) => {
                      const key = `${openJob.id}-${r.id}`;
                      return rowStatus[key] === "approved" || rowStatus[key] === "auto";
                    }).length;
                    const rejected = visibleRows.filter((r) => {
                      const key = `${openJob.id}-${r.id}`;
                      return rowStatus[key] === "rejected";
                    }).length;
                    const pending = visibleRows.length - approved - rejected;
                    return (
                      <span className="text-[10.5px] text-muted-foreground">
                        <span className="text-success">{approved}✓</span> · <span className="text-destructive">{rejected}✕</span> · {pending} pending
                      </span>
                    );
                  })()}
                  <Chip
                    on={showAvgConfidence}
                    onClick={() => setShowAvgConfidence((curr) => !curr)}
                    tone="info"
                  >
                    Avg Confi
                  </Chip>
                  {showAvgConfidence && visibleAvgConfidenceBadges.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {visibleAvgConfidenceBadges.map((item) => (
                        <Badge
                          key={item.id}
                          tone={item.tone}
                          className={`${recordGroupBg(item.label)} border border-border text-foreground`}
                        >
                          {item.score}%
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Button size="sm" variant="outline" onClick={bulkReject} disabled={!visibleRows.length}>
                    <XCircle className="h-3.5 w-3.5" /> Reject all
                  </Button>
                  <Button size="sm" onClick={bulkApprove} disabled={!visibleRows.length}>
                    <CheckCheck className="h-3.5 w-3.5" /> Approve all
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-border overflow-hidden max-h-[60vh] overflow-y-auto">
                <table className="w-full text-[12px] table-fixed">
                  <thead className="bg-secondary text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 z-10 dark:bg-secondary/80">
                    <tr>
                      <th className="text-left px-2.5 py-2 w-[5%]">ADMV</th>
                      <th className="text-left px-2.5 py-2 w-[10%]">Record</th>
                      <th className="text-left px-2.5 py-2 w-[12%]">Attribute</th>
                      <th className="text-left px-2.5 py-2 w-[23%]">Previous</th>
                      <th className="text-left px-2.5 py-2 w-[23%]">New value</th>
                      <th className="text-left px-2.5 py-2 w-[7%]">Conf.</th>
                      <th className="text-left px-2.5 py-2 w-[10%]">Source</th>
                      <th className="text-right px-2.5 py-2 w-[10%]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rowsForDisplay.map((r) => {
                      const isEditing = editing[r.id] !== undefined;
                      const hasConf = r.conf !== null && r.conf !== undefined && !isNaN(r.conf);
                      const b = hasConf ? bucket(r.conf) : null;
                      const key = `${openJob.id}-${r.id}`;
                      const status = rowStatus[key];
                      return (
                        <tr key={r.id} className={[recordGroupBg(r.record), status ? "opacity-60" : ""].join(" ")}>
                          <td className="px-2.5 py-1.5"><Badge tone={changeTone(r.changeType)}>{r.changeType}</Badge></td>
                          <td className="px-2.5 py-1.5 font-medium">{r.record}</td>
                          <td className="px-2.5 py-1.5 text-muted-foreground">{r.attribute}</td>
                          <td className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground break-all whitespace-normal">{r.previous}</td>
                          <td className="px-2.5 py-1.5">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <Input value={editing[r.id]} onChange={(e) => setEditing((s) => ({ ...s, [r.id]: e.target.value }))} className="h-7 text-[11px] font-mono w-full" />
                                <Button size="sm" onClick={() => handleSave(r, editing[r.id])}><Save className="h-3 w-3" /></Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditing((s) => ({ ...s, [r.id]: r.value }))}
                                className={[
                                  "font-mono text-[11px] px-1.5 py-0.5 rounded text-left hover:bg-secondary flex items-start justify-between gap-1 w-full max-w-full",
                                  r.changed ? "bg-warning-bg font-bold text-warning-foreground" : "",
                                ].join(" ")}
                              >
                                <span className="break-all whitespace-normal">{r.value}</span>
                                <Edit3 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                              </button>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {hasConf && b ? (
                              <Badge tone={bucketTone(b)}>{Math.round(r.conf * 100)}%</Badge>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 break-all">
                            <a href={r.sourceUrl} className="text-info hover:underline text-[11px] inline-flex items-start gap-1" target="_blank" rel="noreferrer">
                              <span className="break-all">{r.source}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
                            </a>
                          </td>
                          <td className="px-2.5 py-1.5 text-right">
                            {status ? (
                              <Badge tone={status === "rejected" ? "destructive" : status === "auto" ? "info" : "success"}>
                                {status === "auto" ? "Auto ✓" : status}
                              </Badge>
                            ) : (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => setRowStatus((s) => ({ ...s, [key]: "rejected" }))}><X className="h-3 w-3" /></Button>
                                <Button size="sm" onClick={() => setRowStatus((s) => ({ ...s, [key]: "approved" }))}><Check className="h-3 w-3" /></Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="text-[11px] text-muted-foreground">
                Bold yellow = value changed since last refresh. A = Added, D = Deleted, M = Modified, V = Verified (no change).
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpenJob(null)}>Close</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  if (!openJob) return;
                  const rows = bulkSample?.rows?.length ? bulkSample.rows : visibleRows;
                  const header = ["Record", "Attribute", "Previous Value", "New Value", "Change Type", "Decision", "Source", "Source URL"];
                  const csvRows = rows.map((r: any) => {
                    const key = `${openJob.id}-${r.id}`;
                    const decision = rowStatus[key] === "rejected" ? "Rejected" : rowStatus[key] === "approved" ? "Approved" : "Pending";
                    return [r.record, r.attribute, r.previous ?? "", r.value ?? "", r.changeType, decision, r.source ?? "", r.sourceUrl ?? ""].map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(",");
                  });
                  const blob = new Blob([[header.join(","), ...csvRows].join("\n")], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `review-${openJob.id}-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                }}>
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
                <Button size="sm" onClick={handleSaveReview}>Save review</Button>
              </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
export default Review;
