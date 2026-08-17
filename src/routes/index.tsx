import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckSquare,
  Database,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, SectionTitle } from "@/components/ui-bits";
import { ReviewDialog } from "@/components/ReviewDialog";
import { useActiveCustomer } from "@/lib/workspace";
import { actionsFor, compact, devPipeline, fmt, hrsAgo, inHrs, rollup, type Project } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FreDA Dashboard — Data health & review" },
      { name: "description", content: "Monitor dataset health, ADMV changes and approve record-level updates for your live FreDA data projects." },
      { property: "og:title", content: "FreDA Dashboard — Data health & review" },
      { property: "og:description", content: "Monitor dataset health, ADMV changes and approve record-level updates for your live FreDA data projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

const statusTone = { Healthy: "success", "Review pending": "warning", Refreshing: "info", Attention: "destructive" } as const;

function DashboardPage() {
  const customer = useActiveCustomer();
  const stats = useMemo(() => rollup(customer), [customer.id]);
  const actions = useMemo(() => actionsFor(customer), [customer.id]);
  const pipeline = useMemo(() => devPipeline(customer), [customer.id]);

  const [reviewProject, setReviewProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string>(customer.projects[0]!.id);
  const active = customer.projects.find((p) => p.id === selected) ?? customer.projects[0]!;

  const admvTotal = stats.admv.added + stats.admv.deleted + stats.admv.modified + stats.admv.verified;

  return (
    <AppLayout>
      <PageHeader
        title={`${customer.name} · Data workspace`}
        subtitle={`${stats.projects} live projects · ${fmt(stats.records)} records under management · account since ${customer.since}`}
        actions={
          <>
            <Button variant="outline" size="sm">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh all
            </Button>
            <Button size="sm" onClick={() => setReviewProject(active)}>
              <CheckSquare className="h-3.5 w-3.5" /> Review {fmt(stats.pendingReview)} changes
            </Button>
          </>
        }
      />

      <div className="px-7 pb-8 space-y-5">
        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Kpi label="Records managed" value={compact(stats.records)} sub={`${stats.projects} projects`} icon={Database} tone="info" />
          <Kpi label="Pending review" value={fmt(stats.pendingReview)} sub="record-level changes" icon={CheckSquare} tone="warning" />
          <Kpi label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} sub="approved / reviewed" icon={ShieldCheck} tone="success" />
          <Kpi label="Coverage" value={`${stats.coverage.toFixed(1)}%`} sub="fields populated" icon={TrendingUp} tone="purple" />
          <Kpi label="Freshness" value={`${Math.round(stats.freshness)}%`} sub="vs refresh schedule" icon={Clock} tone="info" />
        </div>

        {/* ADMV */}
        <Card className="p-5">
          <SectionTitle hint="last refresh cycle across all projects">ADMV — change signature</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
            <Admv label="Added" value={stats.admv.added} total={admvTotal} tone="success" />
            <Admv label="Deleted" value={stats.admv.deleted} total={admvTotal} tone="destructive" />
            <Admv label="Modified" value={stats.admv.modified} total={admvTotal} tone="warning" />
            <Admv label="Verified" value={stats.admv.verified} total={admvTotal} tone="info" />
          </div>
        </Card>

        {/* Projects + inline review */}
        <div className="grid xl:grid-cols-[1.55fr_1fr] gap-5 items-start">
          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Projects & datasets</h3>
                <p className="text-[12px] text-muted-foreground mt-1">Click a project to load its review panel.</p>
              </div>
              <Badge tone="neutral">{customer.projects.length} datasets</Badge>
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-5 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Records</th>
                  <th className="px-3 py-2 font-semibold">ADMV</th>
                  <th className="px-3 py-2 font-semibold">Freshness</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-5 py-2 font-semibold text-right">Review</th>
                </tr>
              </thead>
              <tbody>
                {customer.projects.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    className={cn("border-b border-border/60 cursor-pointer hover:bg-secondary/40", p.id === selected && "bg-info-bg/60")}
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.source} · {p.datapoints.length} datapoints · {p.frequency}
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{compact(p.records)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-success">+{compact(p.admv.added)}</span>
                        <span className="text-destructive">-{compact(p.admv.deleted)}</span>
                        <span className="text-warning">~{compact(p.admv.modified)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Bar value={p.freshness} />
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[p.status] as any}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        size="sm"
                        variant={p.pendingReview > 0 ? "primary" : "outline"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setReviewProject(p);
                        }}
                      >
                        {p.pendingReview > 0 ? `${fmt(p.pendingReview)} to review` : "View records"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Review snapshot for selected project */}
          <Card className="p-5">
            <SectionTitle hint={active.frequency}>Review snapshot</SectionTitle>
            <div className="text-[14px] font-semibold mt-1">{active.name}</div>
            <div className="text-[12px] text-muted-foreground">
              {active.source} · last refresh {hrsAgo(active.lastRefreshHrs)} · next {inHrs(active.nextRefreshHrs)}
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <MiniStat label="Pending" value={fmt(active.pendingReview)} tone="warning" />
              <MiniStat label="Accuracy" value={`${active.accuracy}%`} tone="success" />
              <MiniStat label="Coverage" value={`${active.coverage}%`} tone="info" />
            </div>

            <div className="mt-5">
              <SectionTitle>Accuracy trend</SectionTitle>
              <Spark points={active.history.map((h) => h.accuracy)} labels={active.history.map((h) => h.label)} />
            </div>

            <div className="mt-5">
              <SectionTitle hint={`${active.datapoints.length} tracked`}>Datapoints</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {active.datapoints.slice(0, 12).map((d) => (
                  <span key={d} className="px-2 py-0.5 rounded-md bg-secondary text-[11px] text-secondary-foreground">
                    {d}
                  </span>
                ))}
                <span className="px-2 py-0.5 rounded-md bg-secondary text-[11px] text-muted-foreground">
                  +{active.datapoints.length - 12} more
                </span>
              </div>
            </div>

            <Button className="w-full mt-5" onClick={() => setReviewProject(active)}>
              <CheckSquare className="h-3.5 w-3.5" /> Open record-by-record review
            </Button>
          </Card>
        </div>

        {/* Action needed + development pipeline */}
        <div className="grid xl:grid-cols-2 gap-5 items-start">
          <Card className="p-5">
            <SectionTitle hint="sorted by volume">Action needed</SectionTitle>
            <div className="space-y-2 mt-2">
              {actions.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span
                    className={cn(
                      "h-8 w-8 rounded-md inline-flex items-center justify-center shrink-0",
                      a.priority === "Critical" ? "bg-destructive/10 text-destructive" : a.priority === "High" ? "bg-warning-bg text-warning" : "bg-info-bg text-info",
                    )}
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{a.action}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {a.project} · {fmt(a.records)} records · {a.age}
                    </div>
                  </div>
                  <Badge tone={a.priority === "Critical" ? "destructive" : a.priority === "High" ? "warning" : "info"}>{a.priority}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReviewProject(customer.projects.find((p) => p.id === a.projectId) ?? null)}
                  >
                    Resolve
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle hint="FreDA delivery team">Solution development in progress</SectionTitle>
            <div className="space-y-3 mt-2">
              {pipeline.map((d) => (
                <div key={d.id} className="rounded-lg border border-border px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium flex-1 truncate">{d.title}</span>
                    <Badge tone="purple">{d.stage}</Badge>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${d.progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
                    <span>
                      {d.id} · owner {d.owner}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      ETA {d.eta} <ArrowUpRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <ReviewDialog project={reviewProject} open={!!reviewProject} onOpenChange={(v) => !v && setReviewProject(null)} />
    </AppLayout>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Database;
  tone: "info" | "success" | "warning" | "purple";
}) {
  const toneCls = {
    info: "bg-info-bg text-info",
    success: "bg-success-bg text-success",
    warning: "bg-warning-bg text-warning",
    purple: "bg-purple-bg text-purple-token",
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
          <div className="text-[24px] font-semibold tracking-tight mt-1 tabular-nums">{value}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
        </div>
        <span className={cn("h-8 w-8 rounded-md inline-flex items-center justify-center", toneCls)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Card>
  );
}

function Admv({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total ? (value / total) * 100 : 0;
  const bar = { success: "bg-success", destructive: "bg-destructive", warning: "bg-warning", info: "bg-primary" }[tone]!;
  return (
    <div className="rounded-lg border border-border p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <div className="text-[20px] font-semibold tabular-nums mt-1">{fmt(value)}</div>
      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "warning" | "success" | "info" }) {
  const cls = { warning: "text-warning", success: "text-success", info: "text-info" }[tone];
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={cn("text-[17px] font-semibold tabular-nums mt-0.5", cls)}>{value}</div>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
        <div className={cn("h-full rounded-full", value > 85 ? "bg-success" : value > 72 ? "bg-warning" : "bg-destructive")} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{value}%</span>
    </div>
  );
}

export function Spark({ points, labels }: { points: number[]; labels: string[] }) {
  const min = Math.min(...points) - 1;
  const max = Math.max(...points) + 1;
  const w = 100;
  const h = 40;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / (max - min)) * h}`)
    .join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16">
        <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{labels[0]} · {points[0]}%</span>
        <span>{labels[labels.length - 1]} · {points[points.length - 1]}%</span>
      </div>
    </div>
  );
}
