import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Card, PageHeader, Button } from "@/components/ui-bits";
import { Download, ChevronDown, Trash2, Star, RefreshCw, Timer } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { clearDeletedJob, jobsCacheUpdatedEventName, markJobDeleted, readJobsCache, writeJobsCache } from "@/lib/jobs-cache";
import { fetchBotCatalog, getBotDisplayName, type BotCatalogEntry } from "@/lib/bot-catalog";


export const Route = createFileRoute("/monitoring")({
  head: () => ({ meta: [{ title: "Monitoring – FreshData AI" }] }),
  component: Monitoring,
});

// Service simulation helper function to handle Processing -> Completed lifecycle transition.
export function startJobDemoLifecycleSimulation(
  customJobs: any[],
  onComplete: (updated: any[]) => void
) {
  const runningJobs = customJobs.filter((j) => j.status === "Running");
  if (runningJobs.length === 0) return () => {};

  const timer = setTimeout(() => {
    const updated = customJobs.map((j) => {
      if (j.status === "Running") {
        const now = new Date();
        const lastRefresh = now.toISOString();
        let nextDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Default Weekly
        const freq = String(j.frequency || "").trim().toLowerCase();
        if (freq === "hourly" || freq === "every hour" || freq === "1 hour" || freq === "1 hr" || freq === "60 minutes") {
          nextDate = new Date(now.getTime() + 60 * 60 * 1000);
        }
        if (j.frequency === "Daily") {
          nextDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        } else if (j.frequency === "Monthly") {
          nextDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        } else if (j.frequency === "Quarterly") {
          nextDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        }

        const recordsScraped = Math.floor(Math.random() * 800) + 150;
        const accuracyRate = Math.floor(Math.random() * 5) + 95;

        const newHistoryEntry = {
          timestamp: lastRefresh,
          records_scraped: recordsScraped,
          accuracy_rate: accuracyRate,
          status: "Success",
          execution_time_seconds: Math.floor(Math.random() * 30) + 15,
        };

        return {
          ...j,
          status: "Completed",
          last_refresh: lastRefresh,
          next_refresh: nextDate.toISOString(),
          refresh_count: (j.refresh_count || 0) + 1,
          records: recordsScraped,
          fresh: accuracyRate,
          refresh_history: [...(j.refresh_history || []), newHistoryEntry],
        };
      }
      return j;
    });
    onComplete(updated);
  }, 8000);

  return () => clearTimeout(timer);
}

function formatRelativeTime(isoStr: string) {
  if (!isoStr) return "Just now";
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60000) return "Just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(isoStr).toLocaleDateString();
}

