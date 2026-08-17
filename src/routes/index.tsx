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
  PlusCircle,
  MinusCircle,
  PencilLine,
  BadgeCheck,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  AdmvBar,
  Badge,
  Button,
  Card,
  DEFAULT_RANGE,
  Donut,
  PageHeader,
  RangeFilter,
  rangeDays,
  SectionTitle,
  Select,
  type RangeValue,
} from "@/components/ui-bits";
import { ReviewDialog } from "@/components/ReviewDialog";
import { useActiveCustomer } from "@/lib/workspace";
import {
  actionsFor,
  admvPct,
  compact,
  devPipeline,
  fmt,
  hrsAgo,
  inHrs,
  rangeFactor,
  rollupProjects,
  scaleAdmv,
  type Project,
  type ProjectStatus,
} from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Customer Dashboard — FreDA data workspace" },
      {
        name: "description",
        content: "Customer-specific dashboard with ADMV signature, action needed by project and date, and an expanded record-level review workspace.",
      },
      { property: "og:title", content: "Customer Dashboard — FreDA data workspace" },
      {
        property: "og:description",
        content: "Customer-specific dashboard with ADMV signature, action needed by project and date, and an expanded record-level review workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

export const statusTone: Record<ProjectStatus, "success" | "warning" | "info" | "destructive"> = {
  "In sync": "success",
  "Review pending": "warning",
  Syncing: "info",
  "Needs attention": "destructive",
};

function DashboardPage() {
  const customer = useActiveCustomer();
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [scope, setScope] = useState<string>("all");
  const [reviewProject, setReviewProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string>(customer.projects[0]!.id);

  const scoped = scope === "all" ? customer.projects : customer.projects.filter((p) => p.id === scope);
  const factor = rangeFactor(range.key, rangeDays(range));

  const stats = useMemo(() => rollupProjects(scoped), [customer.id, scope]);
  const admv = scaleAdmv(stats.admv, factor);
  const pct = admvPct(admv);
  const pendingScaled = Math.round(stats.pendingReview * Math.min(1.6, factor));

  const actions = useMemo(() => actionsFor(customer), [customer.id]);
  const windowDays = rangeDays(range);
  const visibleActions = actions.filter((a) => (scope === "all" || a.projectId === scope) && a.ageDays < windowDays);

  const pipeline = useMemo(() => devPipeline(customer), [customer.id]);
  const active = scoped.find((p) => p.id === selected) ?? scoped[0] ?? customer.projects[0]!;

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        subtitle={`${customer.name} · ${customer.projects.length} projects · ${fmt(rollupProjects(customer.projects).records)} records under management · account since ${customer.since}`}
        actions={
          <Button size="sm" onClick={() => setReviewProject(active)}>
            <CheckSquare className="h-3.5 w-3.5" /> Open review workspace
          </Button>
        }
      />

      <div className="px-7 pb-8 space-y-5">
        {/* scope bar */}
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
            Showing <strong className="text-foreground">{stats.projects}</strong> project{stats.projects === 1 ? "" : "s"} ·{" "}
            {stats.datapoints} datapoints · {stats.sources} sources
          </div>
        </Card>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Kpi label="Records managed" value={compact(stats.records)} sub={`${stats.projects} projects in scope`} icon={Database} tone="info" />
          <Kpi label="Pending review" value={fmt(pendingScaled)} sub="record-level changes" icon={CheckSquare} tone="warning" />
          <Kpi label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} sub="approved / reviewed" icon={ShieldCheck} tone="success" />
          <Kpi label="Coverage" value={`${stats.coverage.toFixed(1)}%`} sub="fields populated" icon={TrendingUp} tone="purple" />
          <Kpi label="Freshness" value={`${Math.round(stats.freshness)}%`} sub="vs refresh schedule" icon={Clock} tone="info" />
        </div>

        {/* ADMV signature */}
        <Card className="p-5">
          <SectionTitle hint={`${scope === "all" ? "all projects" : active.name} · ${rangeLabel(range)}`}>
            ADMV — change signature
          </SectionTitle>
          <div className="grid xl:grid-cols-[1fr_1fr] gap-6 mt-3 items-stretch">
            <div className="grid grid-cols-2 gap-3.5">
              <Admv label="Added" value={admv.added} pct={pct.added} tone="success" icon={PlusCircle} />
              <Admv label="Deleted" value={admv.deleted} pct={pct.deleted} tone="destructive" icon={MinusCircle} />
              <Admv label="Modified" value={admv.modified} pct={pct.modified} tone="warning" icon={PencilLine} />
              <Admv label="Verified" value={admv.verified} pct={pct.verified} tone="info" icon={BadgeCheck} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Per project mix</div>
              <div className="space-y-2.5">
                {scoped.map((p) => {
                  const a = scaleAdmv(p.admv, factor);
                  const ap = admvPct(a);
                  return (
                    <div key={p.id}>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="truncate">{p.name}</span>
                        <span className="text-muted-foreground tabular-nums text-[11px]">
                          A {ap.added.toFixed(1)}% · D {ap.deleted.toFixed(1)}% · M {ap.modified.toFixed(1)}% · V {ap.verified.toFixed(1)}%
                        </span>
                      </div>
                      <AdmvBar a={a} className="mt-1" />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* Review section */}
        <div className="grid xl:grid-cols-[1.55fr_1fr] gap-5 items-stretch">
          <Card className="overflow-hidden h-full flex flex-col">
            <div className="px-5 pt-4 pb-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Review by project</h3>
                <p className="text-[12px] text-muted-foreground mt-1">ADMV split per project — open the expanded review workspace to approve.</p>
              </div>
              <Badge tone="neutral">{scoped.length} in scope</Badge>
            </div>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Records</th>
                  <th className="px-3 py-2 font-semibold w-[150px]">ADMV %</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold text-right">Review</th>
                </tr>
              </thead>
              <tbody>
                {scoped.map((p) => {
                  const a = scaleAdmv(p.admv, factor);
                  const ap = admvPct(a);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelected(p.id)}
                      className={cn("border-b border-border/60 cursor-pointer hover:bg-secondary/40", p.id === active.id && "bg-info-bg/60")}
                    >
                      <td className="px-4 py-3 min-w-[195px]">
                        <div className="font-medium whitespace-nowrap">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {p.sources.length} sources · {p.datapoints.length} datapoints · {p.frequency}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{compact(p.records)}</td>
                      <td className="px-3 py-3">
                        <AdmvBar a={a} />
                        <div className="text-[9.5px] text-muted-foreground mt-1 tabular-nums whitespace-nowrap">
                          A {ap.added.toFixed(1)} · D {ap.deleted.toFixed(1)} · M {ap.modified.toFixed(1)} · V {ap.verified.toFixed(1)}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge tone={statusTone[p.status]}>{p.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          className="whitespace-nowrap"
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
                  );
                })}
              </tbody>
            </table>
            </div>
          </Card>

          <Card className="p-5 h-full flex flex-col">
            <SectionTitle hint={active.frequency}>Review snapshot</SectionTitle>
            <div className="text-[14px] font-semibold mt-1">{active.name}</div>
            <div className="text-[12px] text-muted-foreground">
              {active.source} · last refresh {hrsAgo(active.lastRefreshHrs)} · next {inHrs(active.nextRefreshHrs)}
            </div>

            <div className="flex items-center justify-around gap-3 mt-4">
              <Donut value={active.accuracy} label="accuracy" tone="success" />
              <Donut value={active.coverage} label="coverage" />
              <Donut value={active.freshness} label="fresh" tone={active.freshness > 80 ? "success" : "warning"} />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <MiniStat label="Pending" value={fmt(active.pendingReview)} tone="warning" />
              <MiniStat label="Sources" value={String(active.sources.length)} tone="info" />
            </div>

            <div className="mt-5">
              <SectionTitle>Accuracy trend</SectionTitle>
              <Spark points={active.history.map((h) => h.accuracy)} labels={active.history.map((h) => h.label)} />
            </div>

            <div className="mt-4 mb-5">
              <SectionTitle hint={`${active.datapoints.length} tracked`}>Datapoints</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {active.datapoints.slice(0, 10).map((d) => (
                  <span key={d} className="px-2 py-0.5 rounded-md bg-secondary text-[11px] text-secondary-foreground">
                    {d}
                  </span>
                ))}
                {active.datapoints.length > 10 && (
                  <span className="px-2 py-0.5 rounded-md bg-secondary text-[11px] text-muted-foreground">
                    +{active.datapoints.length - 10} more
                  </span>
                )}
              </div>
            </div>

            <Button className="w-full mt-auto pt-0.5" onClick={() => setReviewProject(active)}>
              <CheckSquare className="h-3.5 w-3.5" /> Open record-by-record review
            </Button>
          </Card>
        </div>

        {/* Action needed + delivery pipeline */}
        <div className="grid xl:grid-cols-2 gap-5 items-stretch">
          <Card className="p-5 h-full flex flex-col">
            <SectionTitle hint={`${visibleActions.length} open · ${rangeLabel(range)}`}>Action needed</SectionTitle>
            <div className="space-y-2 mt-2">
              {visibleActions.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
                  Nothing outstanding for this project and time window.
                </div>
              )}
              {visibleActions.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span
                    className={cn(
                      "h-8 w-8 rounded-md inline-flex items-center justify-center shrink-0",
                      a.priority === "Critical"
                        ? "bg-destructive/10 text-destructive"
                        : a.priority === "High"
                          ? "bg-warning-bg text-warning"
                          : "bg-info-bg text-info",
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

          <Card className="p-5 h-full flex flex-col">
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

function rangeLabel(r: RangeValue) {
  if (r.key === "today") return "today";
  if (r.key === "7d") return "last week";
  if (r.key === "30d") return "last month";
  return r.from && r.to ? `${r.from} → ${r.to}` : "custom range";
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

function Admv({
  label,
  value,
  pct,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  pct: number;
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const bar = { success: "bg-success", destructive: "bg-destructive", warning: "bg-warning", info: "bg-primary" }[tone]!;
  const chip = {
    success: "bg-success-bg text-success",
    destructive: "bg-destructive/10 text-destructive",
    warning: "bg-warning-bg text-warning",
    info: "bg-info-bg text-info",
  }[tone]!;
  return (
    <div className="rounded-lg border border-border p-3.5 flex gap-3 items-start">
      <span className={cn("h-9 w-9 shrink-0 rounded-md inline-flex items-center justify-center", chip)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-muted-foreground truncate">{label}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
        </div>
        <div className="text-[20px] font-semibold tabular-nums mt-0.5">{fmt(value)}</div>
        <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
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

export function Spark({ points, labels }: { points: number[]; labels: string[] }) {
  const min = Math.min(...points) - 1;
  const max = Math.max(...points) + 1;
  const w = 100;
  const h = 40;
  const d = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / (max - min)) * h}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16">
        <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>
          {labels[0]} · {points[0]}%
        </span>
        <span>
          {labels[labels.length - 1]} · {points[points.length - 1]}%
        </span>
      </div>
    </div>
  );
}
