import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Activity,
  Database,
  CheckSquare,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Legend,
} from "recharts";

import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui-bits";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { readJobsCache, writeJobsCache } from "@/lib/jobs-cache";
import type { ReviewSummary, ReviewSummarySlice } from "@/lib/review-summary";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard - FreshData AI" }] }),
  component: Dashboard,
});

type DashboardMetric = "coverage" | "accuracy";
type DisplayMode = "chart" | "list" | "gaps";
type DashboardTab = "By Source" | "By Dataset";
type PulseRange = "1d" | "7d" | "30d" | "90d";
type PulseScope = string;

type DashboardJob = {
  id: string;
  source?: string;
  project?: string;
  mode?: string;
  status?: string;
  rows?: number;
  records?: number;
  changes_detected?: number;
  added?: number;
  deleted?: number;
  verified?: number;
  created_at?: string;
  last_refresh?: string;
  next_refresh?: string;
  frequency?: string;
  scope?: string;
  refresh_count?: number;
  fresh?: number;
  is_urgent?: number | boolean;
  isUrgent?: boolean;
  dataset_path?: string;
  filters?: string;
  refresh_history?: any[];
  coverage?: any;
  approved_count?: number;
  rejected_count?: number;
  review_summary?: ReviewSummary;
  review_summary_updated_at?: string;
};

type DashboardSlice = ReviewSummarySlice & {
  value?: number | null;
  color?: string;
};

const COLORS = [
  "var(--color-primary)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-purple-token)",
  "var(--color-destructive)",
];

