import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bot, Clock, Globe, Settings2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { fmt, hrsAgo } from "@/data/customers";

export const Route = createFileRoute("/playbooks/agents")({
  head: () => ({
    meta: [
      { title: "Agents — FreDA playbooks" },
      { name: "description", content: "Site-specific extraction agents running on your trusted sources, with schedule, status and record counts." },
      { property: "og:title", content: "Agents — FreDA playbooks" },
      { property: "og:description", content: "Site-specific extraction agents running on your trusted sources, with schedule, status and record counts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const customer = useActiveCustomer();

  return (
    <AppLayout>
      <PageHeader
        title="Agents"
        subtitle={`${customer.name} · site-specific extraction agents tuned to the sources you trust`}
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

      <div className="px-7 pb-8">
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {customer.projects.map((p) => (
            <Card key={p.id} className="p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <span className="h-9 w-9 shrink-0 rounded-md bg-info-bg text-info inline-flex items-center justify-center">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-snug">{p.name} agent</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {p.frequency} · {p.datapoints.length} datapoints
                  </div>
                </div>
                <Badge tone={p.status === "Needs attention" ? "destructive" : p.status === "Syncing" ? "info" : "success"}>{p.status}</Badge>
              </div>

              <div className="mt-3 space-y-1.5">
                {p.sources.slice(0, 3).map((s) => (
                  <a
                    key={s.id}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-primary transition truncate"
                  >
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{s.label}</span>
                  </a>
                ))}
                {p.sources.length > 3 && <div className="text-[11px] text-muted-foreground">+{p.sources.length - 3} more sources</div>}
              </div>

              <div className="mt-auto pt-3 border-t border-border/70 flex items-center justify-between text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> ran {hrsAgo(p.lastRefreshHrs)}
                </span>
                <span className="tabular-nums">{fmt(p.records)} records</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
