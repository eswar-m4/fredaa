import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  Timer,
  Cloud,
  Download,
  Pause,
  Play,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  Badge,
  Button,
  Card,
  DEFAULT_RANGE,
  PageHeader,
  RangeFilter,
  rangeDays,
  SectionTitle,
  Select,
  type RangeValue,
} from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { compact, destinationsFor, fmt, hrsAgo, inHrs, jobsFor, rollupProjects, type JobRun } from "@/data/customers";
import { statusTone } from "@/routes/index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring — FreDA" },
      {
        name: "description",
        content: "Live job automation status, refresh schedule health and delivery destinations for every FreDA dataset.",
      },
      { property: "og:title", content: "Monitoring — FreDA" },
      {
        property: "og:description",
        content: "Live job automation status, refresh schedule health and delivery destinations for every FreDA dataset.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MonitoringPage,
});

const jobTone: Record<JobRun["state"], "info" | "neutral" | "success" | "destructive"> = {
  Running: "info",
  Queued: "neutral",
  Succeeded: "success",
  Failed: "destructive",
};

function MonitoringPage() {
  const customer = useActiveCustomer();
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [scope, setScope] = useState("all");
  const [filter, setFilter] = useState("all");
  const [running, setRunning] = useState<Record<string, number>>({});

  const scoped = scope === "all" ? customer.projects : customer.projects.filter((p) => p.id === scope);
  const stats = useMemo(() => rollupProjects(scoped), [customer.id, scope]);
  const jobs = useMemo(() => jobsFor(customer), [customer.id]);
  const destinations = useMemo(() => destinationsFor(customer), [customer.id]);

  const days = rangeDays(range);
  const visibleJobs = jobs.filter((j) => (scope === "all" || j.projectId === scope) && j.startedHrs <= days * 24);
  const projects = scoped.filter((p) => filter === "all" || p.status === filter);

  function refresh(id: string) {
    setRunning((r) => ({ ...r, [id]: 0 }));
    let pct = 0;
    const t = setInterval(() => {
      pct += 12;
      setRunning((r) => ({ ...r, [id]: pct }));
      if (pct >= 100) {
        clearInterval(t);
        setTimeout(
          () =>
            setRunning((r) => {
              const { [id]: _drop, ...rest } = r;
              return rest;
            }),
          800,
        );
      }
    }, 260);
  }

  const live = visibleJobs.filter((j) => j.state === "Running").length;
  const failed = visibleJobs.filter((j) => j.state === "Failed").length;

  return (
    <AppLayout>
      <PageHeader
        title="Monitoring"
        subtitle={`${customer.name} · job automation, schedule health and sync destinations`}
        actions={
          <Button size="sm" onClick={() => scoped.forEach((p) => refresh(p.id))}>
            <RefreshCw className="h-3.5 w-3.5" /> Run all in scope
          </Button>
        }
      />

      <div className="px-7 pb-8 space-y-5">
        <Card className="px-4 py-3 flex flex-wrap items-center gap-3">
          <Select className="w-[280px]" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All projects ({customer.projects.length})</option>
            {customer.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <RangeFilter value={range} onChange={setRange} />
          <div className="ml-auto text-[12px] text-muted-foreground">
            {fmt(stats.records)} records · {stats.sources} sources monitored
          </div>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile icon={PlayCircle} label="Automations running" value={String(live)} tone="info" />
          <Tile icon={CheckCircle2} label="In sync datasets" value={String(scoped.filter((p) => p.status === "In sync").length)} tone="success" />
          <Tile icon={AlertTriangle} label="Failed runs" value={String(failed)} tone="warning" />
          <Tile icon={Activity} label="Changes in window" value={fmt(stats.admv.added + stats.admv.deleted + stats.admv.modified)} tone="purple" />
        </div>

        {/* Job automation */}
        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Job automation status</h3>
            <p className="text-[12px] text-muted-foreground mt-1">Every crawl, parse and publish run triggered in the selected window.</p>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2 font-semibold">Run</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Trigger</th>
                  <th className="px-3 py-2 font-semibold">Stage</th>
                  <th className="px-3 py-2 font-semibold">Started</th>
                  <th className="px-3 py-2 font-semibold">Records</th>
                  <th className="px-5 py-2 font-semibold text-right">State</th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                      No automation runs in this window.
                    </td>
                  </tr>
                )}
                {visibleJobs.map((j) => (
                  <tr key={j.id} className="border-b border-border/60 hover:bg-secondary/40">
                    <td className="px-5 py-2.5 font-mono text-[11.5px]">{j.id}</td>
                    <td className="px-3 py-2.5 max-w-[240px] truncate">{j.project}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone="neutral">{j.trigger}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {j.step}
                      {j.state === "Running" && (
                        <div className="mt-1 h-1.5 w-28 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${j.progress}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {hrsAgo(j.startedHrs)} · {j.durationMin}m
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt(j.records)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Badge tone={jobTone[j.state]}>{j.state}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Schedule */}
        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border flex items-center gap-3">
            <div className="flex-1">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Refresh schedule</h3>
              <p className="text-[12px] text-muted-foreground mt-1">Existing extractions — re-run any dataset on demand.</p>
            </div>
            <Select className="w-52" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="In sync">In sync</option>
              <option value="Review pending">Review pending</option>
              <option value="Syncing">Syncing</option>
              <option value="Needs attention">Needs attention</option>
            </Select>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="px-5 py-2 font-semibold">Dataset</th>
                <th className="px-3 py-2 font-semibold">Frequency</th>
                <th className="px-3 py-2 font-semibold">Last run</th>
                <th className="px-3 py-2 font-semibold">Next run</th>
                <th className="px-3 py-2 font-semibold">Records</th>
                <th className="px-3 py-2 font-semibold">Change volume</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-5 py-2 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const pct = running[p.id];
                return (
                  <tr key={p.id} className="border-b border-border/60 hover:bg-secondary/40">
                    <td className="px-5 py-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.sources.length} sources · {p.datapoints.length} datapoints
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="neutral">{p.frequency}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{hrsAgo(p.lastRefreshHrs)}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Timer className="h-3.5 w-3.5" /> {inHrs(p.nextRefreshHrs)}
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{fmt(p.records)}</td>
                    <td className="px-3 py-3">
                      <span className="text-success">+{fmt(p.admv.added)}</span>{" "}
                      <span className="text-destructive">-{fmt(p.admv.deleted)}</span>{" "}
                      <span className="text-warning">~{fmt(p.admv.modified)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[p.status]}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {pct === undefined ? (
                        <Button size="sm" variant="outline" onClick={() => refresh(p.id)}>
                          <RefreshCw className="h-3.5 w-3.5" /> Run now
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 justify-end">
                          <div className="h-1.5 w-20 rounded-full bg-secondary overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className="text-[11px] text-muted-foreground tabular-nums w-9">{Math.min(100, pct)}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* Delivery + health */}
        <div className="grid xl:grid-cols-[1.3fr_1fr] gap-5 items-stretch">
          <Card className="p-5 h-full flex flex-col">
            <SectionTitle hint="export & sync">Delivery destinations</SectionTitle>
            <div className="space-y-2 mt-2">
              {destinations.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="h-8 w-8 rounded-md bg-info-bg text-info inline-flex items-center justify-center shrink-0">
                    <Cloud className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{d.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {d.kind} · {d.cadence} · last sync {hrsAgo(d.lastSyncHrs)} · {fmt(d.rowsLastSync)} rows
                    </div>
                  </div>
                  <Badge tone={d.state === "Connected" ? "success" : d.state === "Paused" ? "warning" : "destructive"}>{d.state}</Badge>
                  <Button size="sm" variant="outline">
                    {d.state === "Paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    {d.state === "Paused" ? "Resume" : "Pause"}
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-auto pt-4">
              <Button size="sm" variant="outline">
                <Download className="h-3.5 w-3.5" /> Download CSV snapshot
              </Button>
              <Button size="sm" variant="outline">
                <Download className="h-3.5 w-3.5" /> Download JSON delta
              </Button>
              <Button size="sm">
                <Cloud className="h-3.5 w-3.5" /> Add destination
              </Button>
            </div>
          </Card>

          <Card className="p-5 h-full flex flex-col">
            <SectionTitle hint="per dataset">Health scores</SectionTitle>
            <div className="space-y-3 mt-2">
              {scoped.map((p) => (
                <div key={p.id}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="truncate">{p.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      fresh {p.freshness}% · acc {p.accuracy}% · cov {p.coverage}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", p.freshness > 85 ? "bg-success" : p.freshness > 72 ? "bg-warning" : "bg-destructive")}
                      style={{ width: `${p.freshness}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone: "info" | "success" | "warning" | "purple";
}) {
  const cls = {
    info: "bg-info-bg text-info",
    success: "bg-success-bg text-success",
    warning: "bg-warning-bg text-warning",
    purple: "bg-purple-bg text-purple-token",
  }[tone];
  return (
    <Card className="p-4 flex items-center gap-3">
      <span className={cn("h-9 w-9 rounded-md inline-flex items-center justify-center", cls)}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className="text-[20px] font-semibold tabular-nums">{value}</div>
      </div>
    </Card>
  );
}
