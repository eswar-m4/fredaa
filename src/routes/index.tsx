import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CheckSquare,
  Database,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  Clock,
  Rocket,
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
import { ReviewDialog } from "@/components/ReviewDialog";
import { useActiveCustomer } from "@/lib/workspace";
import {
  actionsFor,
  admvPct,
  devPipeline,
  fmt,
  rangeFactor,
  reviewStatusFor,
  rollupProjects,
  scaleAdmv,
  type AdmvCounts,
  type Project,
  type ProjectStatus,
  type ReviewStatus,
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

export const reviewTone: Record<ReviewStatus, "success" | "warning" | "info"> = {
  Completed: "success",
  "In progress": "info",
  "Review pending": "warning",
};

const SEGMENTS = [
  { key: "added", label: "Added", bar: "bg-success", chip: "bg-success-bg text-success", dot: "bg-success" },
  { key: "deleted", label: "Deleted", bar: "bg-destructive", chip: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  { key: "modified", label: "Modified", bar: "bg-warning", chip: "bg-warning-bg text-warning", dot: "bg-warning" },
  { key: "verified", label: "Verified", bar: "bg-primary/60", chip: "bg-info-bg text-info", dot: "bg-primary/60" },
] as const;

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
  const actionByProject = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of actions) if (!m[a.projectId]) m[a.projectId] = a.action;
    return m;
  }, [actions]);


  const pipeline = useMemo(() => devPipeline(customer), [customer.id]);
  const active = scoped.find((p) => p.id === selected) ?? scoped[0] ?? customer.projects[0]!;
  const totalChanges = admv.added + admv.deleted + admv.modified + admv.verified;

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
          <Kpi label="Records managed" value={fmt(stats.records)} sub={`${stats.projects} projects in scope`} icon={Database} tone="info" />
          <Kpi label="Pending review" value={fmt(pendingScaled)} sub="record-level changes" icon={CheckSquare} tone="warning" />
          <Kpi label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} sub="approved / reviewed" icon={ShieldCheck} tone="success" />
          <Kpi label="Coverage" value={`${stats.coverage.toFixed(1)}%`} sub="fields populated" icon={TrendingUp} tone="purple" />
          <Kpi label="Freshness" value={`${Math.round(stats.freshness)}%`} sub="vs refresh schedule" icon={Clock} tone="info" />
        </div>

        {/* ADMV signature — full width per project chart */}
        <Card className="p-5">
          <SectionTitle hint={`${scope === "all" ? "all projects" : active.name} · ${rangeLabel(range)} · ${fmt(totalChanges)} records evaluated`}>
            ADMV — change signature
          </SectionTitle>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
            {SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-sm", s.dot)} />
                {s.label}
              </span>
            ))}
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <MixRow label="All projects in scope" sub={`${scoped.length} projects · ${fmt(totalChanges)} records`} a={admv} emphasis />
            {scoped.map((p) => (
              <MixRow
                key={p.id}
                label={p.name}
                sub={`${p.sources.length} sources · ${p.datapoints.length} datapoints · ${p.frequency}`}
                a={scaleAdmv(p.admv, factor)}
              />
            ))}
          </div>
        </Card>


        {/* Review by project — full width */}
        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Review by project</h3>
              <p className="text-[12px] text-muted-foreground mt-1">ADMV split per project — open the expanded review workspace to approve record by record.</p>
            </div>
            <Badge tone="neutral">{scoped.length} in scope</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-5 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Records</th>
                  <th className="px-3 py-2 font-semibold">Pending</th>
                  <th className="px-3 py-2 font-semibold w-[230px]">ADMV</th>
                  <th className="px-3 py-2 font-semibold">Accuracy</th>
                  <th className="px-3 py-2 font-semibold">Review status</th>
                  <th className="px-3 py-2 font-semibold">Action needed</th>
                  <th className="px-5 py-2 font-semibold text-right">Review</th>
                </tr>

              </thead>
              <tbody>
                {scoped.map((p) => {
                  const a = scaleAdmv(p.admv, factor);
                  const ap = admvPct(a);
                  const rs = reviewStatusFor(p);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelected(p.id)}
                      className={cn("border-b border-border/60 cursor-pointer hover:bg-secondary/40", p.id === active.id && "bg-info-bg/60")}
                    >
                      <td className="px-5 py-3 min-w-[220px]">
                        <div className="font-medium whitespace-nowrap">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {p.sources.length} sources · {p.datapoints.length} datapoints · {p.frequency}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">{fmt(p.records)}</td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">{fmt(p.pendingReview)}</td>
                      <td className="px-3 py-3">
                        <div className="grid grid-cols-4 gap-1 w-[220px]">
                          {SEGMENTS.map((s) => (
                            <div
                              key={s.key}
                              title={`${s.label} · ${fmt(a[s.key])} (${ap[s.key].toFixed(1)}%)`}
                              className={cn("rounded-md px-1.5 py-1 text-center", s.chip)}
                            >
                              <div className="text-[9px] uppercase tracking-wider font-semibold opacity-80">{s.label[0]}</div>
                              <div className="text-[12.5px] font-bold tabular-nums leading-tight">{fmt(a[s.key])}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">{p.accuracy}%</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge tone={reviewTone[rs]}>{rs}</Badge>
                      </td>
                      <td className="px-3 py-3 max-w-[220px]">
                        {actionByProject[p.id] ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{actionByProject[p.id]}</span>
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="px-5 py-3 text-right">
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

        {/* Solution development in progress */}
        <Card className="p-5">
          <SectionTitle hint="FreDA delivery team">Solution development in progress</SectionTitle>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-1">
            {STAGES.map((st) => {
              const items = pipeline.filter((d) => d.stage === st);
              return (
                <div
                  key={st}
                  className={cn(
                    "rounded-lg border px-3 py-2.5",
                    items.length ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/30",
                  )}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">{st}</div>
                  <div className="text-[18px] font-semibold tabular-nums mt-1">{items.length}</div>
                </div>
              );
            })}
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
            {pipeline.map((d) => {
              const stageIdx = STAGES.indexOf(d.stage);
              return (
                <div key={d.id} className="rounded-lg border border-border p-4 flex flex-col">
                  <div className="flex items-start gap-3">
                    <span className="h-9 w-9 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                      <Rocket className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium leading-snug">{d.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {d.id} · owner {d.owner}
                      </div>
                    </div>
                    <span className="text-[18px] font-semibold tabular-nums">{d.progress}%</span>
                  </div>

                  <div className="flex items-center gap-1 mt-3">
                    {STAGES.map((st, i) => (
                      <div key={st} className="flex-1" title={st}>
                        <div className={cn("h-1.5 rounded-full", i < stageIdx ? "bg-success" : i === stageIdx ? "bg-primary" : "bg-secondary")} />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px]">
                    <Badge tone="purple">{d.stage}</Badge>
                    <span className="text-muted-foreground">
                      step {stageIdx + 1} of {STAGES.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/70 text-center">
                    <Mini label="ETA" value={d.eta.replace(" working days", "d")} />
                    <Mini label="Sources" value={String(3 + (stageIdx % 4))} />
                    <Mini label="Datapoints" value={String(8 + stageIdx * 3)} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <ReviewDialog project={reviewProject} open={!!reviewProject} onOpenChange={(v) => !v && setReviewProject(null)} />
    </AppLayout>
  );
}

const STAGES = ["Scoping", "Source discovery", "Build in progress", "QA & validation", "UAT with customer"] as const;

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function MixRow({ label, sub, a, emphasis = false }: { label: string; sub: string; a: AdmvCounts; emphasis?: boolean }) {
  const p = admvPct(a);
  const total = a.added + a.deleted + a.modified + a.verified || 1;
  return (
    <div
      className={cn(
        "grid grid-cols-1 lg:grid-cols-[minmax(200px,1.1fr)_minmax(0,2fr)_auto] items-center gap-x-5 gap-y-2 px-4 py-3 border-b border-border/60 last:border-b-0",
        emphasis ? "bg-secondary/50" : "hover:bg-secondary/30",
      )}
    >
      <div className="min-w-0">
        <div className={cn("truncate text-[13px]", emphasis ? "font-semibold" : "font-medium")}>{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
      </div>

      <div className="min-w-0">
        <div className="flex h-6 w-full rounded-md overflow-hidden bg-secondary">
          {SEGMENTS.map((s) => {
            const w = (a[s.key] / total) * 100;
            if (w <= 0) return null;
            return (
              <div
                key={s.key}
                className={cn("flex items-center justify-center", s.bar)}
                style={{ width: `${w}%` }}
                title={`${s.label} ${fmt(a[s.key])} (${p[s.key].toFixed(1)}%)`}
              >
                {w > 9 && <span className="text-[10.5px] font-semibold text-white/95 tabular-nums px-1 truncate">{p[s.key].toFixed(1)}%</span>}
              </div>
            );
          })}
        </div>
      </div>

      {!emphasis && (
        <div className="flex flex-wrap gap-1.5 justify-start lg:justify-end">
          {SEGMENTS.map((s) => (
            <span key={s.key} className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium tabular-nums", s.chip)}>
              <span className="opacity-70">{s.label[0]}</span>
              {fmt(a[s.key])}
              <span className="opacity-70">· {p[s.key].toFixed(1)}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
          <div className="text-[22px] font-semibold tracking-tight mt-1 tabular-nums">{value}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
        </div>
        <span className={cn("h-8 w-8 shrink-0 rounded-md inline-flex items-center justify-center", toneCls)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Card>
  );
}
