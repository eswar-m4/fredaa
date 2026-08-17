import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpDown, CheckCheck, ChevronDown, Copy, Eye, FileJson2, FileText, RefreshCw, Search, User, Users, Activity } from "lucide-react";
import { toast } from "sonner";

import { AdminLayout } from "@/components/AdminLayout";
import { Badge, Button, Card, Input, Select } from "@/components/ui-bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, isAbortError } from "@/lib/api";

type AdminRequestRow = {
  id: string;
  job_id: string;
  request_type: string;
  source_kind?: string | null;
  source?: string | null;
  dataset_name?: string | null;
  mode?: string | null;
  scope?: string | null;
  username?: string | null;
  role?: string | null;
  display_name?: string | null;
  raw_payload?: Record<string, unknown>;
  planner_json?: Record<string, unknown>;
  planner_status?: string | null;
  request_status?: string | null;
  status_label?: string | null;
  job_status?: string | null;
  status_reason?: string | null;
  execution_metadata?: Record<string, unknown>;
  timeline?: Array<Record<string, unknown>>;
  created_at?: string | null;
  updated_at?: string | null;
  investigated?: boolean;
  investigated_at?: string | null;
  investigated_by?: string | null;
  investigated_notes?: string | null;
  decision_state?: string | null;
  decision_by?: string | null;
  decision_at?: string | null;
  decision_reason?: string | null;
};

type AdminSearch = {
  username?: string;
  view?: "requests" | "users";
};

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin Console - Freda" }] }),
  validateSearch: (search: Record<string, unknown>): AdminSearch => {
    return {
      username: search.username ? String(search.username) : undefined,
      view: (search.view === "requests" || search.view === "users") ? search.view : undefined,
    };
  },
  component: AdminConsole,
});

type RequestTypeFilter = "All" | "By Source" | "By Dataset";

type BotUploadPayload = {
  id: string;
  filename: string;
  storage_path: string;
  file_size?: number;
  format?: string;
  status?: string;
  message?: string;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatExactDateTime(value?: string | null) {
  if (!value) return "-";
  const raw = String(value).trim();
  const isoMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2})(?:T|\s)(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|([+-]\d{2}):?(\d{2}))?$/
  );
  let d: Date;
  if (isoMatch) {
    const [, datePart, hourPart, minutePart, secondPart, offsetHours, offsetMinutes] = isoMatch;
    const [year, month, day] = datePart.split("-").map(Number);
    const hour = Number(hourPart);
    const minute = Number(minutePart);
    const second = Number(secondPart || "0");

    if (raw.endsWith("Z") || offsetHours) {
      d = new Date(raw);
    } else {
      d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    }
  } else {
    d = new Date(raw);
  }
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(",", "");
}

function statusTone(status: string) {
  if (status === "Running") return "info" as const;
  if (status === "Completed") return "success" as const;
  if (status === "Review Pending" || status === "Awaiting Review") return "warning" as const;
  if (status === "Pending Approval" || status === "Pending Onboarding") return "warning" as const;
  if (status === "Rejected" || status === "Failed" || status === "Aborted" || status === "Unsupported Request" || status === "Needs Clarification") return "destructive" as const;
  return "neutral" as const;
}

function prettyPlannerStatus(value?: string | null) {
  if (!value) return "—";
  if (value === "supported") return "supported";
  if (value === "needs_clarification") return "needs clarification";
  if (value === "unsupported") return "unsupported";
  return value;
}

function matchesDateRange(createdAt?: string | null, from?: string, to?: string) {
  if (!createdAt) return true;
  const ts = new Date(createdAt).getTime();
  if (from) {
    const fromTs = new Date(from).getTime();
    if (!Number.isNaN(fromTs) && ts < fromTs) return false;
  }
  if (to) {
    const toTs = new Date(`${to}T23:59:59.999`).getTime();
    if (!Number.isNaN(toTs) && ts > toTs) return false;
  }
  return true;
}

function requestStatusLabel(row: AdminRequestRow) {
  const status = row.status_label || row.request_status || row.job_status || "Unknown";
  return status === "Failed" ? "Aborted" : status;
}

