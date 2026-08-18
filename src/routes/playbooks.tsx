import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bot, Boxes, MessageSquare, Globe, Clock, ArrowRight, Sparkles, Settings2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, SectionTitle } from "@/components/ui-bits";
import { AskFredaPanel } from "@/components/AskFredaPanel";
import { useActiveCustomer } from "@/lib/workspace";
import { fmt, hrsAgo, type Customer } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbooks")({
  head: () => ({
    meta: [
      { title: "Playbooks — FreDA agents, solutions and assistant" },
      {
        name: "description",
        content: "Browse the extraction agents running on your sources, ready-made domain solutions, and ask FreDA questions about your workspace data.",
      },
      { property: "og:title", content: "Playbooks — FreDA agents, solutions and assistant" },
      {
        property: "og:description",
        content: "Browse the extraction agents running on your sources, ready-made domain solutions, and ask FreDA questions about your workspace data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlaybooksPage,
});

type Tab = "agents" | "solutions" | "ask";

const TABS: Array<{ key: Tab; label: string; icon: typeof Bot; hint: string }> = [
  { key: "agents", label: "Agents", icon: Bot, hint: "extraction bots on your sources" },
  { key: "solutions", label: "Solutions", icon: Boxes, hint: "packaged domain datasets" },
  { key: "ask", label: "Ask FreDA", icon: MessageSquare, hint: "domain assistant" },
];

function solutionsFor(customer: Customer) {
  const base = [
    {
      name: `${customer.industry} core profile`,
      blurb: "Entity master with identity, location and classification fields kept continuously verified.",
      sources: 4,
      datapoints: 18,
    },
    {
      name: "Change & event monitoring",
      blurb: "Daily delta feed of added, deleted and modified records with confidence scoring.",
      sources: 6,
      datapoints: 12,
    },
    {
      name: "Contact & decision maker enrichment",
      blurb: "Role-level contacts appended to each verified entity, with pattern validation.",
      sources: 3,
      datapoints: 9,
    },
    {
      name: "Competitive pricing & offer watch",
      blurb: "Price, availability and promotion tracking across the sources you already run.",
      sources: 5,
      datapoints: 14,
    },
  ];
  return base;
}

function PlaybooksPage() {
  const customer = useActiveCustomer();
  const [tab, setTab] = useState<Tab>("agents");
  const solutions = solutionsFor(customer);

  return (
    <AppLayout>
      <PageHeader
        title="Playbooks"
        subtitle={`${customer.name} · agents, packaged solutions and the FreDA assistant for ${customer.industry.toLowerCase()}`}
        actions={
          <Link to="/refresh">
            <Button size="sm" variant="outline">
              <Settings2 className="h-3.5 w-3.5" /> Manage projects
            </Button>
          </Link>
        }
      />

      <div className="px-7 pb-8 space-y-5">
        <Card className="p-1.5 flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex-1 min-w-[180px] rounded-lg px-4 py-2.5 text-left transition border",
                  active ? "bg-primary text-primary-foreground border-transparent" : "border-transparent hover:bg-secondary",
                )}
              >
                <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                  <Icon className="h-4 w-4" /> {t.label}
                </div>
                <div className={cn("text-[11px] mt-0.5", active ? "text-primary-foreground/75" : "text-muted-foreground")}>{t.hint}</div>
              </button>
            );
          })}
        </Card>

        {tab === "agents" && (
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
                  {p.sources.length > 3 && (
                    <div className="text-[11px] text-muted-foreground">+{p.sources.length - 3} more sources</div>
                  )}
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
        )}

        {tab === "solutions" && (
          <div className="grid md:grid-cols-2 gap-4 items-stretch">
            {solutions.map((s) => (
              <Card key={s.name} className="p-5 flex flex-col">
                <div className="flex items-start gap-3">
                  <span className="h-9 w-9 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                    <Boxes className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold">{s.name}</div>
                    <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{s.blurb}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge tone="info">{s.sources} sources</Badge>
                  <Badge tone="neutral">{s.datapoints} datapoints</Badge>
                  <Badge tone="success">{customer.industry}</Badge>
                </div>
                <div className="mt-auto pt-4">
                  <Link to="/refresh">
                    <Button size="sm" variant="outline" className="w-full justify-center">
                      <Sparkles className="h-3.5 w-3.5" /> Request this solution <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "ask" && <AskFredaPanel />}
      </div>
    </AppLayout>
  );
}
