import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Bot, Clock, Globe, Search, Settings2, ExternalLink } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { fmt, hrsAgo } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbooks/agents")({
  head: () => ({
    meta: [
      { title: "Agents — FreDA playbooks" },
      { name: "description", content: "Every source agent running in your workspace, with project, schedule, status and record counts." },
      { property: "og:title", content: "Agents — FreDA playbooks" },
      { property: "og:description", content: "Every source agent running in your workspace, with project, schedule, status and record counts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const customer = useActiveCustomer();
  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState<"all" | string>("all");

  const agents = useMemo(
    () =>
      customer.projects
        .filter((p) => projectId === "all" || p.id === projectId)
        .flatMap((p) => p.sources.map((s) => ({ ...s, project: p })))
        .filter((a) => !q.trim() || `${a.label} ${a.url} ${a.project.name}`.toLowerCase().includes(q.trim().toLowerCase())),
    [customer, projectId, q],
  );

  const live = agents.filter((a) => a.status === "Live").length;

  return (
    <AppLayout>
      <PageHeader
        title="Agents"
        subtitle={`${customer.name} · ${agents.length} source agents · ${live} live across ${customer.projects.length} projects`}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/playbooks">
              <Button size="sm" variant="outline">
                <ArrowLeft className="h-3.5 w-3.5" /> Playbooks
              </Button>
            </Link>
            <Link to="/refresh">
              <Button size="sm" variant="outline">
                <Settings2 className="h-3.5 w-3.5" /> Manage projects
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-7 pb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[280px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search sources…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button
            onClick={() => setProjectId("all")}
            className={cn(
              "h-8 px-3 rounded-md border text-[11.5px] font-medium transition",
              projectId === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
            )}
          >
            All projects
          </button>
          {customer.projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setProjectId(p.id)}
              className={cn(
                "h-8 px-3 rounded-md border text-[11.5px] font-medium transition",
                projectId === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {agents.map((a) => (
            <Card key={a.id} className="p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <span className="h-9 w-9 shrink-0 rounded-md bg-info-bg text-info inline-flex items-center justify-center">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-snug truncate">{a.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {a.project.name} · {a.project.frequency} · {a.project.datapoints.length} datapoints
                  </div>
                </div>
                <Badge tone={a.status === "Live" ? "success" : a.status === "Paused" ? "warning" : "info"}>{a.status}</Badge>
              </div>

              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-[12px] text-muted-foreground hover:text-primary hover:bg-secondary/50 transition"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate flex-1">{a.url}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>

              <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
                Extracting: {a.project.datapoints.slice(0, 4).join(", ")}
                {a.project.datapoints.length > 4 ? ` +${a.project.datapoints.length - 4} more` : ""}
              </div>

              <div className="mt-auto pt-3 border-t border-border/70 flex items-center justify-between text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> ran {hrsAgo(a.project.lastRefreshHrs)}
                </span>
                <span className="tabular-nums">{fmt(a.records)} records</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