function payloadString(row: AdminRequestRow, ...keys: string[]) {
  const payload = (row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {}) as Record<string, unknown>;
  const metadata = (row.execution_metadata && typeof row.execution_metadata === "object" ? row.execution_metadata : {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  for (const key of keys) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function displaySourceSubtitle(row: AdminRequestRow) {
  if (row.request_type === "By Dataset") {
    return payloadString(row, "source_kind") || row.dataset_name || "Solution";
  }
  if (row.source_kind) {
    return row.source_kind === "Partial Scrape" ? "Custom Scrape" : row.source_kind;
  }
  return "Full Scrape";
}

function displaySourcePrimary(row: AdminRequestRow) {
  if (row.request_type === "By Dataset") {
    return payloadString(row, "seedFile", "seed_file", "filename", "file_name") || row.source || row.dataset_name || "?";
  }
  return payloadString(row, "source", "website_url", "source_name") || row.source || row.dataset_name || "?";
}

function isPresent(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function humanizeKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPayloadValue(row: AdminRequestRow, ...keys: string[]) {
  const payload = (row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {}) as Record<string, unknown>;
  const metadata = (row.execution_metadata && typeof row.execution_metadata === "object" ? row.execution_metadata : {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = payload[key];
    if (isPresent(value)) return value;
  }
  for (const key of keys) {
    const value = metadata[key];
    if (isPresent(value)) return value;
  }
  for (const key of keys) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (isPresent(value)) return value;
  }
  return undefined;
}

type DetailItem = {
  label: string;
  value: unknown;
};

function buildLaunchDetailItems(row: AdminRequestRow): DetailItem[] {
  const items: DetailItem[] = [
    { label: "Source", value: getPayloadValue(row, "source", "website_url", "source_name", "seedFile", "seed_file") || row.source || row.dataset_name },
    { label: "Mode", value: getPayloadValue(row, "mode") || row.mode },
    { label: "Scope", value: getPayloadValue(row, "scope") || row.scope },
    { label: "Frequency", value: getPayloadValue(row, "frequency") || row.execution_metadata?.frequency },
    { label: "Output Format", value: getPayloadValue(row, "output_format", "outputFormat") || row.execution_metadata?.output_format },
    { label: "Prompt", value: getPayloadValue(row, "prompt", "custom_criteria") },
    { label: "End URLs", value: getPayloadValue(row, "end_urls", "endUrls", "urls") },
    { label: "Files", value: getPayloadValue(row, "files", "seed_file", "seedFile", "file_name", "filename") },
  ];

  const payload = (row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {}) as Record<string, unknown>;
  const seen = new Set(items.map((item) => item.label.toLowerCase()));
  for (const [key, value] of Object.entries(payload)) {
    const label = humanizeKey(key);
    if (seen.has(label.toLowerCase()) || !isPresent(value)) continue;
    items.push({ label, value });
  }

  return items.filter((item) => isPresent(item.value));
}

function buildExecutionMetadataItems(row: AdminRequestRow): DetailItem[] {
  const metadata = (row.execution_metadata && typeof row.execution_metadata === "object" ? row.execution_metadata : {}) as Record<string, unknown>;
  const items: DetailItem[] = [
    { label: "Delivery", value: getPayloadValue(row, "delivery") || row.execution_metadata?.delivery },
    { label: "Records", value: getPayloadValue(row, "records", "record_count", "estimated_records") || row.execution_metadata?.records },
    { label: "Next Refresh", value: getPayloadValue(row, "next_refresh") || row.execution_metadata?.next_refresh },
    { label: "Changes Detected", value: getPayloadValue(row, "changes_detected") || row.execution_metadata?.changes_detected },
    { label: "Source Kind", value: getPayloadValue(row, "source_kind") || row.source_kind },
    { label: "Status Reason", value: row.status_reason },
    { label: "Planner Result", value: row.planner_status },
    { label: "Decision State", value: row.decision_state },
    { label: "Decision By", value: row.decision_by },
    { label: "Decision At", value: row.decision_at },
    { label: "Bot Uploaded By", value: getPayloadValue(row, "bot_uploaded_by") },
    { label: "Bot Uploaded At", value: getPayloadValue(row, "bot_uploaded_at") },
  ];

  const seen = new Set(items.map((item) => item.label.toLowerCase()));
  for (const [key, value] of Object.entries(metadata)) {
    const label = humanizeKey(key);
    if (seen.has(label.toLowerCase()) || !isPresent(value)) continue;
    items.push({ label, value });
  }

  return items.filter((item) => isPresent(item.value));
}

function extractShortExecutionError(value: unknown) {
  if (!isPresent(value)) return "";
  const text = String(value).trim();
  if (!text) return "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*Error:\s+/.test(line) || /^[A-Za-z_][A-Za-z0-9_]*Exception:\s+/.test(line)) {
      return line;
    }
  }
  return lines[lines.length - 1] || text;
}

function buildExecutionErrorDetails(row: AdminRequestRow) {
  const metadata = (row.execution_metadata && typeof row.execution_metadata === "object" ? row.execution_metadata : {}) as Record<string, unknown>;
  const failureStage = String(metadata.bot_failure_stage || row.status_reason || "Execution").trim() || "Execution";
  const errorType = String(metadata.bot_error_type || "").trim() || "—";
  const shortMessage =
    extractShortExecutionError(metadata.bot_error_message) ||
    extractShortExecutionError(metadata.bot_stderr) ||
    extractShortExecutionError(row.status_reason) ||
    "—";
  const fullTrace =
    String(metadata.bot_stderr || metadata.bot_error_traceback || metadata.bot_error_message || row.status_reason || "").trim();

  return {
    failureStage: failureStage.charAt(0).toUpperCase() + failureStage.slice(1),
    errorType,
    shortMessage,
    fullTrace,
  };
}

function formatCompactValue(value: unknown): ReactNode {
  if (!isPresent(value)) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="break-words text-foreground">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border border-border bg-background/50 px-2.5 py-1 text-[12px] break-words text-foreground">
            {formatCompactValue(item)}
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1">
      {entries.map(([key, nestedValue]) => (
        <div key={key} className="grid gap-1 rounded-md border border-border bg-background/40 px-2.5 py-2">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{humanizeKey(key)}</div>
          <div className="text-[12px] leading-5 text-foreground break-words">{formatCompactValue(nestedValue)}</div>
        </div>
      ))}
    </div>
  );
}

function InfoCard({ title, items }: { title: string; items: DetailItem[] }) {
  const [open, setOpen] = useState(true);
  return (
    <Card className="border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-border bg-secondary/20 px-4 py-3 text-left transition hover:bg-secondary/40"
      >
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {items.length === 0 ? (
            <div className="col-span-full text-sm text-muted-foreground">No details available.</div>
          ) : (
            items.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
                <div className="mt-1.5 text-sm leading-6 text-foreground">{formatCompactValue(item.value)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}

function TimelineEntryCard({ entry, index }: { entry: Record<string, unknown>; index: number }) {
  const [open, setOpen] = useState(false);
  const timestamp = formatDate(typeof entry.timestamp === "string" ? entry.timestamp : undefined);
  const title = String(entry.event || entry.action || entry.type || entry.state || `Event ${index + 1}`);
  const detail =
    entry.message ||
    entry.detail ||
    entry.reason ||
    entry.notes ||
    entry.status ||
    entry.description ||
    "";

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{title}</div>
          {detail ? <div className="mt-1 text-xs text-muted-foreground">{String(detail)}</div> : null}
        </div>
        <div className="text-xs text-muted-foreground">{timestamp}</div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-info hover:underline"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        View details
      </button>
      {open && (
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-md border border-border bg-card px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          {JSON.stringify(entry, null, 2)}
        </pre>
      )}
    </div>
  );
}

function TimelineSectionCard({ entries }: { entries: Array<Record<string, unknown>> }) {
  const [open, setOpen] = useState(true);
  return (
    <Card className="border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-border bg-secondary/20 px-4 py-3 text-left transition hover:bg-secondary/40"
      >
        <div className="text-sm font-semibold text-foreground">Timeline</div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="space-y-3 p-4">
          {entries.length === 0 ? (
            <div className="text-sm text-muted-foreground">No timeline entries available.</div>
          ) : (
            entries.map((entry, index) => (
              <TimelineEntryCard
                key={`${String(entry.event || entry.action || entry.type || entry.state || index)}-${index}`}
                entry={entry}
                index={index}
              />
            ))
          )}
        </div>
      )}
    </Card>
  );
}

function JsonBlock({
  title,
  value,
  action,
  emptyMessage,
}: {
  title: string;
  value: unknown;
  action?: ReactNode;
  emptyMessage?: string;
}) {
  const isEmptyObject =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0;

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
        {action}
      </div>
      {emptyMessage && isEmptyObject ? (
        <div className="mt-3 text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <pre className="mt-3 max-h-[380px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/40 p-4 font-mono text-xs leading-6 text-foreground">
          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </Card>
  );
}

function ExecutionErrorCard({ row }: { row: AdminRequestRow }) {
  const [showTrace, setShowTrace] = useState(false);
  const details = buildExecutionErrorDetails(row);
  return (
    <Card className="border-destructive/20 bg-destructive/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setShowTrace((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-left transition hover:bg-destructive/10"
      >
        <div>
          <div className="text-sm font-semibold text-destructive">Execution Error</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Why the production bot failed to complete.</div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showTrace ? "rotate-180" : ""}`} />
      </button>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Execution Status</div>
          <div className="mt-1.5 text-sm font-semibold text-destructive">Aborted</div>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Failure Stage</div>
          <div className="mt-1.5 text-sm text-foreground">{details.failureStage}</div>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Error Type</div>
          <div className="mt-1.5 text-sm text-foreground">{details.errorType}</div>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Message</div>
          <div className="mt-1.5 text-sm leading-6 text-foreground">{details.shortMessage}</div>
        </div>
        {showTrace && details.fullTrace ? (
          <div className="col-span-full rounded-lg border border-border bg-background/50 p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Full Trace</div>
            <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card px-3 py-2 font-mono text-[11px] leading-5 text-foreground">
              {details.fullTrace}
            </pre>
          </div>
        ) : null}
        <div className="col-span-full">
          <Button
            type="button"
            variant="secondary"
            className="bg-secondary text-foreground hover:bg-accent"
            onClick={() => setShowTrace((current) => !current)}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showTrace ? "rotate-180" : ""}`} />
            {showTrace ? "Hide Full Trace" : "Show Full Trace"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type UserSummaryItem = {
  username: string;
  display_name: string;
  role: string;
  totalRequests: number;
  runningRequests: number;
  completedRequests: number;
  failedRequests: number;
  lastActive: string | null;
};

function AdminConsole() {
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const activeUsername = searchParams.username;
  const activeTab = searchParams.view || "requests";

  const [typeFilter, setTypeFilter] = useState<RequestTypeFilter>("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [selected, setSelected] = useState<AdminRequestRow | null>(null);
  const [detailMode, setDetailMode] = useState<"overview" | "payload" | "planner">("overview");
  const [rows, setRows] = useState<AdminRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [onboardRow, setOnboardRow] = useState<AdminRequestRow | null>(null);
  const [onboardNotes, setOnboardNotes] = useState("");
  const [onboardPackage, setOnboardPackage] = useState<File | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [onboardPhase, setOnboardPhase] = useState<"idle" | "uploading" | "launching">("idle");

  useEffect(() => {
    let active = true;
    async function loadRequests() {
      setIsFetching(true);
      setError("");
      try {
        const response = await apiFetch(`/api/v1/admin/requests?limit=1000&t=${Date.now()}`, { timeoutMs: 10000, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            navigate({ to: "/login", search: { next: "/admin" }, replace: true });
            return;
          }
          throw new Error(body?.detail || body?.message || "Failed to load admin requests");
        }
        if (active) {
          setRows((body?.requests ?? []) as AdminRequestRow[]);
        }
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load admin requests");
        }
      } finally {
        if (active) {
          setLoading(false);
          setIsFetching(false);
        }
      }
    }

    void loadRequests();
    const interval = setInterval(() => {
      void loadRequests();
    }, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [navigate]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const rowStatus = requestStatusLabel(row);
      if (typeFilter !== "All" && row.request_type !== typeFilter) return false;
      if (statusFilter !== "All" && rowStatus !== statusFilter) return false;
      if (query) {
        const haystack = [
          row.id,
          row.job_id,
          row.request_type,
          row.source,
          row.dataset_name,
          row.username,
          row.display_name,
          row.role,
          rowStatus,
          row.planner_status,
          row.status_reason,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return matchesDateRange(row.created_at, fromDate, toDate);
    });
  }, [rows, typeFilter, statusFilter, searchQuery, fromDate, toDate]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const aTs = new Date(a.created_at || a.updated_at || 0).getTime();
      const bTs = new Date(b.created_at || b.updated_at || 0).getTime();
      return sortNewestFirst ? bTs - aTs : aTs - bTs;
    });
  }, [filteredRows, sortNewestFirst]);

  const visibleRows = useMemo(() => {
    return onlyUnreviewed ? sortedRows.filter((row) => !row.investigated) : sortedRows;
  }, [sortedRows, onlyUnreviewed]);

  const usersSummary = useMemo(() => {
    const map = new Map<string, UserSummaryItem>();
    for (const row of rows) {
      const uname = row.username || "unknown";
      const existing = map.get(uname);
      const status = requestStatusLabel(row);
      const createdAt = row.created_at || row.updated_at || null;

      if (existing) {
        existing.totalRequests += 1;
        if (status === "Running") existing.runningRequests += 1;
        else if (status === "Completed") existing.completedRequests += 1;
        else if (status === "Failed" || status === "Aborted") existing.failedRequests += 1;
        
        if (createdAt && (!existing.lastActive || new Date(createdAt) > new Date(existing.lastActive))) {
          existing.lastActive = createdAt;
        }
      } else {
        map.set(uname, {
          username: uname,
          display_name: row.display_name || uname,
          role: row.role || "user",
          totalRequests: 1,
          runningRequests: status === "Running" ? 1 : 0,
          completedRequests: status === "Completed" ? 1 : 0,
          failedRequests: (status === "Failed" || status === "Aborted") ? 1 : 0,
          lastActive: createdAt,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalRequests - a.totalRequests);
  }, [rows]);

  const activeUserObj = useMemo(() => {
    if (!activeUsername) return null;
    return usersSummary.find((u) => u.username === activeUsername) || {
      username: activeUsername,
      display_name: activeUsername,
      role: "user",
      totalRequests: 0,
      runningRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      lastActive: null,
    };
  }, [usersSummary, activeUsername]);

  const userFilteredRows = useMemo(() => {
    if (!activeUsername) return visibleRows;
    return visibleRows.filter((row) => (row.username || "unknown") === activeUsername);
  }, [visibleRows, activeUsername]);

  const displayedRows = activeUsername ? userFilteredRows : visibleRows;

  const bySource = displayedRows.filter((row) => row.request_type === "By Source");
  const byDataset = displayedRows.filter((row) => row.request_type === "By Dataset");
  const pendingBySource = bySource.filter((row) => {
    const status = requestStatusLabel(row);
    return status === "Pending Onboarding" || status === "Pending Approval";
  });

  const summary = useMemo(() => {
    const bucket = {
      total_requests: displayedRows.length,
      running: 0,
      completed: 0,
      aborted: 0,
      unsupported: 0,
      needs_clarification: 0,
      awaiting_review: 0,
      refreshing: 0,
    };
    for (const row of displayedRows) {
      const status = requestStatusLabel(row);
      if (status === "Running") bucket.running += 1;
      if (status === "Completed") bucket.completed += 1;
      if (status === "Failed" || status === "Aborted") bucket.aborted += 1;
      if (status === "Refreshing") bucket.refreshing += 1;
      if (status === "Review Pending" || status === "Awaiting Review") bucket.awaiting_review += 1;
      if ((row.planner_status || "").toLowerCase() === "unsupported") bucket.unsupported += 1;
      if ((row.planner_status || "").toLowerCase() === "needs_clarification") bucket.needs_clarification += 1;
    }
    return bucket;
  }, [displayedRows]);

  function syncSelectedRow(updatedRow: AdminRequestRow) {
    setRows((current) => current.map((row) => (row.id === updatedRow.id ? updatedRow : row)));
    setSelected((current) => (current?.id === updatedRow.id ? updatedRow : current));
  }

  async function markInvestigated(requestId: string) {
    try {
      const response = await apiFetch(`/api/v1/admin/requests/${requestId}/investigated`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "Reviewed in admin console" }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail || body?.message || "Failed to mark investigated");
      }
      toast.success("Marked investigated");
      syncSelectedRow(body.request as AdminRequestRow);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update request");
    }
  }

  async function onboardBot(row: AdminRequestRow) {
    try {
      setOnboardBusy(true);
      setOnboardPhase("uploading");
      if (!onboardPackage) {
        throw new Error("Select a bot zip package before onboarding");
      }

      const formData = new FormData();
      formData.append("file", onboardPackage);
      const uploadResponse = await apiFetch("/api/v1/bot-packages/upload", {
        method: "POST",
        body: formData,
      });
      const uploadBody = await uploadResponse.json();
      if (!uploadResponse.ok) {
        throw new Error(uploadBody?.detail || uploadBody?.message || `Upload failed for ${onboardPackage.name}`);
      }

      const uploadPayload: BotUploadPayload = {
        id: String(uploadBody.id || ""),
        filename: String(uploadBody.filename || onboardPackage.name),
        storage_path: String(uploadBody.storage_path || ""),
        file_size: Number(uploadBody.file_size || onboardPackage.size || 0),
        format: String(uploadBody.format || "zip"),
        status: String(uploadBody.status || "processed"),
        message: uploadBody.message ? String(uploadBody.message) : undefined,
      };
      if (!uploadPayload.storage_path) {
        throw new Error("Bot package upload completed without a storage path");
      }

      setOnboardPhase("launching");
      const response = await apiFetch(`/api/v1/admin/requests/${row.id}/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: onboardNotes,
          uploads: [uploadPayload],
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail || body?.message || "Failed to onboard bot");
      }
      toast.success("Bot onboarding saved");
      syncSelectedRow(body.request as AdminRequestRow);
      setOnboardRow(null);
      setOnboardNotes("");
      setOnboardPackage(null);
      setOnboardPhase("idle");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to onboard bot");
      setOnboardPhase("idle");
    } finally {
      setOnboardBusy(false);
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {activeUsername ? (
          /* USER SUBPAGE HEADER */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                onClick={() => navigate({ to: "/admin", search: (prev: any) => ({ ...prev, username: undefined }) })}
                className="gap-2 bg-secondary text-foreground hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Admin Console
              </Button>
            </div>

            {activeUserObj && (
              <Card className="border-border bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-info-bg border border-info/30 flex items-center justify-center text-xl font-bold text-info uppercase">
                      {activeUserObj.display_name.charAt(0) || activeUserObj.username.charAt(0) || "U"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-foreground">{activeUserObj.display_name}</h2>
                        <Badge tone="info">{activeUserObj.role}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        @{activeUserObj.username} • Last active: {formatDate(activeUserObj.lastActive)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="neutral" className="text-xs py-1.5 px-3 font-medium">
                      {activeUserObj.totalRequests} User Request{activeUserObj.totalRequests === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </div>
              </Card>
            )}
          </div>
        ) : (
          /* MAIN CONSOLE TOP TABS */
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Button
                variant={activeTab === "requests" ? "primary" : "secondary"}
                size="sm"
                onClick={() => navigate({ to: "/admin", search: (prev: any) => ({ ...prev, view: "requests" }) })}
                className="gap-2"
              >
                <Activity className="h-4 w-4" />
                All Requests ({summary.total_requests})
              </Button>
              <Button
                variant={activeTab === "users" ? "primary" : "secondary"}
                size="sm"
                onClick={() => navigate({ to: "/admin", search: (prev: any) => ({ ...prev, view: "users" }) })}
                className="gap-2"
              >
                <Users className="h-4 w-4" />
                Users Directory ({usersSummary.length})
              </Button>
            </div>
          </div>
        )}

        {/* STATS ROW (Rendered for Requests view or User subpage) */}
        {(activeUsername || activeTab === "requests") && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminStatCard label="Total requests" value={summary.total_requests} tone="cyan" />
            <AdminStatCard label="Running" value={summary.running} tone="blue" />
            <AdminStatCard label="Completed" value={summary.completed} tone="emerald" />
            <AdminStatCard label="Aborted" value={summary.aborted} tone="rose" />
            <AdminStatCard label="Unsupported" value={summary.unsupported} tone="amber" />
            <AdminStatCard label="Needs clarification" value={summary.needs_clarification} tone="amber" />
            <AdminStatCard label="Awaiting review" value={summary.awaiting_review} tone="violet" />
            <AdminStatCard label="Refreshing" value={summary.refreshing} tone="cyan" />
          </div>
        )}

        {/* USERS DIRECTORY VIEW */}
        {!activeUsername && activeTab === "users" && (
          <UserDirectoryTable
            users={usersSummary}
            onSelectUser={(uname) => navigate({ to: "/admin", search: (prev: any) => ({ ...prev, username: uname }) })}
          />
        )}

        {/* REQUESTS VIEW (Either Common Requests tab or User Subpage Requests) */}
        {(activeUsername || activeTab === "requests") && (
          <>
            <Card className="border-border bg-card p-4">
              <div className="grid gap-3 lg:grid-cols-5">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Request type</div>
                  <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as RequestTypeFilter)} className="h-10 bg-background border-input text-foreground">
                    <option value="All">All</option>
                    <option value="By Source">Agents</option>
                    <option value="By Dataset">Solutions</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</div>
                  <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 bg-background border-input text-foreground">
                    {["All", "Running", "Completed", "Aborted", "Review Pending", "Awaiting Review", "Pending Approval", "Pending Onboarding", "Rejected", "Unsupported Request", "Needs Clarification", "Planner Rejected", "Refreshing"].map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Search</div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-10 bg-background border-input pl-9 text-foreground"
                      placeholder="Source, user, job id, status"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">From</div>
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 bg-background border-input text-foreground" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">To</div>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-10 bg-background border-input text-foreground" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={sortNewestFirst ? "bg-secondary text-foreground" : "bg-background text-muted-foreground"}
                  onClick={() => setSortNewestFirst((current) => !current)}
                >
                  <ArrowUpDown className="h-4 w-4" />
                  {sortNewestFirst ? "Newest first" : "Oldest first"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={onlyUnreviewed ? "bg-warning-bg text-foreground" : "bg-background text-muted-foreground"}
                  onClick={() => setOnlyUnreviewed((current) => !current)}
                >
                  {onlyUnreviewed ? "Showing only unreviewed" : "Show only unreviewed"}
                </Button>
              </div>
              <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
                <RefreshCw className={["h-3.5 w-3.5", isFetching ? "animate-spin text-primary" : "text-muted-foreground"].join(" ")} />
                Polling live request state every few seconds.
              </div>
            </Card>

            {loading && (
              <Card className="border-border bg-card p-4 text-sm text-muted-foreground">
                Loading admin requests...
              </Card>
            )}

            {error && (
              <Card className="border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                {error}
              </Card>
            )}

            {(typeFilter === "All" || typeFilter === "By Source") && (
              <div className="space-y-4">
                <RequestTable
                  title={activeUsername ? `Agent requests for @${activeUsername}` : "Agent requests"}
                  rows={bySource}
                  headerRight={pendingBySource.length > 0 ? <Badge tone="warning">{pendingBySource.length} pending onboarding</Badge> : undefined}
                  onViewSummary={(row) => {
                    setSelected(row);
                    setDetailMode("overview");
                  }}
                  onSelectUser={(uname) => navigate({ to: "/admin", search: (prev: any) => ({ ...prev, username: uname }) })}
                />
              </div>
            )}

            {(typeFilter === "All" || typeFilter === "By Dataset") && (
              <RequestTable
                title={activeUsername ? `Solution requests for @${activeUsername}` : "Solution requests"}
                rows={byDataset}
                onViewSummary={(row) => {
                  setSelected(row);
                  setDetailMode("overview");
                }}
                onSelectUser={(uname) => navigate({ to: "/admin", search: (prev: any) => ({ ...prev, username: uname }) })}
              />
            )}
          </>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background border-border text-foreground">
          <DialogHeader className="text-left pr-8">
            <DialogTitle className="text-foreground">{selected ? displaySourcePrimary(selected) : "Request details"}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Request {selected?.id} · Job {selected?.job_id}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone={statusTone(requestStatusLabel(selected))}>{requestStatusLabel(selected)}</Badge>
                <Badge tone="neutral">{prettyPlannerStatus(selected.planner_status)}</Badge>
                <Badge tone="neutral">{selected.request_type}</Badge>
                <Badge tone="neutral">{selected.investigated ? "Investigated" : "Open"}</Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Card className="border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">User</div>
                  <div className="mt-2 text-sm font-semibold">{selected.display_name || selected.username || "—"}</div>
                  <div className="text-xs text-muted-foreground">{selected.username || "—"} · {selected.role || "—"}</div>
                </Card>
                <Card className="border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Timing</div>
                  <div className="mt-2 text-sm font-semibold">{formatExactDateTime(selected.created_at)}</div>
                  <div className="text-xs text-muted-foreground">Updated {formatExactDateTime(selected.updated_at)}</div>
                </Card>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setDetailMode("overview")}>
                  <Eye className="h-4 w-4" />
                  Overview
                </Button>
                <Button variant="secondary" onClick={() => setDetailMode("payload")}>
                  <FileText className="h-4 w-4" />
                  Raw payload
                </Button>
                <Button variant="secondary" onClick={() => setDetailMode("planner")}>
                  <FileJson2 className="h-4 w-4" />
                  Planner JSON
                </Button>
                {selected.request_type === "By Source" && (selected.request_status === "Pending Onboarding" || displaySourceSubtitle(selected) !== "Full Scrape") && (
                  <>
                    <Button
                      variant="secondary"
                      className="bg-secondary text-foreground hover:bg-accent"
                      onClick={() => {
                        setOnboardNotes("");
                        setOnboardPackage(null);
                        setOnboardRow(selected);
                      }}
                    >
                      Onboard bot
                    </Button>
                  </>
                )}
                {!selected.investigated && (
                  <Button
                    className=""
                    onClick={() => void markInvestigated(selected.id)}
                  >
                    <CheckCheck className="h-4 w-4" />
                    Mark investigated
                  </Button>
                )}
              </div>

              {detailMode === "overview" && (
                <div key={selected.id} className="space-y-4">
                  <InfoCard title="Launch Details" items={buildLaunchDetailItems(selected)} />
                  {(requestStatusLabel(selected) === "Failed" || requestStatusLabel(selected) === "Aborted" || selected.job_status === "Failed" || selected.job_status === "Aborted") && (
                    <ExecutionErrorCard row={selected} />
                  )}
                  <InfoCard title="Execution Metadata" items={buildExecutionMetadataItems(selected)} />
                  <TimelineSectionCard entries={selected.timeline || []} />
                </div>
              )}
              {detailMode === "payload" && (
                <JsonBlock
                  title="Raw request payload"
                  value={selected.raw_payload || {}}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-secondary text-foreground hover:bg-accent"
                      onClick={() => void copyJsonToClipboard(selected.raw_payload || {}, "Raw payload")}
                    >
                      <Copy className="h-4 w-4" />
                      Copy JSON
                    </Button>
                  }
                />
              )}

              {detailMode === "planner" && (
                <JsonBlock
                  title="Planner JSON"
                  value={selected.planner_json || {}}
                  emptyMessage="No planner output was generated for this request."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-secondary text-foreground hover:bg-accent"
                      onClick={() => void copyJsonToClipboard(selected.planner_json || {}, "Planner JSON")}
                    >
                      <Copy className="h-4 w-4" />
                      Copy JSON
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!onboardRow} onOpenChange={(open) => {
        if (!open) {
          setOnboardRow(null);
          setOnboardNotes("");
          setOnboardPackage(null);
        }
      }}>
        <DialogContent className="max-w-2xl bg-background border-border text-foreground">
          <DialogHeader className="text-left pr-8">
            <DialogTitle className="text-foreground">Onboard bot</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Upload a zip package and notes for {onboardRow ? displaySourcePrimary(onboardRow) : "this request"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Notes</label>
              <Input
                value={onboardNotes}
                onChange={(e) => setOnboardNotes(e.target.value)}
                placeholder="Optional onboarding notes"
                className="bg-background border-input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Bot script package</label>
              <Input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setOnboardPackage(e.target.files?.[0] || null)}
                className="bg-background border-input"
              />
              <div className="text-xs text-muted-foreground">
                {onboardPackage ? `${onboardPackage.name} selected` : "No script package selected"}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setOnboardRow(null);
                  setOnboardNotes("");
                  setOnboardPackage(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (onboardRow) {
                    void onboardBot(onboardRow);
                  }
                }}
                disabled={onboardBusy || !onboardPackage}
              >
                {onboardPhase === "uploading" ? "Uploading..." : onboardPhase === "launching" ? "Launching..." : "Upload package"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function AdminStatCard({ label, value, tone }: { label: string; value: number; tone: "cyan" | "blue" | "emerald" | "rose" | "amber" | "violet" }) {
  const toneMap: Record<"cyan" | "blue" | "emerald" | "rose" | "amber" | "violet", string> = {
    cyan: "from-info-bg to-card border-border text-foreground",
    blue: "from-secondary to-card border-border text-foreground",
    emerald: "from-success-bg to-card border-border text-foreground",
    rose: "from-destructive/10 to-card border-border text-foreground",
    amber: "from-warning-bg to-card border-border text-foreground",
    violet: "from-purple-bg to-card border-border text-foreground",
  };
  return (
    <Card className={`border bg-gradient-to-br p-4 ${toneMap[tone]}`}>
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-foreground">{value}</div>
    </Card>
  );
}

function RequestTable({
  title,
  rows,
  headerRight,
  onViewSummary,
  onSelectUser,
}: {
  title: string;
  rows: AdminRequestRow[];
  headerRight?: ReactNode;
  onViewSummary: (row: AdminRequestRow) => void;
  onSelectUser?: (username: string) => void;
}) {
  return (
    <Card className="border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{rows.length} request{rows.length === 1 ? "" : "s"}</div>
        </div>
        {headerRight}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card text-muted-foreground text-[11px] uppercase tracking-[0.18em]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Request id</th>
              <th className="px-4 py-3 text-left font-semibold">User</th>
              <th className="px-4 py-3 text-left font-semibold">Source</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Planner</th>
              <th className="px-4 py-3 text-left font-semibold">Created</th>
              <th className="px-4 py-3 text-left font-semibold">Updated</th>
              <th className="px-4 py-3 text-left font-semibold">Job correlation</th>
              <th className="px-4 py-3 text-left font-semibold">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  No requests match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-card">
                  <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">{row.id}</td>
                  <td className="px-4 py-3">
                    {onSelectUser && row.username ? (
                      <button
                        type="button"
                        onClick={() => onSelectUser(row.username!)}
                        className="text-left group hover:opacity-80 transition"
                      >
                        <div className="font-medium text-foreground group-hover:text-info flex items-center gap-1">
                          <span>{row.display_name || row.username || "—"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{row.role || "—"} · @{row.username}</div>
                      </button>
                    ) : (
                      <>
                        <div className="font-medium text-foreground">{row.display_name || row.username || "—"}</div>
                        <div className="text-xs text-muted-foreground">{row.role || "—"} · {row.username || "—"}</div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{displaySourcePrimary(row)}</div>
                    <div className="text-xs text-muted-foreground">{displaySourceSubtitle(row)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(requestStatusLabel(row))}>{requestStatusLabel(row)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{prettyPlannerStatus(row.planner_status)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatExactDateTime(row.created_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatExactDateTime(row.updated_at)}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">{row.job_id}</td>
                  <td className="px-4 py-3">
                    <Button variant="secondary" size="sm" className="bg-secondary text-foreground hover:bg-accent" onClick={() => onViewSummary(row)}>
                      View summary
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UserDirectoryTable({
  users,
  onSelectUser,
}: {
  users: UserSummaryItem[];
  onSelectUser: (username: string) => void;
}) {
  return (
    <Card className="border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="text-sm font-semibold text-foreground">Registered & Active Users</div>
          <div className="text-xs text-muted-foreground">{users.length} user{users.length === 1 ? "" : "s"} found</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card text-muted-foreground text-[11px] uppercase tracking-[0.18em]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">User</th>
              <th className="px-4 py-3 text-left font-semibold">Role</th>
              <th className="px-4 py-3 text-left font-semibold">Total Requests</th>
              <th className="px-4 py-3 text-left font-semibold">Running</th>
              <th className="px-4 py-3 text-left font-semibold">Completed</th>
              <th className="px-4 py-3 text-left font-semibold">Aborted</th>
              <th className="px-4 py-3 text-left font-semibold">Last Activity</th>
              <th className="px-4 py-3 text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {users.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No users recorded yet.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.username} className="hover:bg-card">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-info-bg border border-info/30 flex items-center justify-center font-bold text-info text-xs uppercase">
                        {user.display_name.charAt(0) || user.username.charAt(0) || "U"}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{user.display_name}</div>
                        <div className="text-xs text-muted-foreground">@{user.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="info">{user.role}</Badge>
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground">{user.totalRequests}</td>
                  <td className="px-4 py-3">
                    {user.runningRequests > 0 ? (
                      <Badge tone="info">{user.runningRequests} running</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-emerald-500 font-medium">
                    {user.completedRequests}
                  </td>
                  <td className="px-4 py-3 text-rose-500 font-medium">
                    {user.failedRequests}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatExactDateTime(user.lastActive)}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-secondary text-foreground hover:bg-accent gap-1.5"
                      onClick={() => onSelectUser(user.username)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View User Activity
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function copyJsonToClipboard(value: unknown, label: string) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Unable to copy ${label.toLowerCase()}`);
  }
}
