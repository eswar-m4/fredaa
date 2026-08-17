import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, PlayCircle, Timer } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, SectionTitle, Select } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { compact, fmt, hrsAgo, inHrs, rollup } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring & Refresh — FreDA" },
      { name: "description", content: "Track refresh runs, health and change volume for every FreDA dataset, and trigger an on-demand refresh." },
      { property: "og:title", content: "Monitoring & Refresh — FreDA" },
      { property: "og:description", content: "Track refresh runs, health and change volume for every FreDA dataset, and trigger an on-demand refresh." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MonitoringPage,
});

const statusTone = { Healthy: "success", "Review pending": "warning", Refreshing: "info", Attention: "destructive" } as const;

function MonitoringPage() {
  const customer = useActiveCustomer();
  const stats = useMemo(() => rollup(customer), [customer.id]);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState<Record<string, number>>({});

  const projects = customer.projects.filter((p) => filter === "all" || p.status === filter);

  function refresh(id: string) {
    setRefreshing((r) => ({ ...r, [id]: 0 }));
    let pct = 0;
    const t = setInterval(() => {
      pct += 12;
      setRefreshing((r) => ({ ...r, [id]: pct }));
      if (pct >= 100) {
        clearInterval(t);
        setTimeout(() => setRefreshing((r) => {
          const { [id]: _drop, ...rest } = r;
          return rest;
        }), 800);
      }
    }, 260);
  }

  const running = customer.projects.filter((p) => p.status === "Refreshing").length;
  const attention = customer.projects.filter((p) => p.status === "Attention").length;

  return (
    <AppLayout>
      <PageHeader
        title="Monitoring & refresh"
        subtitle={`${customer.name} · ${customer.projects.length} datasets · ${fmt(stats.records)} records tracked`}
        actions={
          <Button size="sm" onClick={() => customer.projects.forEach((p) => refresh(p.id))}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh all datasets
          </Button>
        }
      />

      <div className="px-7 pb-8 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile icon={PlayCircle} label="Refreshing now" value={String(running)} tone="info" />
          <Tile icon={CheckCircle2} label="Healthy datasets" value={String(customer.projects.filter((p) => p.status === "Healthy").length)} tone="success" />
          <Tile icon={AlertTriangle} label="Needs attention" value={String(attention)} tone="warning" />
          <Tile icon={Activity} label="Changes this cycle" value={compact(stats.admv.added + stats.admv.deleted + stats.admv.modified)} tone="purple" />
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border flex items-center gap-3">
            <div className="flex-1">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Refresh schedule</h3>
              <p className="text-[12px] text-muted-foreground mt-1">Existing extractions — re-run any dataset on demand.</p>
            </div>
            <Select className="w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="Healthy">Healthy</option>
              <option value="Review pending">Review pending</option>
              <option value="Refreshing">Refreshing</option>
              <option value="Attention">Attention</option>
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
                const pct = refreshing[p.id];
                return (
                  <tr key={p.id} className="border-b border-border/60 hover:bg-secondary/40">
                    <td className="px-5 py-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.source} · {p.datapoints.length} datapoints
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="neutral">{p.frequency}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{hrsAgo(p.lastRefreshHrs)}</td>
                    <td className="px-3 py-3 text-muted-foreground inline-flex items-center gap-1">
                      <Timer className="h-3.5 w-3.5" /> {inHrs(p.nextRefreshHrs)}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{compact(p.records)}</td>
                    <td className="px-3 py-3">
                      <span className="text-success">+{compact(p.admv.added)}</span>{" "}
                      <span className="text-destructive">-{compact(p.admv.deleted)}</span>{" "}
                      <span className="text-warning">~{compact(p.admv.modified)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[p.status] as any}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {pct === undefined ? (
                        <Button size="sm" variant="outline" onClick={() => refresh(p.id)}>
                          <RefreshCw className="h-3.5 w-3.5" /> Refresh
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

        <div className="grid xl:grid-cols-2 gap-5 items-start">
          <Card className="p-5">
            <SectionTitle hint="last runs">Run history</SectionTitle>
            <div className="space-y-2 mt-2">
              {customer.projects.flatMap((p) =>
                p.history.slice(-3).map((h) => ({ key: `${p.id}-${h.label}`, name: p.name, ...h })),
              ).slice(0, 10).map((r) => (
                <div key={r.key} className="flex items-center gap-3 text-[12.5px] border-b border-border/60 pb-2">
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="tabular-nums text-muted-foreground">{compact(r.records)} rows</span>
                  <Badge tone={r.accuracy > 96 ? "success" : r.accuracy > 93 ? "warning" : "destructive"}>{r.accuracy}%</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle hint="per dataset">Health scores</SectionTitle>
            <div className="space-y-3 mt-2">
              {customer.projects.map((p) => (
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

function Tile({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone: "info" | "success" | "warning" | "purple" }) {
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
