import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Activity } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import { readJobsCache, writeJobsCache } from "@/lib/jobs-cache";

export const Route = createFileRoute("/playbooks/agents")({
  head: () => ({
    meta: [{ title: "Agents & Sources — Freda" }],
  }),
  component: AgentsPage,
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
};

function statusTone(status?: string): "info" | "warning" | "success" | "destructive" | "neutral" {
  const s = String(status || "").trim();
  if (s === "Running") return "info";
  if (s === "Review Pending" || s === "Review") return "warning";
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

function isAgentJob(job: Job) {
  const mode = String(job.mode || "").toLowerCase();
  return mode === "by source" || mode === "site-specific" || (!mode && mode !== "by dataset");
}

function getSourceLabel(job: Job) {
  return String(job.source || job.project || job.id || "Untitled").trim();
}

function formatRecords(job: Job) {
  const n = Number(job.rows || 0) || Number(job.records || 0) || 0;
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function AgentsPage() {
  const [jobs, setJobs] = useState<Job[]>(() => readJobsCache() as Job[]);
  const [search, setSearch] = useState("");

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
        // Fall back to local cache.
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

  const agentJobs = useMemo(
    () =>
      jobs
        .filter(isAgentJob)
        .sort((a, b) => {
          const ta = Date.parse(a.last_refresh || a.created_at || "0");
          const tb = Date.parse(b.last_refresh || b.created_at || "0");
          return tb - ta;
        }),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    if (!search.trim()) return agentJobs;
    const q = search.trim().toLowerCase();
    return agentJobs.filter((job) => getSourceLabel(job).toLowerCase().includes(q));
  }, [agentJobs, search]);

  return (
    <AppLayout>
      <PageHeader
        title="Agents & sources"
        subtitle="Sites onboarded and running as Freda agents"
        actions={
          <>
            <Link to="/playbooks">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                Back to Playbooks
              </Button>
            </Link>
            <Link to="/monitoring">
              <Button variant="outline" size="sm">
                <Activity className="h-4 w-4" />
                Monitoring
              </Button>
            </Link>
          </>
        }
      />

      <div className="px-7 pb-8 space-y-4">
        <div className="flex items-center gap-3">
          <input
            type="search"
            placeholder="Filter by source name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-72 rounded-md border border-border bg-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Badge tone="neutral">{filteredJobs.length} agents</Badge>
        </div>

        <Card className="p-0 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px] border-separate border-spacing-0">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              <tr>
                <th className="text-left px-4 py-3 border-b border-border/40">Source</th>
                <th className="text-right px-4 py-3 border-b border-border/40">Records</th>
                <th className="text-left px-4 py-3 border-b border-border/40">Status</th>
                <th className="text-right px-4 py-3 border-b border-border/40">Last refresh</th>
                <th className="text-right px-4 py-3 pr-5 border-b border-border/40">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    {search ? "No agents match your search." : "No agent jobs found."}
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-border/40 last:border-b-0 hover:bg-secondary/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground truncate max-w-[240px]">{getSourceLabel(job)}</div>
                      {job.mode && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{job.mode}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatRecords(job)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(job.status)}>{job.status || "Unknown"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatRelativeDate(job.last_refresh || job.created_at)}
                    </td>
                    <td className="px-4 py-3 pr-5 text-right">
                      <Link to="/review" search={{ jobId: job.id } as any}>
                        <Button variant="outline" size="sm">
                          Review
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">Add a new source</div>
              <div className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
                To onboard a new site as a Freda agent, use the Solutions wizard to describe your data
                requirements. The admin team will review and set up the agent within the agreed SLA.
              </div>
            </div>
            <Link to="/any-site" className="shrink-0">
              <Button size="sm">
                Open Solutions wizard
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