function formatDateTime(isoStr: string) {
  if (!isoStr) return "—";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function computeNextRunTime(job: any) {
  const freq = String(job?.frequency || "").trim().toLowerCase();
  const nextRefreshValue = job?.next_refresh || job?.nextRefresh || null;
  const nextRefresh = nextRefreshValue ? new Date(nextRefreshValue) : null;
  if (nextRefresh && !Number.isNaN(nextRefresh.getTime())) {
    return nextRefresh.toISOString();
  }

  const baseValue = job?.last_refresh || job?.created_at || job?.createdAt || null;
  const base = baseValue ? new Date(baseValue) : null;
  if (!base || Number.isNaN(base.getTime())) {
    return null;
  }

  const next = new Date(base.getTime());
  if (freq === "hourly" || freq === "every hour" || freq === "1 hour" || freq === "1 hr" || freq === "60 minutes") {
    next.setHours(next.getHours() + 1);
  } else if (freq === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (freq === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else if (freq === "quarterly") {
    next.setMonth(next.getMonth() + 3);
  } else if (freq === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    return null;
  }
  return next.toISOString();
}

function tone(s: string) {
  if (s === "Running") return "info" as const;
  if (s === "Completed" || s === "Execution Completed") return "success" as const;
  if (s === "Review" || s === "Review Pending") return "warning" as const;
  if (s === "Analysis Complete" || s === "Pending Approval" || s === "Pending Onboarding") return "warning" as const;
  if (s === "Rejected") return "destructive" as const;
  return "destructive" as const;
}

function cleanSourceName(name: string) {
  if (!name) return "";
  let clean = String(name).trim();
  
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

function getNewSourceDisplayName(source: string) {
  if (!source) return "";
  const clean = cleanSourceName(source);
  const baseName = clean.split(".")[0].trim();
  if (!baseName) return "";
  return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}

function getAnySiteUploadedFilename(filters: string) {
  if (!filters || filters === "—") return "";
  try {
    const parsed = JSON.parse(filters);
    return typeof parsed.seedFile === "string"
      ? parsed.seedFile.trim().replace(/\.(csv|xlsx|xls)$/i, "")
      : "";
  } catch {
    return "";
  }
}

function Monitoring() {
  const [customJobs, setCustomJobs] = useState<any[]>(() => readJobsCache());
  const [openExportId, setOpenExportId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<BotCatalogEntry[]>([]);
  const [urgentBusyId, setUrgentBusyId] = useState<string | null>(null);
  const [rerunJobId, setRerunJobId] = useState<string | null>(null);
  const [rerunAt, setRerunAt] = useState("");
  const [rerunBusyId, setRerunBusyId] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    async function fetchJobs() {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          if (active) {
            // Merge server rows into the existing cache so a freshly launched job
            // stays visible even if the backend list is briefly behind the UI.
            const mergedJobs = writeJobsCache([...readJobsCache(), ...data]);
            setCustomJobs(mergedJobs);
          }
        }
      } catch (err) {
        console.error("Failed to fetch jobs from backend:", err);
      }
    }

    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    const handleCacheUpdate = () => {
      if (!active) return;
      setCustomJobs(readJobsCache());
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
    fetchBotCatalog()
      .then((payload) => {
        if (!active) return;
        setCatalog(payload.bots || []);
      })
      .catch(() => {
        if (!active) return;
        setCatalog([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function deleteJob(jobId: string) {
    let previousJobs: any[] = [];
    markJobDeleted(jobId);
    setCustomJobs((current) => {
      previousJobs = current;
      const next = current.filter((job) => job.id !== jobId);
      writeJobsCache(next);
      return next;
    });
    if (openExportId === jobId) {
      setOpenExportId(null);
    }
    try {
      const response = await apiFetch(`/api/v1/demo/jobs/${jobId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.detail || data?.message || "Failed to delete job");
      }
    } catch (err) {
      console.error(err);
      clearDeletedJob(jobId);
      setCustomJobs(previousJobs);
      writeJobsCache(previousJobs);
    }
  }

  async function toggleUrgent(job: any) {
    const nextUrgent = !Boolean(job.isUrgent);
    setUrgentBusyId(job.id);
    setCustomJobs((current) => {
      const next = current.map((item) =>
        item.id === job.id ? { ...item, is_urgent: nextUrgent ? 1 : 0, isUrgent: nextUrgent } : item,
      );
      writeJobsCache(next);
      return next;
    });
    try {
      const response = await apiFetch(`/api/v1/demo/jobs/${job.id}/urgent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_urgent: nextUrgent }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.detail || data?.message || "Failed to update urgent flag");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUrgentBusyId((current) => (current === job.id ? null : current));
    }
  }

  async function rerunWeeklyJob(job: any, scheduledFor?: string) {
    setRerunBusyId(job.id);
    try {
      const response = await apiFetch(`/api/v1/demo/jobs/${job.id}/weekly-rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduledFor ? { scheduled_for: new Date(scheduledFor).toISOString() } : {}),
      });
      if (!response.ok) throw new Error("Failed to update weekly rerun");
      const result = await response.json();
      setCustomJobs((current) => {
        const next = current.map((item) => item.id === job.id ? {
          ...item,
          status: scheduledFor ? item.status : "Running",
          next_refresh: scheduledFor ? result.next_refresh : null,
        } : item);
        writeJobsCache(next);
        return next;
      });
      setRerunJobId(null);
    } finally {
      setRerunBusyId(null);
    }
  }

  const combinedJobs = [...customJobs].reverse().map((j) => {
    const sourceName = String(j.source || j.source_name || j.website_url || "Unknown Source");
    return {
      id: j.id || `J-${Date.now()}`,
      source: sourceName,
      mode: j.mode || "By Source",
      run: formatRelativeTime(j.created_at),
      status: j.status,
      records: j.records !== undefined ? j.records : null,
      fresh: j.fresh !== undefined ? j.fresh : null,
      frequency: j.frequency || "Weekly",
      scope: j.scope || "Full Dump",
      filters: j.filters || "—",
      delivery: j.delivery || "S3 bucket",
      last_refresh: j.last_refresh || null,
      next_refresh: j.next_refresh || null,
      refresh_count: j.refresh_count || 0,
      dataset_path: j.dataset_path || `datasets/${sourceName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_sample.csv`,
      refresh_history: j.refresh_history || [],
      isCustomSource: j.isCustomSource ?? true,
      isUrgent: Boolean(j.is_urgent ?? j.isUrgent),
      changes_detected: j.changes_detected ?? 0,
      complexity: j.complexity || null,
      estimated_onboarding_time: j.estimated_onboarding_time || null,
      created_at: j.created_at,
    };
  });

  // Deduplicate combinedJobs by ID only.
  const deduplicatedJobs: any[] = [];
  const seenIds = new Set<string>();

  for (const j of combinedJobs) {
    if (seenIds.has(j.id)) continue;
    seenIds.add(j.id);
    deduplicatedJobs.push(j);
  }

  // Restore a stable, recency-first sort for display.
  const finalJobs = [...deduplicatedJobs].sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    const timeDiff = timeB - timeA;
    if (timeDiff !== 0) return timeDiff;

    const score = (status: string) => {
      if (status === "Running") return 4;
      if (status === "Review" || status === "Review Pending") return 3;
      if (status === "Completed" || status === "Execution Completed") return 2;
      if (status === "Failed" || status === "Aborted") return 1;
      return 0;
    };
    return score(b.status) - score(a.status);
  });

  const runningCount = finalJobs.filter((j) => j.status === "Running").length;
  const completedCount = finalJobs.filter((j) => j.status === "Completed" || j.status === "Execution Completed").length;
  const reviewCount = finalJobs.filter((j) => j.status === "Review" || j.status === "Review Pending").length;
  const pendingOnboardingCount = finalJobs.filter((j) => j.status === "Pending Approval" || j.status === "Pending Onboarding").length;
  const abortedCount = finalJobs.filter((j) => j.status === "Failed" || j.status === "Aborted").length;
  const isCustomScrapeJob = (j: any) => {
    const scope = String(j.scope || "").toLowerCase();
    return Boolean(j.isCustomSource) || scope.includes("custom") || scope.includes("partial");
  };
  return (
    <AppLayout>
      <PageHeader title="Monitoring" subtitle="Live state of refreshes across both approaches." />
      <div className="px-7 pb-8 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { l: "Running", v: runningCount, t: "info" as const },
            { l: "Completed today", v: completedCount, t: "success" as const },
            { l: "Needs review", v: reviewCount, t: "warning" as const },
            { l: "Pending onboarding", v: pendingOnboardingCount, t: "warning" as const },
            { l: "Aborted", v: abortedCount, t: "destructive" as const },
          ].map((s) => (
            <Card key={s.l} className="p-4">
              <div className="text-[12px] text-muted-foreground">{s.l}</div>
              <div className="text-[24px] font-semibold mt-1">{s.v}</div>
              <Badge tone={s.t} className="mt-1">live</Badge>
            </Card>
          ))}
        </div>

        <Card className="p-0 overflow-x-auto relative">
          <table className="w-full min-w-[1000px] text-[13px] border-separate border-spacing-0">
            <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              <tr>
                <th className="text-left px-4 py-2.5 border-b border-border/40">Job</th>
                <th className="text-left px-4 py-2.5 border-b border-border/40">Source</th>
                <th className="text-left px-4 py-2.5 border-b border-border/40">Mode</th>
                <th className="text-left px-4 py-2.5 border-b border-border/40">Last Run</th>
                <th className="text-left px-4 py-2.5 border-b border-border/40">Status</th>
                <th className="text-right px-4 py-2.5 border-b border-border/40">Records</th>
                <th className="text-right px-4 py-2.5 border-b border-border/40">Fresh %</th>
                <th className="text-right px-4 py-2.5 border-b border-border/40">Rerun</th>
                <th className="text-right px-4 py-2.5 pr-6 border-b border-border/40">Download</th>
              </tr>
            </thead>
            <tbody className="">
              {finalJobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-muted-foreground font-medium">
                    No active or historical scraper jobs found.
                  </td>
                </tr>
              ) : (
                finalJobs.map((j) => {
                  const showNewBadge = j.isCustomSource;
                  const isNewSourceOnboarding = j.isCustomSource;
                  const isCustomScrape = isCustomScrapeJob(j);
                  const displayStatus = j.status === "Failed" ? "Aborted" : j.status;
                  const uploadedFilename = (j.mode === "Any-Site" || j.mode === "By Dataset") ? getAnySiteUploadedFilename(j.filters) : "";
                  const sourceDisplayName = isNewSourceOnboarding
                    ? getNewSourceDisplayName(j.source)
                    : (uploadedFilename || getBotDisplayName(j.source, catalog));

                  return (
                    <tr key={j.id} className="hover:bg-secondary/60 group">
                      <td className="px-4 py-3.5 font-mono border-b border-border/40 text-left text-[13px] leading-normal whitespace-pre-line text-foreground">
                        {j.id.includes("-") ? `${j.id.split("-")[0]}-\n${j.id.split("-")[1]}` : j.id}
                      </td>
                      <td className="px-4 py-3.5 border-b border-border/40 text-left">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-[13px] text-foreground">{sourceDisplayName}</span>
                            {showNewBadge && (
                              <Badge tone="warning" className="text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-semibold">NEW</Badge>
                            )}
                            <Badge tone="purple" className="text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-semibold">{j.frequency}</Badge>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 border-b border-border/40 text-left">
                        <Badge tone={(j.mode === "Site-Specific" || j.mode === "By Source") ? "info" : "purple"}>
                          {(j.mode === "Site-Specific" || j.mode === "By Source") ? "Agents" : "Solutions"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground border-b border-border/40 text-left">
                        <div className="flex flex-col">
                          <span>{j.last_refresh ? formatRelativeTime(j.last_refresh) : j.run || "—"}</span>
                          {j.status !== "Pending Onboarding" && (computeNextRunTime(j) || j.next_refresh) && (
                            <span className="text-[11px] text-muted-foreground/75 mt-0.5 font-medium">
                              Next: {formatDateTime(computeNextRunTime(j) || j.next_refresh)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 border-b border-border/40 text-left">
                        <div className="flex items-center gap-2">
                          <Badge tone={tone(j.status)}>{displayStatus}</Badge>
                          {j.status === "Running" && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono border-b border-border/40 text-[13px] text-foreground font-semibold">
                        {isCustomScrape ? "—" : (j.records !== null && j.records !== undefined ? j.records.toLocaleString() : "—")}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono border-b border-border/40 text-[13px] text-foreground font-semibold">
                        {isCustomScrape
                          ? "—"
                          : (j.status === "Completed" ? "100%" : ((j.status === "Failed" || j.status === "Aborted") ? "0%" : (j.fresh !== null && j.fresh !== undefined ? `${j.fresh}%` : "—")))}
                      </td>
                      <td className="px-4 py-3.5 text-right border-b border-border/40">
                        {String(j.frequency).toLowerCase() === "weekly" && (
                          rerunJobId === j.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <input type="datetime-local" value={rerunAt} min={new Date().toISOString().slice(0, 16)} onChange={(event) => setRerunAt(event.target.value)} className="h-8 w-40 rounded-md border border-border bg-card px-2 text-[11px]" />
                              <Button size="sm" disabled={!rerunAt || rerunBusyId === j.id} onClick={() => void rerunWeeklyJob(j, rerunAt)}>Schedule</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRerunJobId(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <div className="inline-flex gap-1">
                              <Button size="sm" variant="outline" disabled={rerunBusyId === j.id} onClick={() => void rerunWeeklyJob(j)}><RefreshCw className="h-3.5 w-3.5" /> Run now</Button>
                              <Button size="sm" variant="outline" disabled={rerunBusyId === j.id} onClick={() => { setRerunAt(""); setRerunJobId(j.id); }}><Timer className="h-3.5 w-3.5" /> Schedule later</Button>
                            </div>
                          )
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right border-b border-border/40 pr-6 relative">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            title={j.isUrgent ? "Clear urgent" : "Mark urgent"}
                            aria-label={`${j.isUrgent ? "Clear urgent" : "Mark urgent"} job ${j.id}`}
                            disabled={urgentBusyId === j.id}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleUrgent(j);
                            }}
                            className={`relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition cursor-pointer ${
                              j.isUrgent
                                ? "border-warning bg-warning-bg/40 text-warning hover:bg-warning-bg/60"
                                : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                            } ${urgentBusyId === j.id ? "opacity-70" : ""}`}
                            style={{
                              pointerEvents: urgentBusyId === j.id ? "none" : "auto",
                            }}
                          >
                            <Star className={`h-3.5 w-3.5 ${j.isUrgent ? "fill-warning" : ""}`} />
                          </button>
                          <button
                            type="button"
                            title="Delete job"
                            aria-label={`Delete job ${j.id}`}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteJob(j.id);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div className="inline-block text-left">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={j.status !== "Completed"}
                              onClick={() => setOpenExportId(openExportId === j.id ? null : j.id)}
                              className="flex items-center gap-1 h-8 px-2.5 text-[12px] bg-card border border-border rounded-md font-medium transition hover:bg-secondary"
                            >
                              <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span>Export</span>
                              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 ml-0.5" />
                            </Button>
                            {openExportId === j.id && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setOpenExportId(null)} />
                                <div className="absolute right-0 mt-1 w-32 rounded-md shadow-lg bg-card border border-border z-50 py-1 text-left">
                                  <button
                                    onClick={() => {
                                      setOpenExportId(null);
                                      window.open(`${baseApiUrl}/api/v1/export?run_id=${j.id}&format=csv`, "_blank");
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-foreground font-medium"
                                  >
                                    CSV
                                  </button>
                                  <button
                                    onClick={() => {
                                      setOpenExportId(null);
                                      window.open(`${baseApiUrl}/api/v1/export?run_id=${j.id}&format=json`, "_blank");
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-foreground font-medium"
                                  >
                                    JSON
                                  </button>
                                  <button
                                    onClick={() => {
                                      setOpenExportId(null);
                                      window.open(`${baseApiUrl}/api/v1/export?run_id=${j.id}&format=xlsx`, "_blank");
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-foreground font-medium"
                                  >
                                    Excel (.xlsx)
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </AppLayout>
  );
}
