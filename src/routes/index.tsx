import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CheckSquare,
  Database,
  ShieldCheck,
  TrendingUp,
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

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  Completed: "Review completed",
  "In progress": "Review in progress",
  "Review pending": "Review pending",
};


const SEGMENTS = [
  { key: "added", label: "Added", bar: "bg-success", chip: "bg-success-bg text-success", dot: "bg-success" },
  { key: "deleted", label: "Deleted", bar: "bg-destructive", chip: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  { key: "modified", label: "Modified", bar: "bg-warning", chip: "bg-warning-bg text-warning", dot: "bg-warning" },
  { key: "verified", label: "Verified", bar: "bg-primary/60", chip: "bg-info-bg text-info", dot: "bg-primary/60" },
] as const;

const CRITICAL_ACTIONS = [
  "Source returned 403 — re-auth needed",
  "Layout change — re-map 3 fields",
  "Resolve duplicate entities",
  "Verify price movement > 30%",
  "Re-check low-confidence extractions",
  "New field detected on source page",
];


function DashboardPage() {
  const customer = useActiveCustomer();
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [scope, setScope] = useState<string>("all");
  const [reviewProject, setReviewProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string>(customer.projects[0]!.id);

  const scoped = scope === "all" ? customer.projects : customer.projects.filter((p) => p.id === scope);
  const factor = rangeFactor(range.key, rangeDays(range));

  const stats = useMemo(() => rollupProjects(scoped), [customer.id, scope]);
  const pendingScaled = Math.round(stats.pendingReview * Math.min(1.6, factor));

  const actions = useMemo(() => actionsFor(customer), [customer.id]);
  const actionByProject = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of actions) {
      if (!CRITICAL_ACTIONS.includes(a.action)) continue;
      if (!m[a.projectId]) m[a.projectId] = a.action;
    }
    return m;
  }, [actions]);


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
          <Kpi label="Records managed" value={fmt(stats.records)} sub={`${stats.projects} projects in scope`} icon={Database} tone="info" />
          <Kpi label="Pending review" value={fmt(pendingScaled)} sub="record-level changes" icon={CheckSquare} tone="warning" />
          <Kpi label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} sub="approved / reviewed" icon={ShieldCheck} tone="success" />
          <Kpi label="Coverage" value={`${stats.coverage.toFixed(1)}%`} sub="fields populated" icon={TrendingUp} tone="purple" />
          <Kpi label="Freshness" value={`${Math.round(stats.freshness)}%`} sub="vs refresh schedule" icon={Clock} tone="info" />
        </div>





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
                  <th className="px-3 py-2 font-semibold w-[230px] text-center">ADMV %</th>
                  <th className="px-3 py-2 font-semibold">Coverage</th>
                  <th className="px-3 py-2 font-semibold">Freshness</th>
                  <th className="px-3 py-2 font-semibold">Accuracy</th>
                  <th className="px-3 py-2 font-semibold">Review status</th>
                  <th className="px-5 py-2 font-semibold text-right w-[210px]">Action needed</th>

                </tr>

              </thead>
              <tbody>
                {scoped.map((p) => {
                  const a = scaleAdmv(p.admv, factor);
                  const ap = admvPct(a);
                  const rs = reviewStatusFor(p);
                  const st = p.status === "Syncing" ? "Still running" : REVIEW_LABEL[rs];
                  const action = actionByProject[p.id];
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelected(p.id)}
                      className="border-b border-border/60 cursor-pointer hover:bg-secondary/40"
                    >
                      <td className="px-5 py-3 min-w-[200px]">
                        <div className="font-medium whitespace-nowrap">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {p.sources.length} sources · {p.datapoints.length} datapoints · {p.frequency}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">{fmt(p.records)}</td>
                      <td className="px-3 py-3">
                        <div className="grid grid-cols-4 gap-1 w-[215px] mx-auto">
                          {SEGMENTS.map((s) => (
                            <div
                              key={s.key}
                              title={`${s.label} · ${ap[s.key].toFixed(1)}% (${fmt(a[s.key])} records)`}
                              className={cn("flex items-center justify-center gap-1 rounded-md px-1 py-1", s.chip)}
                            >
                              <span className="text-[9.5px] uppercase font-bold opacity-70">{s.label[0]}</span>
                              <span className="text-[11.5px] font-semibold tabular-nums leading-none">{ap[s.key].toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      </td>

                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">{p.coverage}%</td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">{p.freshness}%</td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">
                        {rs === "Completed" ? `${p.accuracy}%` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge tone={st === "Still running" ? "info" : reviewTone[rs]}>{st}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end">
                          <Button
                            size="sm"
                            className="w-[150px] justify-center whitespace-nowrap"
                            variant={action ? "primary" : p.pendingReview > 0 ? "primary" : "outline"}
                            title={action || "Open review workspace"}
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewProject(p);
                            }}
                          >
                            <CheckSquare className="h-3.5 w-3.5" />
                            {p.pendingReview > 0 ? `Review ${fmt(p.pendingReview)}` : "Review"}
                          </Button>
                        </div>
                      </td>

                    </tr>
                  );
                })}

              </tbody>
            </table>

          </div>
        </Card>

        {/* New project development in progress */}
        <Card className="p-5">
          <SectionTitle hint="FreDA delivery team">New project development in progress</SectionTitle>





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
