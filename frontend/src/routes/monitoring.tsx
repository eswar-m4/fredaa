import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Card, PageHeader, Button } from "@/components/ui-bits";
import { Download, ChevronDown } from "lucide-react";
import bots from "@/data/bots.json";


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

function tone(s: string) {
  if (s === "Running") return "info" as const;
  if (s === "Completed") return "success" as const;
  if (s === "Review") return "warning" as const;
  if (s === "Analysis Complete" || s === "Pending Onboarding") return "warning" as const;
  return "destructive" as const;
}

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
  
  const catalogMatch = bots.bots.find(b => {
    const bNameClean = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return bNameClean === lowerBase || 
      lowerBase.includes(bNameClean) ||
      bNameClean.includes(lowerBase);
  });
  if (catalogMatch) {
    if (catalogMatch.name.toLowerCase() === "webmd") return "WebMD";
    return catalogMatch.name;
  }
  
  if (/^\d+[a-z]/i.test(baseName)) {
    const numPart = baseName.match(/^\d+/)?.[0] || "";
    const textPart = baseName.slice(numPart.length);
    return numPart + textPart.charAt(0).toUpperCase() + textPart.slice(1);
  }
  return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}


function Monitoring() {
  const [customJobs, setCustomJobs] = useState<any[]>([]);
  const [openExportId, setOpenExportId] = useState<string | null>(null);

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
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`);
        if (response.ok) {
          const data = await response.json();
          if (active) {
            setCustomJobs(data);
          }
        }
      } catch (err) {
        console.error("Failed to fetch jobs from backend:", err);
      }
    }

    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [baseApiUrl]);

  const combinedJobs = [...customJobs].reverse().map((j) => {
    const sourceName = j.source || j.source_name || j.website_url || "Unknown Source";
    return {
      id: j.id || `J-${Date.now()}`,
      source: sourceName,
      mode: j.mode || "Site-Specific",
      run: formatRelativeTime(j.created_at),
      status: (j.status === "Analysis Complete" || (j.status === "Running" && (j.isCustomSource ?? true) && (j.refresh_count === 0 || !j.refresh_count))) ? "Pending Onboarding" : j.status,
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
      changes_detected: j.changes_detected ?? 0,
      complexity: j.complexity || null,
      estimated_onboarding_time: j.estimated_onboarding_time || null,
      created_at: j.created_at,
    };
  });

  // Deduplicate combinedJobs by ID and clean source name
  const deduplicatedJobs: any[] = [];
  const seenIds = new Set<string>();
  const seenSources = new Set<string>();

  // Sort: we want Completed/Running/Review status to take precedence over Pending Onboarding / Analysis Complete
  const sortedJobs = [...combinedJobs].sort((a, b) => {
    const score = (status: string) => {
      if (status === "Running") return 3;
      if (status === "Completed") return 2;
      if (status === "Review") return 2;
      return 1;
    };
    return score(b.status) - score(a.status);
  });

  for (const j of sortedJobs) {
    if (seenIds.has(j.id)) continue;
    seenIds.add(j.id);

    const nameKey = cleanSourceName(j.source).toLowerCase();
    if (seenSources.has(nameKey)) {
      continue;
    }
    seenSources.add(nameKey);
    deduplicatedJobs.push(j);
  }

  // Restore the original sorting by filtering combinedJobs
  const finalJobs = combinedJobs.filter((j) => deduplicatedJobs.some((dj) => dj.id === j.id));

  const runningCount = finalJobs.filter((j) => j.status === "Running").length;
  const completedCount = finalJobs.filter((j) => j.status === "Completed").length;
  const reviewCount = finalJobs.filter((j) => j.status === "Review").length;
  const failedCount = finalJobs.filter((j) => j.status === "Failed").length;
  return (
    <AppLayout>
      <PageHeader title="Monitoring" subtitle="Live state of refreshes across both approaches." />
      <div className="px-7 pb-8 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { l: "Running", v: runningCount, t: "info" as const },
            { l: "Completed today", v: completedCount, t: "success" as const },
            { l: "Needs review", v: reviewCount, t: "warning" as const },
            { l: "Failed", v: failedCount, t: "destructive" as const },
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
                <th className="text-right px-4 py-2.5 pr-6 border-b border-border/40">Download</th>
              </tr>
            </thead>
            <tbody className="">
              {finalJobs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground font-medium">
                    No active or historical scraper jobs found.
                  </td>
                </tr>
              ) : (
                finalJobs.map((j) => {
                  const isCatalog = bots.bots.some((b) => 
                    j.source.toLowerCase().includes(b.name.toLowerCase()) || 
                    b.name.toLowerCase().includes(j.source.toLowerCase())
                  );
                  const showNewBadge = j.isCustomSource && !isCatalog;
                  const sourceDisplayName = getSourceDisplayName(j.source);

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
                        <Badge tone={j.mode === "Site-Specific" ? "info" : "purple"}>
                          {j.mode === "Site-Specific" ? "Site-Specific" : "Any-Site"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground border-b border-border/40 text-left">
                        <div className="flex flex-col">
                          <span>{j.last_refresh ? formatRelativeTime(j.last_refresh) : j.run || "—"}</span>
                          {j.next_refresh && j.status === "Completed" && (
                            <span className="text-[11px] text-muted-foreground/75 mt-0.5 font-medium">
                              Next: {new Date(j.next_refresh).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 border-b border-border/40 text-left">
                        <div className="flex items-center gap-2">
                          <Badge tone={tone(j.status)}>{j.status}</Badge>
                          {j.status === "Running" && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono border-b border-border/40 text-[13px] text-foreground font-semibold">
                        {j.records !== null && j.records !== undefined ? j.records.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono border-b border-border/40 text-[13px] text-foreground font-semibold">
                        {j.status === "Completed" ? "100%" : (j.status === "Failed" ? "0%" : (j.fresh !== null && j.fresh !== undefined ? `${j.fresh}%` : "—"))}
                      </td>
                      <td className="px-4 py-3.5 text-right border-b border-border/40 pr-6 relative">
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
