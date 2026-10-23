import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Activity, Database, CheckSquare, TrendingUp } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import { readJobsCache, writeJobsCache } from "@/lib/jobs-cache";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Freda" },
      {
        name: "description",
        content: "Active jobs, data quality and review status across all running workflows.",
      },
      { property: "og:title", content: "Dashboard — Freda" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Dashboard,
});

type Job = {
  id: string;
  source?: string;
  project?: string;
  mode?: string;
  status?: string;
  rows?: number;
  records?: number;
  created_at?: string;
  last_refresh?: string;
  next_refresh?: string;
  frequency?: string;
};

function statusTone(status?: string): "info" | "warning" | "success" | "destructive" | "neutral" {
  const s = String(status || "").trim();
  if (s === "Running") return "info";
  if (s === "Review" || s === "Review Pending") return "warning";
  if (s === "Completed" || s === "Execution Completed") return "success";
  if (s === "Failed") return "destructive";
  return "neutral";
}

function formatRelativeDate(value?: string) {
  if (!value) return "No date";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "No date";
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return "Just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "2-digit" });
}

function getJobLabel(job: Job) {
  return String(job.project || job.source || job.id || "Untitled").trim();
}

function getJobSource(job: Job) {
  return String(job.source || job.project || "—").trim();
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  progress,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "info" | "purple" | "warning" | "success";
  icon: typeof Activity;
  progress?: number;
}) {
  const toneClass =
    tone === "info"
      ? "bg-info-bg text-info"
      : tone === "purple"
        ? "bg-purple-bg text-purple-token"
        : tone === "success"
          ? "bg-success-bg text-success"
          : "bg-warning-bg text-warning";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
          <div className="text-[26px] font-semibold leading-tight mt-1">{value}</div>
          <div className="text-[11.5px] text-muted-foreground mt-0.5">{hint}</div>
        </div>
        <Badge tone={tone} className={`!p-2 ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </Badge>
      </div>
      {typeof progress === "number" && (
        <div className="mt-4 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full ${tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : tone === "purple" ? "bg-purple-token" : "bg-info"}`}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </Card>
  );
}

function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>(() => readJobsCache() as Job[]);

  const baseApiUrl = useMemo(() => {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port === "5433"
    ) {
      return `http://${window.location.hostname}:8000`;
    }
    return "";
  }, []);

  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            writeJobsCache(data);
            setJobs(readJobsCache() as Job[]);
          }
        }
      } catch {
        // Fall back to local cache if unavailable.
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [baseApiUrl]);

  const now = Date.now();

  const activeJobs = useMemo(
    () =>
      jobs.filter((job) => {
        const ts = Date.parse(job.last_refresh || job.created_at || "");
        return Number.isFinite(ts) && now - ts < 24 * 3600 * 1000;
      }).length,
    [jobs, now],
  );

  const recordsExtracted = useMemo(
    () => jobs.reduce((sum, job) => sum + (Number(job.rows || 0) || Number(job.records || 0) || 0), 0),
    [jobs],
  );

  const pendingReviews = useMemo(
    () => jobs.filter((job) => job.status === "Review Pending" || job.status === "Review").length,
    [jobs],
  );

  const freshness = useMemo(() => {
    if (!jobs.length) return 0;
    const fresh = jobs.filter((job) => {
      const ts = Date.parse(job.last_refresh || job.created_at || "");
      return Number.isFinite(ts) && now - ts <= 30 * 24 * 3600 * 1000;
    }).length;
    return Math.round((fresh / jobs.length) * 100);
  }, [jobs, now]);

  const sortedJobs = useMemo(
    () =>
      [...jobs]
        .sort((a, b) => {
          const ta = Date.parse(a.last_refresh || a.created_at || "0");
          const tb = Date.parse(b.last_refresh || b.created_at || "0");
          return tb - ta;
        })
        .slice(0, 20),
    [jobs],
  );

  function formatRecords(job: Job) {
    const n = Number(job.rows || 0) || Number(job.records || 0) || 0;
    if (!n) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  }

  function formatFreshness(job: Job) {
    const ts = Date.parse(job.last_refresh || job.created_at || "");
    if (!Number.isFinite(ts)) return "—";
    const ageDays = (now - ts) / (24 * 3600 * 1000);
    if (ageDays <= 1) return "Today";
    if (ageDays <= 7) return `${Math.floor(ageDays)}d ago`;
    if (ageDays <= 30) return `${Math.floor(ageDays)}d ago`;
    return "Stale";
  }

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        subtitle="Freda · active jobs, data quality and review across agents and solutions"
        actions={
          <Link to="/playbooks">
            <Button variant="outline" size="sm">
              <BookOpen className="h-4 w-4" />
              Playbooks
            </Button>
          </Link>
        }
      />

      <div className="px-7 pb-8 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            label="Active jobs"
            value={activeJobs.toLocaleString()}
            hint="refreshed in the last 24h"
            tone="info"
            icon={Activity}
          />
          <KpiCard
            label="Records extracted"
            value={
              recordsExtracted >= 1_000_000
                ? `${(recordsExtracted / 1_000_000).toFixed(1)}M`
                : recordsExtracted >= 1_000
                  ? `${(recordsExtracted / 1_000).toFixed(1)}K`
                  : recordsExtracted.toLocaleString()
            }
            hint={`${jobs.length.toLocaleString()} runs in scope`}
            tone="purple"
            icon={Database}
          />
          <KpiCard
            label="Pending reviews"
            value={pendingReviews.toLocaleString()}
            hint="runs awaiting sign-off"
            tone="warning"
            icon={CheckSquare}
          />
          <KpiCard
            label="Data freshness"
            value={`${freshness}%`}
            hint="refreshed within 30 days"
            tone="success"
            icon={TrendingUp}
            progress={freshness}
          />
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Review</div>
          <div className="text-[14px] font-semibold mt-0.5 mb-3">Review by agents and solutions</div>
          <ReviewWorkspace />
        </div>
      </div>
    </AppLayout>
  );
}
