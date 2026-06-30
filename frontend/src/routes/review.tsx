import { useState, useMemo, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, Input, Select } from "@/components/ui-bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X, ExternalLink, Edit3, Save, Eye, Info, Zap, CheckCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Review Queue – FreshData AI" }] }),
  component: Review,
});

type ChangeType = "A" | "D" | "M" | "V" | "N";

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
  
  const dashIdxs = [" – ", " - "];
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

function getDeterministicConfidence(attr: string, prevVal: string, newVal: string, recordIndex: number): number {
  let source_confidence = 85;
  
  if (attr === "website") {
    source_confidence = 98; // Website/domain verified
  } else if (attr === "phone" || attr === "email") {
    source_confidence = 95; // Direct website extraction
  } else if (attr === "legal_name" || attr === "description") {
    source_confidence = 70; // LLM inferred
  } else {
    source_confidence = 85; // Structured extraction
  }

  let validation_bonus = 0;
  if (newVal && newVal !== "—") {
    if (prevVal && prevVal !== "—" && prevVal.toLowerCase() === newVal.toLowerCase()) {
      validation_bonus = 5;
    } else {
      validation_bonus = 2;
    }
  }

  let ambiguity_penalty = 0;
  if (newVal && (newVal.includes(",") || newVal.length > 30)) {
    ambiguity_penalty = 5;
  }
  
  const variation = (recordIndex * 7 + attr.length * 3) % 5;
  const score = source_confidence + validation_bonus - ambiguity_penalty + variation;
  return Math.min(99, Math.max(60, score)) / 100;
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
    const conf = changeType === "V" ? 0.92 + r * 0.07 : changeType === "M" ? 0.6 + r * 0.35 : 0.55 + r * 0.4;
    const prev = `${attr.split(" ")[0].toLowerCase()}-${1000 + ((i * 13) % 9000)}`;
    const next = changeType === "V" ? prev : changeType === "D" ? "—" : `${attr.split(" ")[0].toLowerCase()}-${1000 + ((i * 17 + 3) % 9000)}`;
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

function determineADMV(prev: any, newVal: any): ChangeType {
  const p = cleanValue(prev);
  const n = cleanValue(newVal);

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
        {score.approved}✓ · {score.rejected}✕ of {total}
      </span>
    </div>
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
  if (!filters || filters === "—" || filters === "â€”" || filters === "–") return "";
  try {
    const parsed = JSON.parse(filters);
    if (parsed && typeof parsed.seedFile === "string" && parsed.seedFile) {
      return parsed.seedFile.trim().replace(/\.(csv|xlsx|xls|json|jsonl)$/i, "");
    }
  } catch (e) {
    // Ignore
  }
  return "";
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
  const [jobRates, setJobRates] = useState<Record<string, number>>({});
  const [appliedRates, setAppliedRates] = useState<Record<string, number>>({});
  const [openJob, setOpenJob] = useState<JobRow | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [changeFilter, setChangeFilter] = useState<"all" | ChangeType>("all");
  const [confFilter, setConfFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [activeConfJobId, setActiveConfJobId] = useState<string | null>(null);
  const [confLimits, setConfLimits] = useState<Record<string, { min: number; max: number }>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, "approved" | "rejected" | "auto">>({});
  const [pageOffset, setPageOffset] = useState(0);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  
  const [policyOpen, setPolicyOpen] = useState(false);
  const [modalAutoApprove, setModalAutoApprove] = useState(false);

  const [dbJobs, setDbJobs] = useState<any[]>([]);
  const [sample, setSample] = useState<{ rows: any[]; totalSampled: number; sampledCount: number } | null>(null);

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
        toast.success("Changes saved successfully");
        setSample((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            rows: prev.rows.map((rowItem) => {
              if (rowItem.id === row.id) {
                const isChanged = newValue !== "—" && rowItem.previous !== newValue;
                return {
                  ...rowItem,
                  value: newValue,
                  changed: isChanged,
                  changeType: isChanged ? "M" : "V",
                };
              }
              return rowItem;
            }),
          };
        });
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
    if (!openJob || !sample) return;

    try {
      const decisions = sample.rows.map((r: any) => {
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
        toast.success("Review saved and finalized successfully");
        setReviewed((s) => ({ ...s, [openJob.id]: true }));
        setOpenJob(null);
      } else {
        toast.error("Failed to finalize review on the backend");
      }
    } catch (err) {
      console.error("Failed to submit review:", err);
      toast.error("An error occurred while finalizing review");
    }
  };

  function bulkApprove() {
    if (!openJob || !visibleRows.length) return;
    let count = 0;
    setRowStatus((s) => {
      const next = { ...s };
      visibleRows.forEach((r) => {
        const key = `${openJob.id}-${r.id}`;
        if (!next[key]) {
          next[key] = "approved";
          count++;
        }
      });
      return next;
    });
    toast.success(`Approved ${count} row${count === 1 ? "" : "s"} (current filter)`);
  }

  function bulkReject() {
    if (!openJob || !visibleRows.length) return;
    let count = 0;
    setRowStatus((s) => {
      const next = { ...s };
      visibleRows.forEach((r) => {
        const key = `${openJob.id}-${r.id}`;
        if (!next[key]) {
          next[key] = "rejected";
          count++;
        }
      });
      return next;
    });
    toast.success(`Rejected ${count} row${count === 1 ? "" : "s"} (current filter)`);
  }

  // 1. Fetch jobs from database
  useEffect(() => {
    let active = true;
    async function fetchJobs() {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`);
        if (response.ok) {
          const data = await response.json();
          if (active) {
            setDbJobs(data);
          }
        }
      } catch (err) {
        console.error("Failed to fetch jobs in review queue:", err);
      }
    }
    fetchJobs();
    const interval = setInterval(fetchJobs, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [baseApiUrl]);

  // Combine database jobs with static mock jobs
  const datasetJobs = useMemo(() => {
    const dbDataset = dbJobs
      .filter((j: any) => (j.mode === "By Dataset" || j.mode === "Any-Site") && (j.status === "Review Pending" || j.status === "Completed"))
      .map((j: any) => {
        const isCompleted = j.status === "Completed";
        return {
          id: j.id,
          source: j.source,
          rows: j.records || 0,
          changedPct: j.changes_detected !== undefined && j.changes_detected !== null ? j.changes_detected : 15,
          lowConfPct: j.lowConfPct !== undefined && j.lowConfPct !== null ? j.lowConfPct : 2,
          statusText: isCompleted ? "Completed" : "Extraction Completed",
          reviewStatus: isCompleted ? "Completed" : "Review pending",
          isDatasetJob: true,
          isDbJob: true,
          filters: j.filters,
          mode: "By Dataset" as JobMode,
          nextRefresh: j.next_refresh,
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
        const isCM = j.frequency !== "One-time" && refreshCount > 0;
        const isPartial = String(j.scope || "").toLowerCase().includes("partial");
        const kind = isCM ? "Change Monitoring" : (isPartial ? "Partial Scrape" : "Full Scrape");
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

  const getJobScore = (jobId: string) => {
    const approved = Object.entries(rowStatus).filter(([key, val]) => key.startsWith(`${jobId}-`) && (val === "approved" || val === "auto")).length;
    const rejected = Object.entries(rowStatus).filter(([key, val]) => key.startsWith(`${jobId}-`) && val === "rejected").length;
    return { approved, rejected };
  };

  // Global queue metrics
  const queueMetrics = useMemo(() => {
    const approvedToday = Object.values(rowStatus).filter((v) => v === "approved" || v === "auto").length;
    const rejectedToday = Object.values(rowStatus).filter((v) => v === "rejected").length;
    const autoToday = Object.values(rowStatus).filter((v) => v === "auto").length;
    const totalActioned = approvedToday + rejectedToday;
    const rejectRate = totalActioned ? Math.round((rejectedToday / totalActioned) * 1000) / 10 : 0;
    const pendingJobs = allJobs.filter((j) => !reviewed[j.id]);
    const pending = pendingJobs.length;
    const urgent = pendingJobs.filter((j) => (j.lowConfPct ?? 0) >= 7).length;
    const avgConf = pendingJobs.length
      ? Math.round(pendingJobs.reduce((s, j) => s + (100 - (j.lowConfPct ?? 0) * 2), 0) / pendingJobs.length)
      : 0;
    return { pending, urgent, approvedToday, rejectedToday, autoToday, rejectRate, avgConf };
  }, [rowStatus, reviewed, allJobs]);

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
      setSample(null);
      return;
    }

    if (!openJob.isDbJob) {
      const generated = generateSample(openJob, appliedRates[openJob.id] ?? 2);
      setSample(generated);
      return;
    }

    const isDatasetJob = openJob.isDatasetJob;
    const enrichedUrl = `${baseApiUrl}/api/v1/export?run_id=${openJob.id}&format=json`;

    let active = true;
    if (isDatasetJob) {
      // Dataset job comparison review flow
      const inputUrl = `${baseApiUrl}/api/v1/export?run_id=${openJob.id}&format=json&type=input`;
      Promise.all([
        fetch(enrichedUrl).then((res) => {
          if (!res.ok) throw new Error("Enriched export failed");
          return res.json();
        }),
        fetch(inputUrl)
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => [])
      ])
        .then(([enrichedRecords, inputRecords]) => {
          if (!active) return;

          let selectedOutputs: string[] = [];
          let mapping: Record<string, string> = {};
          
          const DEFAULT_OUTPUTS = ["legal_name", "website", "phone", "email", "linkedin_url"];
          const DEFAULT_MAPPING: Record<string, string> = {
            legal_name: "company_name",
            website: "corp_site",
            phone: "phone",
            email: "email",
            linkedin_url: "linkedin",
            hq_address: "add",
            registry_number: "cik_number"
          };

          if (openJob.filters) {
            try {
              const config = JSON.parse(openJob.filters);
              selectedOutputs = config.selectedOutputs || [];
              mapping = config.mapping || {};
            } catch (e) {
              console.error("Failed to parse filters JSON:", e);
            }
          }

          if (selectedOutputs.length === 0) {
            selectedOutputs = DEFAULT_OUTPUTS;
          }
          if (Object.keys(mapping).length === 0) {
            mapping = DEFAULT_MAPPING;
          }

          const sampleRate = appliedRates[openJob.id] ?? 2;
          const totalRecords = enrichedRecords.length;
          const sampleCount = Math.max(1, Math.round((totalRecords * sampleRate) / 100));

          const sampledEnriched = enrichedRecords;
          const sampledInput = inputRecords;

          const rows: any[] = [];
          sampledEnriched.forEach((rec: any, i: number) => {
            const originalRec = sampledInput[i] || {};
            const recordLabel = `Record ${i + 1}`;

            const foundWebsite = findCompanyWebsite(originalRec, rec);
            const sourceUrl = foundWebsite && String(foundWebsite).startsWith("http")
              ? String(foundWebsite)
              : (foundWebsite ? `https://${foundWebsite}` : "https://example.com");
            const sourceDisplay = cleanDomain(foundWebsite);

            selectedOutputs.forEach((attr) => {
              const attrLabel = ATTRIBUTE_LABELS[attr] || attr;

              const mappedHeader = mapping[attr];
              const rawPrev = mappedHeader ? originalRec[mappedHeader] : originalRec[attr];
              const previousValue = rawPrev !== undefined && rawPrev !== null && String(rawPrev).trim() !== "" ? String(rawPrev) : "—";

              const rawNew = rec[attr];
              const newValue = rawNew !== undefined && rawNew !== null && String(rawNew).trim() !== "" ? String(rawNew) : "—";

              const isPrevEmpty = previousValue === "—";
              const isNewEmpty = newValue === "—";

              let conf = null;
              if (isPrevEmpty && isNewEmpty) {
                conf = null;
              } else if (!isPrevEmpty && isNewEmpty) {
                conf = null;
              } else if (isPrevEmpty && !isNewEmpty) {
                conf = 0.95;
              } else {
                if (previousValue.toLowerCase().trim() === newValue.toLowerCase().trim()) {
                  conf = 1.0;
                } else {
                  const rawConf = getDeterministicConfidence(attr, previousValue, newValue, i);
                  conf = 0.85 + (rawConf * 100 % 11) / 100;
                }
              }

              const changeType = determineADMV(rawPrev, rawNew);
              const isChanged = changeType !== "V";

              rows.push({
                id: `${openJob.id}-${i}-${attr}`,
                record: recordLabel,
                attribute: attrLabel,
                attributeKey: attr,
                recordIndex: i,
                previous: previousValue,
                value: newValue,
                changeType: changeType,
                changed: isChanged,
                conf: conf,
                sourceUrl: sourceUrl,
                source: sourceDisplay,
              });
            });
          });

          setSample({ rows, totalSampled: enrichedRecords.length, sampledCount: sampleCount });
        })
        .catch((err) => {
          console.error("Failed to load real dataset for review:", err);
          if (active) {
            setSample({ rows: [], totalSampled: 0, sampledCount: 0 });
          }
        });
    } else {
      // Site-specific (By Source) job review flow: call backend comparison review_data endpoint
      const sampleRate = appliedRates[openJob.id] ?? 2;
      fetch(`${baseApiUrl}/api/v1/demo/jobs/review_data?job_id=${openJob.id}&sample_rate=${sampleRate}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load review data");
          return res.json();
        })
        .then((data) => {
          if (!active) return;
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
  }, [openJob, appliedRates, baseApiUrl]);

  const visibleRows = useMemo(() => {
    if (!sample) return [];
    const limits = openJob ? (confLimits[openJob.id] || { min: 80, max: 100 }) : { min: 80, max: 100 };
    return sample.rows.filter((r) => {
      if (changeFilter !== "all" && r.changeType !== changeFilter) return false;
      if (r.conf !== null && r.conf !== undefined && !isNaN(r.conf)) {
        const confPct = Math.round(r.conf * 100);
        if (confPct < limits.min || confPct > limits.max) return false;
      }
      return true;
    });
  }, [sample, changeFilter, openJob, confLimits]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { A: 0, D: 0, M: 0, V: 0, N: 0, high: 0, medium: 0, low: 0 };
    sample?.rows.forEach((r) => {
      c[r.changeType]++;
      if (r.conf !== null && r.conf !== undefined && !isNaN(r.conf)) {
        c[bucket(r.conf)]++;
      }
    });
    return c;
  }, [sample]);

  function applyRate(jobId: string) {
    const rate = jobRates[jobId] ?? 2;
    setAppliedRates((s) => ({ ...s, [jobId]: rate }));
    toast.success(`Sample rate applied: ${rate}%`);
  }

  const recordsPerPage = useMemo(() => {
    return sample?.sampledCount || 10;
  }, [sample]);

  const totalRecords = useMemo(() => {
    return sample?.totalSampled || 0;
  }, [sample]);

  const paginatedRows = useMemo(() => {
    return visibleRows.filter(r => r.recordIndex >= pageOffset && r.recordIndex < pageOffset + recordsPerPage);
  }, [visibleRows, pageOffset, recordsPerPage]);

  const paginatedIndices = useMemo(() => {
    return visibleRows.map((r, idx) => ({ r, idx })).filter(item => item.r.recordIndex >= pageOffset && item.r.recordIndex < pageOffset + recordsPerPage);
  }, [visibleRows, pageOffset, recordsPerPage]);

  const startRow = paginatedIndices.length > 0 ? paginatedIndices[0].idx + 1 : 0;
  const endRow = paginatedIndices.length > 0 ? paginatedIndices[paginatedIndices.length - 1].idx + 1 : 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / recordsPerPage));
  const currentPage = Math.floor(pageOffset / recordsPerPage) + 1;
  const shownRows = paginatedRows.length;

  useEffect(() => {
    setPageOffset(0);
    setModalAutoApprove(false);
  }, [openJob, changeFilter, confFilter]);

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
        subtitle="By Dataset jobs use sampling + A/D/M/V change tracking. By Source jobs are reviewed per source (full dump on schedule, or change monitoring with highlighted deltas)."
      />

      <div className="px-7 pb-8 space-y-4">
        {/* Realtime queue metrics — compact */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pending</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.pending}</div>
              <div className="text-[10.5px] text-warning">{queueMetrics.urgent} urgent</div>
            </div>
          </Card>
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Approved today</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.approvedToday}</div>
              <div className="text-[10.5px] text-success">incl. {queueMetrics.autoToday} auto</div>
            </div>
          </Card>
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Rejected today</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.rejectedToday}</div>
              <div className="text-[10.5px] text-muted-foreground">{queueMetrics.rejectRate}% reject</div>
            </div>
          </Card>
          <Card className="px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avg. confidence</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-[18px] font-semibold leading-none">{queueMetrics.avgConf}%</div>
              <div className="text-[10.5px] text-muted-foreground">across pending</div>
            </div>
          </Card>
        </div>



        {/* Tab / Filter selection bar */}
        <Card className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">Mode</span>
            {(["All", "By Dataset", "By Source"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModeFilter(m)}
                className={`px-3 py-1 rounded-md border text-[12px] ${modeFilter === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-secondary"}`}
              >
                {m} {m !== "All" && <span className="opacity-70">({allJobs.filter((j) => j.mode === m).length})</span>}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground ml-auto">{filteredJobs.length} of {allJobs.length} jobs · {filteredJobs.reduce((s, j) => s + j.rows, 0).toLocaleString()} rows</span>
          </div>
        </Card>

        {/* By Dataset jobs — ADMV sampling table */}
        {(modeFilter === "All" || modeFilter === "By Dataset") && filteredJobs.some((j) => j.mode === "By Dataset") && (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-[14px]">By Dataset — sampling review</h3>
              <p className="text-[12px] text-muted-foreground">Set sample % per job, click <strong>Apply</strong> to lock it, then <strong>Review</strong> to open the sampled grid with A/D/M/V change tracking.</p>
            </div>
            <div className="overflow-auto max-h-[500px] pb-32">
              <table className="w-full text-[12.5px]">
              <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0 z-10 dark:bg-secondary/80">
                <tr>
                  <th className="text-left px-3 py-2">Job</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-right px-3 py-2">Rows</th>
                  <th className="text-right px-3 py-2">Changed</th>
                  <th className="text-left px-3 py-2 w-64">Sample rate</th>
                  <th className="text-left px-3 py-2 w-48">Confidence filter</th>
                  <th className="text-left px-3 py-2 w-36">Status</th>
                  <th className="text-left px-3 py-2 w-28">Quality</th>
                  <th className="text-right px-3 py-2 w-28">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredJobs.filter((j) => j.mode === "By Dataset").map((j) => {
                  const rate = jobRates[j.id] ?? 2;
                  const applied = appliedRates[j.id] ?? 2;
                  const dirty = rate !== applied;
                  const sampled = Math.round((j.rows * rate) / 100);
                  const done = reviewed[j.id];
                  const sc = getJobScore(j.id);
                  return (
                    <tr
                      key={j.id}
                      id={`row-${j.id}`}
                      tabIndex={-1}
                      className={`hover:bg-secondary/40 focus:bg-secondary/80 focus:outline-none transition-colors duration-200 ${
                        j.id === selectedJobId ? "bg-info-bg/40 border-l-2 border-info/80" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-mono">{j.id}</td>
                      <td className="px-3 py-2 font-semibold">
                        {j.isDatasetJob ? (getAnySiteUploadedFilename(j.filters) || j.source) : j.source}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{j.rows.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right"><Badge tone={(j.changedPct ?? 0) > 20 ? "warning" : "info"}>{j.changedPct}%</Badge></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Select
                            value={rate}
                            onChange={(e) => setJobRates((s) => ({ ...s, [j.id]: Number(e.target.value) }))}
                            className="h-7 text-[12px] w-20"
                          >
                            {[1, 2, 5, 10].map((p) => <option key={p} value={p}>{p}%</option>)}
                          </Select>
                          <Button size="sm" variant={dirty ? "primary" : "outline"} onClick={() => applyRate(j.id)} disabled={!dirty}>
                            {dirty ? "Apply" : "Applied"}
                          </Button>
                          <span className="text-[11px] text-muted-foreground">≈ {sampled.toLocaleString()} rows</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 relative">
                        {(() => {
                          const limits = confLimits[j.id] || { min: 80, max: 100 };
                          const isOpen = activeConfJobId === j.id;
                          return (
                            <div className="relative inline-block text-left">
                              <button
                                type="button"
                                onClick={() => setActiveConfJobId(isOpen ? null : j.id)}
                                className="h-7 px-2.5 text-[12px] w-28 bg-card border border-border rounded flex items-center justify-between text-left cursor-pointer hover:bg-secondary select-none font-sans"
                              >
                                <span>{limits.min}% – {limits.max}%</span>
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
                                    <span className="mt-4 text-muted-foreground font-semibold">–</span>
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
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        {j.reviewStatus === "Completed" || reviewed[j.id] ? (
                          <Badge tone="success">Review completed</Badge>
                        ) : (
                          <Badge tone={(sc.approved + sc.rejected > 0) ? "info" : "warning"}>
                            {(sc.approved + sc.rejected > 0) ? "Review in progress" : "Review pending"}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2"><QualityCell score={sc} /></td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => { setOpenJob(j); setChangeFilter("all"); setConfFilter("all"); }}>
                          <Eye className="h-3.5 w-3.5" /> Review
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        )}

        {/* By Source jobs — source-centric review (full dump w/ schedule + change monitoring) */}
        {(modeFilter === "All" || modeFilter === "By Source") && filteredJobs.some((j) => j.mode === "By Source") && (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-[14px]">By Source — extraction review</h3>
              <p className="text-[12px] text-muted-foreground">
                Source-specific full dumps run on a schedule (weekly / monthly). Change-monitoring sources highlight what changed since last run.
              </p>
            </div>
            <div className="overflow-auto max-h-[500px] pb-32">
              <table className="w-full text-[12.5px]">
              <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0 z-10 dark:bg-secondary/80">
                <tr>
                  <th className="text-left px-3 py-2">Job</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-right px-3 py-2">Rows</th>
                  <th className="text-right px-3 py-2">Changes</th>
                  <th className="text-left px-3 py-2 w-44">Type</th>
                  <th className="text-left px-3 py-2 w-64">Sample rate</th>
                  <th className="text-left px-3 py-2 w-48">Confidence filter</th>
                  <th className="text-left px-3 py-2 w-36">Status</th>
                  <th className="text-left px-3 py-2 w-28">Quality</th>
                  <th className="text-right px-3 py-2 w-28">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredJobs.filter((j) => j.mode === "By Source").map((j) => {
                  const isCM = j.kind === "Change Monitoring";
                  const schedule = j.schedule || "Weekly";
                  const done = reviewed[j.id];
                  const rate = jobRates[j.id] ?? 2;
                  const applied = appliedRates[j.id] ?? 2;
                  const dirty = rate !== applied;
                  const sampled = Math.round((j.rows * rate) / 100);
                  const sc = getJobScore(j.id);
                  const isNew = j.changesText === "100% new";
                  return (
                    <tr
                      key={j.id}
                      id={`row-${j.id}`}
                      tabIndex={-1}
                      className={`hover:bg-secondary/40 focus:bg-secondary/80 focus:outline-none transition-colors duration-200 ${
                        j.id === selectedJobId ? "bg-info-bg/40 border-l-2 border-info/80" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-mono whitespace-pre-line leading-normal">
                        {j.id.includes("-") ? `${j.id.split("-")[0]}-\n${j.id.split("-")[1]}` : j.id}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-foreground">{j.source}</div>
                        <div className="text-[10.5px] text-muted-foreground mt-0.5">{j.domain}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{j.rows.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        {isNew ? (
                          <Badge tone="purple">100% new</Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <span className="font-bold text-warning">{j.changedPct}%</span>
                            <span className="text-[10.5px] text-muted-foreground">highlighted</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {kind === "Change Monitoring" && (
                          <Badge tone="warning">Change monitoring · {schedule}</Badge>
                        )}
                        {kind === "Full Scrape" && (
                          <Badge tone="purple">Full scrape · {schedule}</Badge>
                        )}
                        {kind === "Partial Scrape" && (
                          <Badge tone="purple">Partial scrape · {schedule}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Select
                            value={rate}
                            onChange={(e) => setJobRates((s) => ({ ...s, [j.id]: Number(e.target.value) }))}
                            className="h-7 text-[12px] w-20"
                          >
                            {[1, 2, 5, 10].map((p) => <option key={p} value={p}>{p}%</option>)}
                          </Select>
                          <Button size="sm" variant={dirty ? "primary" : "outline"} onClick={() => applyRate(j.id)} disabled={!dirty}>
                            {dirty ? "Apply" : "Applied"}
                          </Button>
                          <span className="text-[11px] text-muted-foreground">≈ {sampled.toLocaleString()} rows</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 relative">
                        {(() => {
                          const limits = confLimits[j.id] || { min: 80, max: 100 };
                          const isOpen = activeConfJobId === j.id;
                          return (
                            <div className="relative inline-block text-left">
                              <button
                                type="button"
                                onClick={() => setActiveConfJobId(isOpen ? null : j.id)}
                                className="h-7 px-2.5 text-[12px] w-28 bg-card border border-border rounded flex items-center justify-between text-left cursor-pointer hover:bg-secondary select-none font-sans"
                              >
                                <span>{limits.min}% – {limits.max}%</span>
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
                                    <span className="mt-4 text-muted-foreground font-semibold">–</span>
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
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        {j.reviewStatus === "Completed" || reviewed[j.id] ? (
                          <Badge tone="success">Review completed</Badge>
                        ) : (
                          <Badge tone={j.statusText === "Running" ? "info" : ((sc.approved + sc.rejected > 0) ? "info" : "warning")}>
                            {j.statusText === "Running" ? "Running" : ((sc.approved + sc.rejected > 0) ? "Review in progress" : "Review pending")}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2"><QualityCell score={sc} /></td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => { setOpenJob(j); setChangeFilter("all"); setConfFilter("all"); }} disabled={j.statusText === "Running"}>
                          <Eye className="h-3.5 w-3.5" /> Review
                        </Button>
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
              {openJob?.id} — {openJob ? (getAnySiteUploadedFilename(openJob.filters) || openJob.source) : ""}
            </DialogTitle>
          </DialogHeader>
          {openJob && (
            <div className="space-y-3">
              {!sample ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <span className="flex h-8 w-8 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-8 w-8 bg-primary/80"></span>
                  </span>
                  <span className="text-[13px] text-muted-foreground">Loading review data...</span>
                </div>
              ) : (
                <>
              <div className="flex items-center justify-between gap-3 flex-wrap text-[12px] text-muted-foreground">
                <div>
                  Sample <strong>{appliedRates[openJob.id] ?? 2}%</strong> = {sample.sampledCount.toLocaleString()} of {openJob.rows.toLocaleString()} rows.
                  Showing rows <strong>{startRow.toLocaleString()}–{endRow.toLocaleString()}</strong> · page {currentPage} of {totalPages}.
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pageOffset === 0}
                    onClick={() => setPageOffset((prev) => Math.max(0, prev - recordsPerPage))}
                    className="h-8 text-[11px] px-2.5"
                  >
                    ← Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pageOffset + recordsPerPage >= totalRecords}
                    onClick={() => setPageOffset((prev) => prev + recordsPerPage)}
                    className="h-8 text-[11px] px-2.5"
                  >
                    Next →
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 items-center">
                {openJob.isDatasetJob === false && openJob.kind === "Full Scrape" ? (
                  <>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">Change</span>
                    <Chip on={changeFilter === "all"} onClick={() => setChangeFilter("all")}>All</Chip>
                    <Chip on={changeFilter === "A"} onClick={() => setChangeFilter("A")} tone="success">Added · {counts.A}</Chip>
                  </>
                ) : (
                  <>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">A/D/M/V</span>
                    <Chip on={changeFilter === "all"} onClick={() => setChangeFilter("all")}>All</Chip>
                    <Chip on={changeFilter === "A"} onClick={() => setChangeFilter("A")} tone="success">A · {counts.A}</Chip>
                    <Chip on={changeFilter === "D"} onClick={() => setChangeFilter("D")} tone="destructive">D · {counts.D}</Chip>
                    <Chip on={changeFilter === "M"} onClick={() => setChangeFilter("M")} tone="warning">M · {counts.M}</Chip>
                    <Chip on={changeFilter === "V"} onClick={() => setChangeFilter("V")} tone="info">V · {counts.V}</Chip>
                  </>
                )}
                <span className="text-[11px] text-muted-foreground ml-auto">{visibleRows.length} rows shown</span>
              </div>

              {/* Bulk actions for current filter */}
              <div className="flex items-center gap-2 flex-wrap rounded-md border border-border bg-secondary/40 px-3 py-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Bulk</span>
                <span className="text-[10.5px] text-muted-foreground">
                  Applies to <strong>{visibleRows.length}</strong> rows in current filter
                  {changeFilter !== "all" && <> · <strong>{changeFilter}</strong> changes</>}
                </span>
                <label className="inline-flex items-center gap-1.5 text-[10.5px] cursor-pointer select-none ml-2">
                  <input
                    type="checkbox"
                    checked={modalAutoApprove}
                    onChange={(e) => setModalAutoApprove(e.target.checked)}
                    className="h-3.5 w-3.5 accent-success"
                  />
                  <Zap className="h-3 w-3 text-success" />
                  Auto-approve high conf (≥ 85%)
                </label>
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
                      <th className="text-left px-2.5 py-2 w-[7%]">ADMV</th>
                      <th className="text-left px-2.5 py-2 w-[10%]">Record</th>
                      <th className="text-left px-2.5 py-2 w-[13%]">Attribute</th>
                      <th className="text-left px-2.5 py-2 w-[25%]">Previous</th>
                      <th className="text-left px-2.5 py-2 w-[25%]">New value</th>
                      <th className="text-left px-2.5 py-2 w-[8%]">Conf.</th>
                      <th className="text-left px-2.5 py-2 w-[12%]">Source</th>
                      <th className="text-right px-2.5 py-2 w-[10%]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginatedRows.map((r) => {
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
                          <td className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground break-words whitespace-pre-wrap">{r.previous}</td>
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
                                <span className="break-words whitespace-pre-wrap">{r.value}</span>
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