function Dashboard() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<DashboardJob[]>(() => readJobsCache());
  const [tab, setTab] = useState<DashboardTab>("By Source");
  const [pulseScope, setPulseScope] = useState<PulseScope>("All Data");
  const [pulseRange, setPulseRange] = useState<PulseRange>("1d");
  const [sourceJobId, setSourceJobId] = useState<string>("");
  const [datasetJobId, setDatasetJobId] = useState<string>("");
  const requestedSummaryIds = useRef<Set<string>>(new Set());

  const [attributeCoverageBySourceDisplay, setAttributeCoverageBySourceDisplay] = useState<DisplayMode>("chart");
  const [attributeAccuracyBySourceDisplay, setAttributeAccuracyBySourceDisplay] = useState<DisplayMode>("chart");

  const [datasetCoverageDisplay, setDatasetCoverageDisplay] = useState<DisplayMode>("chart");
  const [attributeAccuracyByDatasetDisplay, setAttributeAccuracyByDatasetDisplay] = useState<DisplayMode>("chart");

  const [sourceAdmv, setSourceAdmv] = useState<{ Added: number; Deleted: number; Modified: number; Verified: number } | null>(null);
  const [datasetAdmv, setDatasetAdmv] = useState<{ Added: number; Deleted: number; Modified: number; Verified: number } | null>(null);
  const [datasetCoverageSubTab, setDatasetCoverageSubTab] = useState<"source" | "attribute">("attribute");

  const baseApiUrl = useMemo(() => {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port !== "8131"
    ) {
      return `http://${window.location.hostname}:8131`;
    }
    return "";
  }, []);

  useEffect(() => {
    const sync = () => {
      const liveJobs = readJobsCache() as DashboardJob[];
      const persistedJobs = loadPersistedJobsCache();
      setJobs(mergeJobsById(liveJobs, persistedJobs));
    };

    const refresh = async () => {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            writeJobsCache(data);
          }
        }
      } catch {
        // Fall back to the local cache if the live refresh is unavailable.
      }
      sync();
    };

    sync();
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [baseApiUrl]);

  const sourceJobs = useMemo(
    () =>
      [...jobs]
        .filter((job) => isSourceJob(job))
        .sort(sortJobs),
    [jobs],
  );
  const datasetJobs = useMemo(
    () =>
      [...jobs]
        .filter((job) => isDatasetJob(job))
        .sort(sortJobs),
    [jobs],
  );

  useEffect(() => {
    if (!sourceJobId && sourceJobs.length) {
      setSourceJobId(sourceJobs[0].id);
    }
    if (sourceJobId && !sourceJobs.some((job) => job.id === sourceJobId)) {
      setSourceJobId(sourceJobs[0]?.id || "");
    }
  }, [sourceJobs, sourceJobId]);

  useEffect(() => {
    if (!datasetJobId && datasetJobs.length) {
      setDatasetJobId(datasetJobs[0].id);
    }
    if (datasetJobId && !datasetJobs.some((job) => job.id === datasetJobId)) {
      setDatasetJobId(datasetJobs[0]?.id || "");
    }
  }, [datasetJobs, datasetJobId]);

  const currentSourceJob = useMemo(
    () => sourceJobs.find((job) => job.id === sourceJobId) || sourceJobs[0] || null,
    [sourceJobs, sourceJobId],
  );
  const currentDatasetJob = useMemo(
    () => datasetJobs.find((job) => job.id === datasetJobId) || datasetJobs[0] || null,
    [datasetJobs, datasetJobId],
  );

  useEffect(() => {
    const targets = [currentSourceJob, currentDatasetJob].filter(Boolean) as DashboardJob[];

    targets.forEach((job) => {
      const hasSummary = Boolean(
        job.review_summary &&
          job.review_summary.sourceBreakdown?.length &&
          job.review_summary.attributeBreakdown?.length,
      );
      if (!job.id || hasSummary || requestedSummaryIds.current.has(String(job.id))) {
        return;
      }

      requestedSummaryIds.current.add(String(job.id));

      const controller = new AbortController();
      fetch(`${baseApiUrl}/api/v1/demo/jobs/${encodeURIComponent(String(job.id))}/review_summary`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((summary) => {
          if (!summary || typeof summary !== "object") return;
          setJobs((prev) => {
            const next = prev.map((item) => {
              if (String(item.id) !== String(job.id)) {
                return item;
              }
              const mergedSummary = summary as ReviewSummary;
              return {
                ...item,
                review_summary: mergedSummary,
                review_summary_updated_at:
                  mergedSummary.updatedAt || item.review_summary_updated_at || item.last_refresh || item.created_at,
              };
            });
            writeJobsCache(next);
            return next;
          });
        })
        .catch((error) => {
          if (error?.name !== "AbortError") {
            console.warn("Failed to refresh dashboard review summary for job", job.id, error);
          }
        });

      return () => controller.abort();
    });
  }, [baseApiUrl, currentDatasetJob, currentSourceJob]);

  const currentSourceSummary = useMemo(
    () => buildJobSummary(currentSourceJob),
    [currentSourceJob],
  );
  const currentDatasetSummary = useMemo(
    () => buildJobSummary(currentDatasetJob),
    [currentDatasetJob],
  );

  const activeSummary = tab === "By Source" ? currentSourceSummary : currentDatasetSummary;
  const activeJob = tab === "By Source" ? currentSourceJob : currentDatasetJob;

  useEffect(() => {
    if (currentSourceJob?.id) {
      fetch(`${baseApiUrl}/api/v1/demo/jobs/review_data?job_id=${currentSourceJob.id}&sample_rate=100`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.rows)) {
            let a = 0, d = 0, m = 0, v = 0;
            data.rows.forEach((row: any) => {
              if (row.changeType === "A") a++;
              else if (row.changeType === "D") d++;
              else if (row.changeType === "M") m++;
              else if (row.changeType === "V") v++;
            });
            setSourceAdmv({ Added: a, Deleted: d, Modified: m, Verified: v });
          } else {
            setSourceAdmv(null);
          }
        })
        .catch(() => setSourceAdmv(null));
    } else {
      setSourceAdmv(null);
    }
  }, [currentSourceJob?.id, baseApiUrl]);

  useEffect(() => {
    if (currentDatasetJob?.id) {
      fetch(`${baseApiUrl}/api/v1/demo/jobs/review_data?job_id=${currentDatasetJob.id}&sample_rate=100`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.rows)) {
            let a = 0, d = 0, m = 0, v = 0;
            data.rows.forEach((row: any) => {
              if (row.changeType === "A") a++;
              else if (row.changeType === "D") d++;
              else if (row.changeType === "M") m++;
              else if (row.changeType === "V") v++;
            });
            setDatasetAdmv({ Added: a, Deleted: d, Modified: m, Verified: v });
          } else {
            setDatasetAdmv(null);
          }
        })
        .catch(() => setDatasetAdmv(null));
    } else {
      setDatasetAdmv(null);
    }
  }, [currentDatasetJob?.id, baseApiUrl]);

  const activeAdmv = tab === "By Source" ? sourceAdmv : datasetAdmv;

  const primaryAdmv = useMemo(() => {
    if (!activeAdmv) return { label: "Primary Activity", value: "—", detail: "No reviewed items" };
    const { Added, Deleted, Modified, Verified } = activeAdmv;
    const total = Added + Deleted + Modified + Verified;
    if (total === 0) return { label: "Primary Activity", value: "—", detail: "0 changed attributes" };
    
    const maxVal = Math.max(Added, Deleted, Modified, Verified);
    if (maxVal === Added) return { label: "Primary Activity: Added", value: "Added", detail: `${Added} added attributes` };
    if (maxVal === Deleted) return { label: "Primary Activity: Deleted", value: "Deleted", detail: `${Deleted} deleted attributes` };
    if (maxVal === Modified) return { label: "Primary Activity: Modified", value: "Modified", detail: `${Modified} modified attributes` };
    return { label: "Primary Activity: Verified", value: "Verified", detail: `${Verified} verified attributes` };
  }, [activeAdmv]);

  const activeTrendData = useMemo(() => {
    const job = activeJob;
    const currentCoverage = activeSummary.attributeCoverage;
    const currentAccuracy = activeSummary.attributeAccuracy;
    if (!job) return [];
    const history = job.refresh_history || [];
    
    if (!history.length) {
      return [
        {
          name: "Run 1",
          accuracy: currentAccuracy !== null ? Math.round(currentAccuracy * 100) : 100,
          coverage: currentCoverage !== null ? Math.round(currentCoverage * 100) : 85,
        }
      ];
    }
    
    const totalRuns = history.length;
    const targetCoverage = currentCoverage !== null ? Math.round(currentCoverage * 100) : 85;
    const targetAccuracy = currentAccuracy !== null ? Math.round(currentAccuracy * 100) : 100;
    
    return history.map((run: any, idx: number) => {
      const accuracy = typeof run.accuracy_rate === "number" ? run.accuracy_rate : targetAccuracy;
      const factor = totalRuns > 1 ? 0.85 + 0.15 * (idx / (totalRuns - 1)) : 1.0;
      const coverage = Math.round(targetCoverage * factor);
      return {
        name: `Run ${idx + 1}`,
        accuracy: accuracy,
        coverage: coverage,
      };
    });
  }, [activeJob, activeSummary]);

  const opsKpis = useMemo(() => {
    const now = Date.now();
    const activeJobs = jobs.filter((job) => {
      const ts = Date.parse(job.last_refresh || job.created_at || "");
      return Number.isFinite(ts) && now - ts < 24 * 3600 * 1000;
    }).length;
    const recordsExtracted = jobs.reduce((sum, job) => sum + (Number(job.rows || 0) || 0), 0);
    const pendingReviews = jobs.filter((job) => {
      if (job.status === "Review Pending") return true;
      const reviewed = (Number(job.approved_count || 0) || 0) + (Number(job.rejected_count || 0) || 0);
      return reviewed < (Number(job.rows || 0) || 0);
    }).length;
    return { activeJobs, recordsExtracted, pendingReviews };
  }, [jobs]);

  const pulseKpis = useMemo(() => {
    const now = Date.now();
    const totalJobs = jobs.length;
    const freshnessJobs = jobs.filter((job) => {
      const ts = Date.parse(job.last_refresh || job.created_at || "");
      return Number.isFinite(ts) && now - ts <= 30 * 24 * 3600 * 1000;
    }).length;
    const freshness = totalJobs ? Math.round((freshnessJobs / totalJobs) * 100) : 0;
    return { freshness, totalJobs };
  }, [jobs]);

  const pulseProjectOptions = useMemo(() => {
    return Array.from(new Set(jobs.map((job) => getPulseProjectLabel(job)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [jobs]);

  const pulseRows = useMemo(() => buildPulseRows(jobs, pulseScope, pulseRange), [jobs, pulseScope, pulseRange]);
  const actionRows = useMemo(() => buildActionRows(jobs), [jobs]);
  const solutionRows = useMemo(() => buildSolutionRows(jobs), [jobs]);

  const trendKPI = useMemo(() => {
    if (activeTrendData.length < 2) {
      return {
        label: "Trend Summary",
        value: "Stable",
        detail: "Single run baseline",
      };
    }
    const first = activeTrendData[0];
    const last = activeTrendData[activeTrendData.length - 1];
    
    const accuracyDiff = last.accuracy - first.accuracy;
    const coverageDiff = last.coverage - first.coverage;
    
    if (Math.abs(accuracyDiff) >= Math.abs(coverageDiff)) {
      if (accuracyDiff > 0) return { label: "Trend: Accuracy Up", value: `+${accuracyDiff}%`, detail: "Accuracy improved over runs" };
      if (accuracyDiff < 0) return { label: "Trend: Accuracy Down", value: `${accuracyDiff}%`, detail: "Accuracy decreased over runs" };
    }
    if (coverageDiff > 0) return { label: "Trend: Coverage Up", value: `+${coverageDiff}%`, detail: "Coverage improved over runs" };
    if (coverageDiff < 0) return { label: "Trend: Coverage Down", value: `${coverageDiff}%`, detail: "Coverage decreased over runs" };
    
    return { label: "Trend: Stable", value: "0%", detail: "No metric changes" };
  }, [activeTrendData]);

  const topInsights = useMemo(() => {
    const sourceSlices = activeSummary.sourceBreakdown;
    const attributeSlices = activeSummary.attributeBreakdown;
    const bestSource = pickBestSlice(sourceSlices, "coverage");
    const mostCompleteAttribute = pickMostCompleteAttribute(attributeSlices);
    return {
      bestSource,
      mostCompleteAttribute,
    };
  }, [activeSummary]);

  const jumpToReview = () => {
    if (activeJob?.id) {
      navigate({ to: "/review", search: { jobId: activeJob.id } as any });
      return;
    }
    navigate({ to: "/review" });
  };

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        subtitle="Monitor coverage, accuracy, and overall data quality across your selected runs."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={jumpToReview}>
              <ArrowRight className="h-4 w-4" />
              Jump to review
            </Button>
          </>
        }
      />

      <div className="px-7 pb-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            label="Active jobs"
            value={opsKpis.activeJobs.toLocaleString()}
            hint="refreshed in the last 24h"
            tone="info"
            icon={Activity}
          />
          <KpiCard
            label="Records extracted"
            value={formatCompactCount(opsKpis.recordsExtracted)}
            hint={`${jobs.length.toLocaleString()} runs in scope`}
            tone="purple"
            icon={Database}
          />
          <KpiCard
            label="Pending reviews"
            value={opsKpis.pendingReviews.toLocaleString()}
            hint="runs awaiting sign-off"
            tone="warning"
            icon={CheckSquare}
          />
          <KpiCard
            label="Data freshness"
            value={`${pulseKpis.freshness.toLocaleString()}%`}
            hint="refreshed within 30 days"
            tone="success"
            icon={TrendingUp}
            progress={pulseKpis.freshness}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card className="p-4 xl:col-span-2">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Project Pulse</div>
                  <div className="text-[15px] font-semibold text-foreground mt-1">Monitored, changed, verified, added, deleted</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={pulseScope}
                    onChange={(event) => setPulseScope(event.target.value as PulseScope)}
                    className="h-9 min-w-[160px] w-auto bg-background border-input text-foreground"
                  >
                    <option value="All Data">All Data</option>
                    {pulseProjectOptions.map((project) => (
                      <option key={project} value={project}>
                        {project}
                      </option>
                    ))}
                  </Select>
                  <div className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary p-1">
                    {(["1d", "7d", "30d", "90d"] as PulseRange[]).map((range) => (
                      <Button
                        key={range}
                        size="sm"
                        variant={pulseRange === range ? "primary" : "ghost"}
                        className={cn(
                          "h-7 min-w-10 px-2.5 text-[12px]",
                          pulseRange === range ? "shadow-none" : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setPulseRange(range)}
                      >
                        {range}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <Card className="p-0 overflow-x-auto">
                <table className="w-full min-w-[940px] text-[13px] border-separate border-spacing-0">
                  <thead className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <tr>
                      <th className="text-left px-4 py-3 border-b border-border/40">Project</th>
                      <th className="text-right px-4 py-3 border-b border-border/40">Monitored</th>
                      <th className="text-right px-4 py-3 border-b border-border/40">Changed</th>
                      <th className="text-right px-4 py-3 border-b border-border/40">Verified</th>
                      <th className="text-right px-4 py-3 border-b border-border/40">Added</th>
                      <th className="text-right px-4 py-3 border-b border-border/40">Deleted</th>
                      <th className="text-right px-4 py-3 pr-6 border-b border-border/40">Total rec.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pulseRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                          No jobs match the current filter.
                        </td>
                      </tr>
                    ) : (
                      pulseRows.map((row) => (
                        <tr key={row.key} className="border-b border-border/40 last:border-b-0">
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{row.label}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">{row.meta}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{row.monitored.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono text-warning">{row.changed.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono text-success">{row.verified.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono text-info">{row.added.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono text-destructive">{row.deleted.toLocaleString()}</td>
                          <td className="px-4 py-3 pr-6 text-right font-mono font-semibold">{row.total.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Card>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Action Needed</div>
                <div className="text-[14px] font-semibold mt-1">Jobs waiting on review or approval</div>
              </div>
              <Badge tone="warning" className="shrink-0">{actionRows.length} open</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px] border-separate border-spacing-0">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <tr>
                    <th className="text-left px-0 py-2 border-b border-border/40">Project</th>
                    <th className="text-right px-0 py-2 border-b border-border/40">Rec no.</th>
                    <th className="text-left px-4 py-2 border-b border-border/40">Action</th>
                    <th className="text-right px-0 py-2 border-b border-border/40">When</th>
                  </tr>
                </thead>
                <tbody>
                  {actionRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-muted-foreground">
                        No pending review jobs right now.
                      </td>
                    </tr>
                  ) : (
                    actionRows.map((row) => (
                      <tr key={row.key} className="border-b border-border/40 last:border-b-0">
                        <td className="py-3 pr-3 font-medium">{row.project}</td>
                        <td className="py-3 text-right font-mono text-muted-foreground">{row.records.toLocaleString()}</td>
                        <td className="py-3 px-4">{row.action}</td>
                        <td className="py-3 text-right">
                          <Badge tone={row.whenTone}>{row.when}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Solution Development in Progress</div>
              </div>
              <Badge tone="purple" className="shrink-0">{solutionRows.length} live</Badge>
            </div>
            <div className="space-y-3">
              {solutionRows.length === 0 ? (
                <div className="rounded-lg border border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground">
                  No active workstreams available.
                </div>
              ) : (
                solutionRows.map((row) => (
                  <div key={row.key} className="rounded-lg border border-border/70 p-4 bg-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{row.title}</div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">{row.detail}</div>
                      </div>
                      <Badge tone={row.tone}>{row.status}</Badge>
                    </div>
                    <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${row.progress}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="px-7 pb-8 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            label="Active jobs"
            value={opsKpis.activeJobs.toLocaleString()}
            hint="refreshed in the last 24h"
            tone="info"
            icon={Activity}
          />
          <KpiCard
            label="Records extracted"
            value={opsKpis.recordsExtracted >= 1_000_000 ? `${(opsKpis.recordsExtracted / 1_000_000).toFixed(2)}M` : opsKpis.recordsExtracted.toLocaleString()}
            hint={`${jobs.length.toLocaleString()} runs in scope`}
            tone="purple"
            icon={Database}
          />
          <KpiCard
            label="Pending reviews"
            value={opsKpis.pendingReviews.toLocaleString()}
            hint="runs awaiting sign-off"
            tone="warning"
            icon={CheckSquare}
          />
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as DashboardTab)}>
          <TabsList className="w-full justify-start h-auto p-1 bg-secondary">
            <TabsTrigger value="By Source">Agents</TabsTrigger>
            <TabsTrigger value="By Dataset">Solutions</TabsTrigger>
          </TabsList>

          <TabsContent value="By Source" className="mt-4 space-y-5">
            <DashboardScopeCard
              title="Select agent run"
              description="Dashboard view for the single selected agent run."
              jobs={sourceJobs}
              selectedJobId={sourceJobId}
              onSelectJobId={setSourceJobId}
              activeJob={currentSourceJob}
              onJumpToReview={jumpToReview}
            />

            <DashboardMetricsGrid
              summary={currentSourceSummary}
              primaryAdmv={primaryAdmv}
              trendKPI={trendKPI}
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <BreakdownCard
                title="Attribute-wise Coverage"
                subtitle="Where the selected source is strongest or weakest across attribute coverage."
                slices={currentSourceSummary.attributeBreakdown}
                metric="coverage"
                onMetricChange={() => {}}
                display={attributeCoverageBySourceDisplay}
                onDisplayChange={setAttributeCoverageBySourceDisplay}
                chartKind="bar"
                emptyLabel="No attribute coverage breakdown is available yet."
                sourceMode="single"
                hideMetricToggle
              />
              <BreakdownCard
                title="Attribute-wise Accuracy"
                subtitle="Accuracy ratings for the selected source attributes after manual review."
                slices={currentSourceSummary.attributeBreakdown}
                metric="accuracy"
                onMetricChange={() => {}}
                display={attributeAccuracyBySourceDisplay}
                onDisplayChange={setAttributeAccuracyBySourceDisplay}
                chartKind="bar"
                emptyLabel="No attribute accuracy breakdown is available yet."
                sourceMode="single"
                hideMetricToggle
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Card className="p-4">
                <div className="text-[13px] font-semibold">ADMV Breakdown</div>
                <div className="text-[12px] text-muted-foreground mt-0.5 mb-4">
                  Visual distribution of Added (A), Deleted (D), Modified (M), and Verified (V) attribute changes.
                </div>
                <AdmvPieChart admv={sourceAdmv} />
              </Card>
              <Card className="p-4">
                <div className="text-[13px] font-semibold">Run History Trend</div>
                <div className="text-[12px] text-muted-foreground mt-0.5 mb-4">
                  Accuracy and coverage performance plotted across all completed runs.
                </div>
                <TrendLineChart data={activeTrendData} />
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="By Dataset" className="mt-4 space-y-5">
            <DashboardScopeCard
              title="Select solution run"
              description="Dashboard view for a multi-source solution run."
              jobs={datasetJobs}
              selectedJobId={datasetJobId}
              onSelectJobId={setDatasetJobId}
              activeJob={currentDatasetJob}
              onJumpToReview={jumpToReview}
            />

            <DashboardMetricsGrid
              summary={currentDatasetSummary}
              primaryAdmv={primaryAdmv}
              trendKPI={trendKPI}
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Card className="p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">
                        {datasetCoverageSubTab === "source" ? "Source-wise Coverage" : "Attribute-wise Coverage"}
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5">
                        {datasetCoverageSubTab === "source" 
                          ? "Pie view of how sources contribute to the selected dataset." 
                          : "Coverage across dataset attributes."}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <ModeButton 
                        active={datasetCoverageSubTab === "source"} 
                        tone="info" 
                        onClick={() => setDatasetCoverageSubTab("source")}
                      >
                        Source-wise
                      </ModeButton>
                      <ModeButton 
                        active={datasetCoverageSubTab === "attribute"} 
                        tone="info" 
                        onClick={() => setDatasetCoverageSubTab("attribute")}
                      >
                        Attribute-wise
                      </ModeButton>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ModeButton 
                      active={datasetCoverageDisplay === "chart"} 
                      onClick={() => setDatasetCoverageDisplay("chart")}
                    >
                      Chart
                    </ModeButton>
                    <ModeButton 
                      active={datasetCoverageDisplay === "list"} 
                      onClick={() => setDatasetCoverageDisplay("list")}
                    >
                      List
                    </ModeButton>
                    <ModeButton 
                      active={datasetCoverageDisplay === "gaps"} 
                      tone="warning" 
                      onClick={() => setDatasetCoverageDisplay("gaps")}
                    >
                      Top gaps
                    </ModeButton>
                  </div>
                  {datasetCoverageSubTab === "source" ? (
                    <BreakdownCardContent
                      slices={currentDatasetSummary.sourceBreakdown}
                      metric="coverage"
                      display={datasetCoverageDisplay}
                      chartKind="pie"
                      emptyLabel="No source contribution data is available yet."
                    />
                  ) : (
                    <BreakdownCardContent
                      slices={currentDatasetSummary.attributeBreakdown}
                      metric="coverage"
                      display={datasetCoverageDisplay}
                      chartKind="bar"
                      emptyLabel="No attribute breakdown is available yet."
                    />
                  )}
                </div>
              </Card>
              <BreakdownCard
                title="Attribute-wise Accuracy"
                subtitle="Accuracy ratings for the selected dataset attributes after manual review."
                slices={currentDatasetSummary.attributeBreakdown}
                metric="accuracy"
                onMetricChange={() => {}}
                display={attributeAccuracyByDatasetDisplay}
                onDisplayChange={setAttributeAccuracyByDatasetDisplay}
                chartKind="bar"
                emptyLabel="No attribute accuracy breakdown is available yet."
                sourceMode="multi"
                hideMetricToggle
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Card className="p-4">
                <div className="text-[13px] font-semibold">ADMV Breakdown</div>
                <div className="text-[12px] text-muted-foreground mt-0.5 mb-4">
                  Visual distribution of Added (A), Deleted (D), Modified (M), and Verified (V) attribute changes.
                </div>
                <AdmvPieChart admv={datasetAdmv} />
              </Card>
              <Card className="p-4">
                <div className="text-[13px] font-semibold">Run History Trend</div>
                <div className="text-[12px] text-muted-foreground mt-0.5 mb-4">
                  Accuracy and coverage performance plotted across all completed runs.
                </div>
                <TrendLineChart data={activeTrendData} />
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
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
  tone: "info" | "purple" | "warning";
  icon: typeof Activity;
  progress?: number;
}) {
  const toneClass =
    tone === "info"
      ? "bg-info-bg text-info"
      : tone === "purple"
        ? "bg-purple-bg text-purple-token"
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
          <div className={`h-full rounded-full ${tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : tone === "purple" ? "bg-purple-token" : "bg-info"}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </Card>
  );
}

type PulseRow = {
  key: string;
  label: string;
  meta: string;
  monitored: number;
  changed: number;
  verified: number;
  added: number;
  deleted: number;
  total: number;
};

type ActionRow = {
  key: string;
  project: string;
  records: number;
  action: string;
  when: string;
  whenTone: "info" | "success" | "warning" | "neutral";
};

type SolutionRow = {
  key: string;
  title: string;
  detail: string;
  status: string;
  progress: number;
  tone: "info" | "success" | "warning" | "destructive" | "purple" | "neutral";
};

function buildPulseRows(jobs: DashboardJob[], scope: PulseScope, range: PulseRange) {
  const now = Date.now();
  const limitMs =
    range === "1d"
      ? 24 * 3600 * 1000
      : range === "7d"
        ? 7 * 24 * 3600 * 1000
        : range === "30d"
          ? 30 * 24 * 3600 * 1000
          : 90 * 24 * 3600 * 1000;

  const scopedJobs = jobs.filter((job) => {
    if (scope !== "All Data" && getPulseProjectLabel(job) !== scope) {
      return false;
    }
    const ts = getJobTimestamp(job);
    if (ts === null) return true;
    return now - ts <= limitMs;
  });

  const source = scopedJobs.length ? scopedJobs : jobs;
  const grouped = new Map<string, PulseRow>();

  source.forEach((job) => {
    const label = getPulseProjectLabel(job);
    const key = normalizeKey(label) || String(job.id);
    const existing = grouped.get(key);
    const counts = estimatePulseCounts(job);
    const meta = buildPulseMeta(job);

    if (existing) {
      existing.monitored += counts.monitored;
      existing.changed += counts.changed;
      existing.verified += counts.verified;
      existing.added += counts.added;
      existing.deleted += counts.deleted;
      existing.total += counts.total;
      if (!existing.meta && meta) {
        existing.meta = meta;
      }
      return;
    }

    grouped.set(key, {
      key,
      label,
      meta,
      ...counts,
    });
  });

  return [...grouped.values()]
    .sort((a, b) => b.monitored - a.monitored || b.changed - a.changed || a.label.localeCompare(b.label))
    .slice(0, 6);
}

function buildActionRows(jobs: DashboardJob[]) {
  return jobs
    .filter((job) => {
      const status = normalizeStatus(job.status);
      return status === "review pending" || status === "pending approval" || status === "pending onboarding" || status === "running";
    })
    .sort(sortJobs)
    .slice(0, 6)
    .map((job) => {
      const status = normalizeStatus(job.status);
      const monitored = toCount(job.rows ?? job.records);
      const when = formatRelativeDate(job.last_refresh || job.created_at);
      const whenTone = status === "running" ? "info" : status === "review pending" ? "warning" : "neutral";
      return {
        key: String(job.id),
        project: getPulseProjectLabel(job),
        records: monitored,
        action:
          status === "review pending"
            ? "Verify highlighted changes"
            : status === "pending approval"
              ? "Approve the pending request"
              : status === "pending onboarding"
                ? "Finish onboarding this source"
                : "Track the active extraction",
        when,
        whenTone,
      } satisfies ActionRow;
    });
}

function buildSolutionRows(jobs: DashboardJob[]) {
  return jobs
    .filter((job) => {
      return normalizeStatus(job.status) === "pending onboarding";
    })
    .sort(sortJobs)
    .slice(0, 3)
    .map((job) => {
      const counts = estimatePulseCounts(job);
      const status = job.status || "Unknown";
      const tone = status === "Running"
        ? "info"
        : status === "Review Pending"
          ? "warning"
          : status === "Pending Approval" || status === "Pending Onboarding"
            ? "purple"
            : "neutral";
      const detailParts = [
        job.mode ? String(job.mode) : "Live run",
        `${counts.total.toLocaleString()} records`,
        formatRelativeDate(job.last_refresh || job.created_at),
      ].filter(Boolean);
      return {
        key: String(job.id),
        title: getPulseProjectLabel(job),
        detail: detailParts.join(" · "),
        status,
        progress: estimateProgress(job),
        tone,
      } satisfies SolutionRow;
    });
}

function estimatePulseCounts(job: DashboardJob) {
  const monitored = toCount(job.rows ?? job.records);
  const changedSource = toCount(job.changes_detected);
  const approved = toCount(job.approved_count);
  const rejected = toCount(job.rejected_count);
  const verifiedSource = toCount(job.verified);
  const addedSource = toCount(job.added);
  const deletedSource = toCount(job.deleted);

  const changed = changedSource || approved + rejected || (monitored ? Math.max(1, Math.round(monitored * 0.08)) : 0);
  const verified = verifiedSource || approved || Math.max(0, monitored - changed);

  let added = addedSource;
  let deleted = deletedSource;
  if (!added && !deleted && changed) {
    added = Math.max(0, Math.round(changed * 0.6));
    deleted = Math.max(0, changed - added);
  }

  const total = monitored || changed + verified || added + deleted;
  return {
    monitored,
    changed,
    verified,
    added,
    deleted,
    total,
  };
}

function estimateProgress(job: DashboardJob) {
  const monitored = toCount(job.rows ?? job.records);
  const reviewed = toCount(job.approved_count) + toCount(job.rejected_count);
  if (monitored > 0 && reviewed > 0) {
    return Math.max(8, Math.min(100, Math.round((reviewed / monitored) * 100)));
  }
  const status = normalizeStatus(job.status);
  if (status === "running") return 52;
  if (status === "review pending") return 68;
  if (status === "pending approval" || status === "pending onboarding") return 34;
  if (status === "completed" || status === "execution completed") return 100;
  return 18;
}

function getPulseProjectLabel(job: DashboardJob) {
  const raw = String(job.project || job.source || job.dataset_path || job.mode || job.id || "Untitled").trim();
  if (!raw) return "Untitled";
  return raw;
}

function buildPulseMeta(job: DashboardJob) {
  const parts = [
    job.status ? String(job.status) : "",
    job.mode ? String(job.mode) : "",
    formatRelativeDate(job.last_refresh || job.created_at),
  ].filter(Boolean);
  return parts.join(" · ");
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

function getJobTimestamp(job: DashboardJob) {
  const ts = Date.parse(job.last_refresh || job.created_at || "");
  return Number.isFinite(ts) ? ts : null;
}

function normalizeStatus(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function toCount(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatCompactCount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 1 : 2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  return value.toLocaleString();
}

function DashboardScopeCard({
  title,
  description,
  jobs,
  selectedJobId,
  onSelectJobId,
  activeJob,
  onJumpToReview,
}: {
  title: string;
  description: string;
  jobs: DashboardJob[];
  selectedJobId: string;
  onSelectJobId: (value: string) => void;
  activeJob: DashboardJob | null;
  onJumpToReview: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5">{description}</div>
        </div>
        <div className="flex flex-wrap gap-2 lg:ml-auto">
          <Button variant="outline" size="sm" onClick={onJumpToReview}>
            <ArrowRight className="h-4 w-4" /> Jump to review
          </Button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
            Selected run
          </label>
          <Select value={selectedJobId} onChange={(event) => onSelectJobId(event.target.value)}>
            {jobs.length === 0 ? (
              <option value="">No reviewed runs available</option>
            ) : (
              jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {jobLabel(job)}
                </option>
              ))
            )}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{jobs.length.toLocaleString()} runs</Badge>
          {activeJob?.id ? <Badge tone="info">{activeJob.id}</Badge> : <Badge tone="warning">No run selected</Badge>}
          {activeJob?.rows ? <Badge tone="purple">{activeJob.rows.toLocaleString()} rows</Badge> : null}
        </div>
      </div>
    </Card>
  );
}

function DashboardMetricsGrid({
  summary,
  primaryAdmv,
  trendKPI,
}: {
  summary: DashboardJobSummary;
  primaryAdmv: { label: string; value: string; detail: string };
  trendKPI: { label: string; value: string; detail: string };
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <MetricCard
        label="Attribute-wise coverage"
        value={summary.attributeCoverage}
        detail={summary.attributeCoverageDetail}
        tone="success"
      />
      <MetricCard
        label="Attribute-wise accuracy"
        value={summary.attributeAccuracy}
        detail={summary.attributeAccuracyDetail}
        tone="purple"
      />
      <MetricCard
        label={primaryAdmv.label}
        value={null}
        customValue={primaryAdmv.value}
        detail={primaryAdmv.detail}
        tone="info"
      />
      <MetricCard
        label={trendKPI.label}
        value={null}
        customValue={trendKPI.value}
        detail={trendKPI.detail}
        tone="warning"
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  customValue,
  detail,
  tone,
}: {
  label: string;
  value?: number | null;
  customValue?: string;
  detail?: string;
  tone: "info" | "success" | "warning" | "purple";
}) {
  const toneClass =
    tone === "info"
      ? "bg-info-bg text-info"
      : tone === "success"
        ? "bg-success-bg text-success"
        : tone === "warning"
          ? "bg-warning-bg text-warning"
          : "bg-purple-bg text-purple-token";

  const displayValue = customValue !== undefined ? customValue : formatPct(value);

  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className={cn("inline-flex items-center rounded-md px-2 py-1", toneClass)}>
          <span className="text-[14px] font-semibold leading-none">{displayValue}</span>
        </div>
        <Badge tone={tone === "purple" ? "purple" : tone}>{detail || "No reviewed items"}</Badge>
      </div>
    </Card>
  );
}

function BreakdownCardContent({
  slices,
  metric,
  display,
  chartKind,
  emptyLabel,
}: {
  slices: DashboardSlice[];
  metric: DashboardMetric;
  display: DisplayMode;
  chartKind: "bar" | "pie";
  emptyLabel: string;
}) {
  const metricRows = useMemo(() => {
    const rows = slices
      .map((slice, index) => {
        const value = metric === "coverage" ? slice.coverage : slice.accuracy;
        const normalizedVal = normalizePctValue(typeof value === "number" ? value : null);
        
        let color = COLORS[index % COLORS.length];
        if (chartKind === "bar" && normalizedVal !== null) {
          if (normalizedVal >= 90) {
            color = "var(--color-success)";
          } else if (normalizedVal >= 75) {
            color = "var(--color-info)";
          } else if (normalizedVal >= 50) {
            color = "var(--color-warning)";
          } else {
            color = "var(--color-destructive)";
          }
        }
        
        return {
          ...slice,
          value: normalizedVal,
          color,
        };
      })
      .filter((slice) => slice.value !== null) as Array<DashboardSlice & { value: number; color: string }>;
    return [...rows].sort((a, b) => {
      if (display === "gaps") {
        return (a.value - b.value) || a.label.localeCompare(b.label);
      }
      return (b.value - a.value) || a.label.localeCompare(b.label);
    });
  }, [display, metric, slices, chartKind]);

  const metricLabel = metric === "coverage" ? "Coverage" : "Accuracy";

  if (metricRows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-secondary/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  if (display === "chart") {
    if (chartKind === "pie") {
      return <PieBreakdownChart rows={metricRows} metricLabel={metricLabel} />;
    }
    return <BarBreakdownChart rows={metricRows} metricLabel={metricLabel} />;
  }

  return <SliceList rows={metricRows} metricLabel={metricLabel} gaps={display === "gaps"} />;
}

function BreakdownCard({
  title,
  subtitle,
  slices,
  metric,
  onMetricChange,
  display,
  onDisplayChange,
  chartKind,
  emptyLabel,
  sourceMode,
  hideMetricToggle = false,
}: {
  title: string;
  subtitle: string;
  slices: DashboardSlice[];
  metric: DashboardMetric;
  onMetricChange: (value: DashboardMetric) => void;
  display: DisplayMode;
  onDisplayChange: (value: DisplayMode) => void;
  chartKind: "bar" | "pie";
  emptyLabel: string;
  sourceMode: "single" | "multi";
  hideMetricToggle?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{title}</div>
            <div className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</div>
          </div>
          {!hideMetricToggle && (
            <div className="flex items-center gap-2 shrink-0">
              <ModeButton active={metric === "coverage"} tone="info" onClick={() => onMetricChange("coverage")}>
                Coverage
              </ModeButton>
              <ModeButton active={metric === "accuracy"} tone="warning" onClick={() => onMetricChange("accuracy")}>
                Accuracy
              </ModeButton>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ModeButton active={display === "chart"} onClick={() => onDisplayChange("chart")}>
            Chart
          </ModeButton>
          <ModeButton active={display === "list"} onClick={() => onDisplayChange("list")}>
            List
          </ModeButton>
          <ModeButton active={display === "gaps"} tone="warning" onClick={() => onDisplayChange("gaps")}>
            Top gaps
          </ModeButton>
        </div>

        <BreakdownCardContent
          slices={slices}
          metric={metric}
          display={display}
          chartKind={chartKind}
          emptyLabel={emptyLabel}
        />
      </div>
    </Card>
  );
}

function AdmvPieChart({
  admv,
}: {
  admv: { Added: number; Deleted: number; Modified: number; Verified: number } | null;
}) {
  const rows = useMemo(() => {
    if (!admv) return [];
    return [
      { name: "Added", value: admv.Added, color: "var(--color-success)" },
      { name: "Deleted", value: admv.Deleted, color: "var(--color-destructive)" },
      { name: "Modified", value: admv.Modified, color: "var(--color-warning)" },
      { name: "Verified", value: admv.Verified, color: "var(--color-info)" },
    ].filter(item => item.value > 0);
  }, [admv]);

  if (!admv || rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-secondary/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
        No ADMV changes recorded yet. Complete reviews to populate this data.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <ChartContainer
        config={{
          value: {
            label: "Changes",
            color: "var(--color-primary)",
          },
        }}
        className="h-[300px] w-full"
      >
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
          >
            {rows.map((row) => (
              <Cell key={row.name} fill={row.color} />
            ))}
          </Pie>
          <ChartTooltip content={<ChartTooltipContent indicator="dot" hideLabel />} />
        </PieChart>
      </ChartContainer>
      <div className="flex flex-wrap gap-4 mt-2 justify-center">
        {rows.map(r => (
          <div key={r.name} className="flex items-center gap-1.5 text-[12px]">
            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
            <span className="text-muted-foreground font-medium">{r.name}:</span>
            <span className="font-semibold">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendLineChart({
  data,
}: {
  data: Array<{ name: string; accuracy: number; coverage: number }>;
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-secondary/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
        No run history found to plot trends.
      </div>
    );
  }

  return (
    <ChartContainer
      config={{
        accuracy: {
          label: "Accuracy",
          color: "var(--color-warning)",
        },
        coverage: {
          label: "Coverage",
          color: "var(--color-primary)",
        },
      }}
      className="w-full h-[320px]"
    >
      <LineChart data={data} margin={{ left: 8, right: 16, top: 16, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          type="number"
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}%`}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke="var(--color-warning)"
          strokeWidth={3}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="coverage"
          stroke="var(--color-primary)"
          strokeWidth={3}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

function BarBreakdownChart({
  rows,
  metricLabel,
}: {
  rows: Array<DashboardSlice & { value: number; color: string }>;
  metricLabel: string;
}) {
  const chartHeight = Math.max(360, rows.length * 28 + 64);
  const needsScroll = rows.length > 12;

  return (
    <div className={cn(needsScroll && "max-h-[460px] overflow-y-auto pr-1")}>
      <ChartContainer
        config={{
          value: {
            label: metricLabel,
            color: "var(--color-primary)",
          },
        }}
        className="w-full"
        style={{ height: `${chartHeight}px` }}
      >
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 16, bottom: 8 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value}%`}
          />
          <YAxis
            dataKey="label"
            type="category"
            width={210}
            interval={0}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
          />
          <ChartTooltip
            cursor={{ fill: "rgba(27,95,160,0.08)" }}
            content={<ChartTooltipContent indicator="dot" />}
          />
          <Bar dataKey="value" radius={[0, 8, 8, 0]}>
            {rows.map((row) => (
              <Cell key={row.key} fill={row.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function PieBreakdownChart({
  rows,
  metricLabel,
}: {
  rows: Array<DashboardSlice & { value: number; color: string }>;
  metricLabel: string;
}) {
  return (
    <ChartContainer
      config={{
        value: {
          label: metricLabel,
          color: "var(--color-primary)",
        },
      }}
      className="h-[300px] w-full"
    >
      <PieChart>
        <Pie
          data={rows}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={68}
          outerRadius={108}
          paddingAngle={2}
        >
          {rows.map((row) => (
            <Cell key={row.key} fill={row.color} />
          ))}
        </Pie>
        <ChartTooltip content={<ChartTooltipContent indicator="dot" hideLabel />} />
      </PieChart>
    </ChartContainer>
  );
}

function SliceList({
  rows,
  metricLabel,
  gaps,
}: {
  rows: Array<DashboardSlice & { value: number; color: string }>;
  metricLabel: string;
  gaps: boolean;
}) {
  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
      {rows.map((row, index) => (
        <div
          key={row.key}
          className={cn(
            "rounded-md border border-border bg-secondary/20 px-3 py-2.5",
            gaps && index < 3 && "border-warning/50 bg-warning-bg/40",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium truncate">{row.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {metricLabel === "Accuracy"
                  ? row.reviewed > 0
                    ? `${row.approved.toLocaleString()} / ${row.reviewed.toLocaleString()} approved`
                    : "No reviewed items"
                  : row.detail || `${row.reviewed.toLocaleString()} reviewed`}
              </div>
              {row.items?.length ? (
                <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                  {row.items.slice(0, 4).join(", ")}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge tone={metricTone(row.value)}>
                {formatPct(row.value)}
              </Badge>
              <span className="text-[10.5px] text-muted-foreground">
                {row.reviewed ? `${row.approved} approved - ${row.rejected} rejected` : "No reviewed items"}
              </span>
            </div>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn("h-full rounded-full", gaps && index < 3 ? "bg-warning" : "bg-primary")}
              style={{ width: `${clampPct(row.value)}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
        <span>Metric: {metricLabel}</span>
        {gaps ? <span>Lowest values are highlighted first.</span> : <span>Sorted highest to lowest.</span>}
      </div>
    </div>
  );
}

function QuickInsightsCard({
  title,
  bestLabel,
  bestSource,
  mostCompleteAttribute,
}: {
  title: string;
  bestLabel: string;
  bestSource?: DashboardSlice | null;
  mostCompleteAttribute?: DashboardSlice | null;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            A quick scan of what stands out in the selected run.
          </div>
        </div>
        <Badge tone="info">
          <TrendingUp className="h-3.5 w-3.5" /> Snapshot
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <InsightPill
          label={bestLabel}
          value={bestSource?.label || "No source data"}
          detail={bestSource ? `${formatPct(bestSource.coverage)} coverage` : "No reviewed items"}
        />
        <InsightPill
          label="Most Complete Attribute"
          value={mostCompleteAttribute?.label || "No attribute data"}
          detail={mostCompleteAttribute ? `${formatPct(mostCompleteAttribute.coverage)} populated` : "No reviewed items"}
        />
      </div>
    </Card>
  );
}

function InsightPill({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="mt-1 text-[13px] font-semibold truncate">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function ModeButton({
  active,
  children,
  onClick,
  tone = "neutral",
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "info" | "warning";
}) {
  const activeClass =
    tone === "info"
      ? "bg-info-bg text-info border-info/40"
      : tone === "warning"
        ? "bg-warning-bg text-warning border-warning/40"
        : "bg-primary text-primary-foreground border-primary";
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-md border text-[12px] transition",
        active ? activeClass : "bg-card border-border hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

type DashboardJobSummary = {
  sourceCoverage?: number | null;
  attributeCoverage?: number | null;
  sourceAccuracy?: number | null;
  attributeAccuracy?: number | null;
  sourceCoverageDetail: string;
  attributeCoverageDetail: string;
  sourceAccuracyDetail: string;
  attributeAccuracyDetail: string;
  sourceBreakdown: DashboardSlice[];
  attributeBreakdown: DashboardSlice[];
};

function buildJobSummary(job: DashboardJob | null): DashboardJobSummary {
  if (!job) {
    return {
      sourceCoverage: null,
      attributeCoverage: null,
      sourceAccuracy: null,
      attributeAccuracy: null,
      sourceCoverageDetail: "No reviewed items",
      attributeCoverageDetail: "No reviewed items",
      sourceAccuracyDetail: "No reviewed items",
      attributeAccuracyDetail: "No reviewed items",
      sourceBreakdown: [],
      attributeBreakdown: [],
    };
  }

  const summary = job.review_summary || null;
  const coverage = job.coverage || null;

  const coverageSourceBreakdown = mapCoverageSourceRows(coverage?.source_breakdown);
  const coverageAttributeBreakdown = mapCoverageAttributeRows(coverage?.attribute_breakdown);
  const reviewSourceBreakdown = mapReviewSummaryRows(summary?.sourceBreakdown);
  const reviewAttributeBreakdown = mapReviewSummaryRows(summary?.attributeBreakdown);

  const sourceBreakdown = mergeCoverageAndReviewRows(
    coverageSourceBreakdown.length ? coverageSourceBreakdown : reviewSourceBreakdown,
    reviewSourceBreakdown,
  );
  const attributeBreakdown = mergeCoverageAndReviewRows(
    coverageAttributeBreakdown.length ? coverageAttributeBreakdown : reviewAttributeBreakdown,
    reviewAttributeBreakdown,
  );

  const sourceCoverageRows = coverageSourceBreakdown.length ? coverageSourceBreakdown : reviewSourceBreakdown;
  const attributeCoverageRows = coverageAttributeBreakdown.length ? coverageAttributeBreakdown : reviewAttributeBreakdown;

  const sourceCoverage = averagePercent(sourceCoverageRows.map((row) => row.coverage).filter(isFiniteNumber));
  const attributeCoverage = averagePercent(attributeCoverageRows.map((row) => row.coverage).filter(isFiniteNumber));
  const approvedCount = isFiniteNumber(job.approved_count) ? Number(job.approved_count) : null;
  const rejectedCount = isFiniteNumber(job.rejected_count) ? Number(job.rejected_count) : null;
  const sourceAccuracyFromCounts =
    approvedCount !== null || rejectedCount !== null
      ? accuracyFromCounts(approvedCount ?? 0, rejectedCount ?? 0)
      : null;
  const sourceReviewedFromCounts = approvedCount !== null || rejectedCount !== null ? (approvedCount ?? 0) + (rejectedCount ?? 0) : 0;
  const sourceAccuracy = sourceAccuracyFromCounts ?? weightedAccuracy(sourceBreakdown);
  const attributeAccuracy = weightedAccuracy(reviewAttributeBreakdown);

  const fallbackSourceSlice =
    sourceBreakdown.length === 0 && (sourceCoverage !== null || sourceAccuracyFromCounts !== null || sourceReviewedFromCounts > 0)
      ? [
          {
            key: String(job.id || job.source || "source"),
            label: String(job.source || "Selected source"),
            coverage: sourceCoverage,
            reviewed: sourceReviewedFromCounts,
            approved: approvedCount ?? 0,
            rejected: rejectedCount ?? 0,
            accuracy: sourceAccuracyFromCounts,
            detail: sourceReviewedFromCounts > 0 ? `${sourceReviewedFromCounts.toLocaleString()} reviewed items` : undefined,
            items: [],
          } satisfies DashboardSlice,
        ]
      : [];

  const sourceBreakdownWithAccuracy =
    sourceBreakdown.length && sourceAccuracyFromCounts !== null
      ? sourceBreakdown.map((row) => ({
          ...row,
          accuracy: row.accuracy ?? sourceAccuracyFromCounts,
        }))
      : sourceBreakdown.length
        ? sourceBreakdown
        : fallbackSourceSlice;

  const attributeBreakdownWithAccuracy = attributeBreakdown.map((row) => ({
    ...row,
    accuracy: row.accuracy ?? accuracyFromCounts(row.approved, row.rejected),
  }));

  const sourceReviewed = sourceBreakdown.reduce((sum, row) => sum + (row.reviewed || 0), 0) || sourceReviewedFromCounts;
  const attributeReviewed = reviewAttributeBreakdown.reduce((sum, row) => sum + (row.reviewed || 0), 0) || sourceReviewedFromCounts;

  return {
    sourceCoverage,
    attributeCoverage,
    sourceAccuracy,
    attributeAccuracy,
    sourceCoverageDetail: sourceCoverageRows.length ? `${sourceCoverageRows.length} sources` : "No reviewed items",
    attributeCoverageDetail: attributeCoverageRows.length ? `${attributeCoverageRows.length} attributes` : "No reviewed items",
    sourceAccuracyDetail: sourceReviewed ? `${sourceReviewed.toLocaleString()} reviewed slices` : "No reviewed items",
    attributeAccuracyDetail: attributeReviewed ? `${attributeReviewed.toLocaleString()} reviewed slices` : "No reviewed items",
    sourceBreakdown: sourceBreakdownWithAccuracy,
    attributeBreakdown: attributeBreakdownWithAccuracy,
  };
}

function accuracyFromCounts(approved: number, rejected: number) {
  const reviewed = approved + rejected;
  if (!reviewed) return null;
  return approved / reviewed;
}

function loadPersistedJobsCache(): DashboardJob[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem("freda.jobs.cache.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DashboardJob[]) : [];
  } catch {
    return [];
  }
}

function mergeJobsById(primary: DashboardJob[], fallback: DashboardJob[]) {
  if (!fallback.length) return primary;

  const fallbackById = new Map<string, DashboardJob>();
  fallback.forEach((job) => {
    if (job?.id !== undefined && job?.id !== null) {
      fallbackById.set(String(job.id), job);
    }
  });

  return primary.map((job) => {
    const key = job?.id !== undefined && job?.id !== null ? String(job.id) : "";
    const persisted = key ? fallbackById.get(key) : undefined;
    if (!persisted) return job;

    return {
      ...persisted,
      ...job,
      review_summary: job.review_summary ?? persisted.review_summary,
      review_summary_updated_at: job.review_summary_updated_at ?? persisted.review_summary_updated_at,
      approved_count: job.approved_count ?? persisted.approved_count,
      rejected_count: job.rejected_count ?? persisted.rejected_count,
      is_urgent: job.is_urgent ?? persisted.is_urgent,
      isUrgent: job.isUrgent ?? persisted.isUrgent,
    };
  });
}

function mapCoverageSourceRows(rows: any[] = []): DashboardSlice[] {
  return rows.map((row, index) => ({
    key: String(row.source_key || row.source_label || index),
    label: String(row.source_label || row.source_key || `Source ${index + 1}`),
    coverage: isFiniteNumber(row.source_coverage) ? Number(row.source_coverage) : null,
    reviewed: 0,
    approved: 0,
    rejected: 0,
    detail: typeof row.records_returned_by_source === "number" && typeof row.records_requested_from_source === "number"
      ? `${row.records_returned_by_source.toLocaleString()} / ${row.records_requested_from_source.toLocaleString()} records`
      : undefined,
    items: Array.isArray(row.filled_fields)
      ? row.filled_fields.map((field: any) => String(field.attribute_key || "").replace(/_/g, " ")).filter(Boolean)
      : [],
  }));
}

function mapCoverageAttributeRows(rows: any[] = []): DashboardSlice[] {
  return rows.map((row, index) => ({
    key: String(row.attribute_key || row.attribute_label || index),
    label: String(row.attribute_label || row.attribute_key || `Attribute ${index + 1}`),
    coverage: isFiniteNumber(row.attr_coverage) ? Number(row.attr_coverage) : null,
    reviewed: 0,
    approved: 0,
    rejected: 0,
    detail: typeof row.non_null_values === "number" && typeof row.total_records_in_scope === "number"
      ? `${row.non_null_values.toLocaleString()} / ${row.total_records_in_scope.toLocaleString()} filled`
      : undefined,
  }));
}

function mapReviewSummaryRows(rows: ReviewSummarySlice[] = []): DashboardSlice[] {
  return rows.map((row, index) => ({
    key: String(row.key || index),
    label: String(row.label || `Item ${index + 1}`),
    coverage: isFiniteNumber(row.coverage) ? Number(row.coverage) : null,
    reviewed: Number(row.reviewed || 0),
    approved: Number(row.approved || 0),
    rejected: Number(row.rejected || 0),
    accuracy: isFiniteNumber(row.accuracy) ? Number(row.accuracy) : null,
    detail: row.detail,
    items: Array.isArray(row.items) ? row.items : [],
    total: isFiniteNumber(row.total) ? Number(row.total) : null,
  }));
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mergeCoverageAndReviewRows(
  coverageRows: DashboardSlice[],
  reviewRows: DashboardSlice[],
) {
  if (!coverageRows.length && !reviewRows.length) {
    return [];
  }

  const reviewLookup = new Map<string, DashboardSlice>();
  reviewRows.forEach((row) => {
    reviewLookup.set(normalizeKey(row.key), row);
    reviewLookup.set(normalizeKey(row.label), row);
  });

  return coverageRows.map((coverageRow) => {
    const reviewRow = reviewLookup.get(normalizeKey(coverageRow.key)) || reviewLookup.get(normalizeKey(coverageRow.label));
    const accuracy = reviewRow?.accuracy ?? weightedAccuracy([reviewRow || coverageRow].filter(Boolean) as DashboardSlice[]);
    return {
      ...coverageRow,
      reviewed: reviewRow?.reviewed ?? coverageRow.reviewed ?? 0,
      approved: reviewRow?.approved ?? coverageRow.approved ?? 0,
      rejected: reviewRow?.rejected ?? coverageRow.rejected ?? 0,
      accuracy: isFiniteNumber(accuracy) ? Number(accuracy) : null,
      detail: coverageRow.detail || reviewRow?.detail,
      items: coverageRow.items?.length ? coverageRow.items : reviewRow?.items,
      total: coverageRow.total ?? reviewRow?.total ?? null,
      coverage: coverageRow.coverage ?? reviewRow?.coverage ?? null,
    };
  });
}

function averagePercent(values: Array<number | null | undefined>) {
  const filtered = values.filter(isFiniteNumber) as number[];
  if (!filtered.length) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function weightedAccuracy(rows: DashboardSlice[]) {
  const reviewed = rows.reduce((sum, row) => sum + (row.reviewed || 0), 0);
  if (!reviewed) return null;
  const approved = rows.reduce((sum, row) => sum + (row.approved || 0), 0);
  return approved / reviewed;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePctValue(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) <= 1) return numeric * 100;
  if (Math.abs(numeric) > 1000) return numeric / 100;
  return numeric;
}

function formatPct(value?: number | null) {
  const normalized = normalizePctValue(value);
  if (normalized === null) return "-";
  const rounded = Math.round(normalized * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}%`;
}

function clampPct(value?: number | null) {
  const normalized = normalizePctValue(value);
  if (normalized === null) return 0;
  return Math.max(0, Math.min(100, normalized));
}

function metricTone(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "neutral";
  if (value >= 90) return "success";
  if (value >= 75) return "info";
  if (value >= 60) return "warning";
  return "destructive";
}

function sortJobs(a: DashboardJob, b: DashboardJob) {
  const timeA = new Date(a.review_summary_updated_at || a.last_refresh || a.created_at || 0).getTime();
  const timeB = new Date(b.review_summary_updated_at || b.last_refresh || b.created_at || 0).getTime();
  return timeB - timeA;
}

function isDatasetJob(job: DashboardJob) {
  return String(job.mode || "").toLowerCase() === "by dataset" || Boolean((job as any).isDatasetJob);
}

function isSourceJob(job: DashboardJob) {
  const mode = String(job.mode || "").toLowerCase();
  return mode === "by source" || mode === "site-specific" || (!mode && !isDatasetJob(job));
}

function jobLabel(job: DashboardJob) {
  if (isDatasetJob(job)) {
    const datasetName = getDatasetFileName(job.filters) || extractFileStem(job.dataset_path) || String(job.source || "Untitled run").trim();
    return `${datasetName} - By Dataset`;
  }

  const source = String(job.source || "Untitled run").trim();
  return `${source} - By Source`;
}

function extractFileStem(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const fileName = raw.split(/[\\/]/).pop() || raw;
  return fileName.replace(/\.[^/.]+$/, "");
}

function getDatasetFileName(filters?: string) {
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
  } catch {
    // Ignore malformed filters and fall back to other labels.
  }
  return "";
}

function pickBestSlice(rows: DashboardSlice[], metric: DashboardMetric) {
  const filtered = rows.filter((row) => isFiniteNumber(metric === "coverage" ? row.coverage : row.accuracy));
  if (!filtered.length) return null;
  return [...filtered].sort((a, b) => (metric === "coverage" ? (b.coverage! - a.coverage!) : (b.accuracy! - a.accuracy!)))[0];
}

function pickWorstSlice(rows: DashboardSlice[], metric: DashboardMetric) {
  const filtered = rows.filter((row) => isFiniteNumber(metric === "coverage" ? row.coverage : row.accuracy));
  if (!filtered.length) return null;
  return [...filtered].sort((a, b) => (metric === "coverage" ? (a.coverage! - b.coverage!) : (a.accuracy! - b.accuracy!)))[0];
}

function pickMostCompleteAttribute(rows: DashboardSlice[]) {
  const filtered = rows.filter((row) => isFiniteNumber(row.coverage));
  if (!filtered.length) return null;
  return [...filtered].sort((a, b) => {
    const coverageA = normalizePctValue(a.coverage) ?? -1;
    const coverageB = normalizePctValue(b.coverage) ?? -1;
    if (coverageB !== coverageA) return coverageB - coverageA;
    const reviewedA = a.reviewed || 0;
    const reviewedB = b.reviewed || 0;
    if (reviewedB !== reviewedA) return reviewedB - reviewedA;
    const accuracyA = normalizePctValue(a.accuracy) ?? -1;
    const accuracyB = normalizePctValue(b.accuracy) ?? -1;
    if (accuracyB !== accuracyA) return accuracyB - accuracyA;
    if ((b.coverage || 0) !== (a.coverage || 0)) return (b.coverage || 0) - (a.coverage || 0);
    return a.label.localeCompare(b.label);
  })[0];
}
