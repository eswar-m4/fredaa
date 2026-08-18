import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Activity, FolderPlus, LayoutDashboard, Bot } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button, Card, PageHeader } from "@/components/ui-bits";
import { AskFredaPanel } from "@/components/AskFredaPanel";
import { useActiveCustomer } from "@/lib/workspace";

export const Route = createFileRoute("/playbooks/ask")({
  head: () => ({
    meta: [
      { title: "Ask FreDA — domain assistant" },
      { name: "description", content: "Ask FreDA what changed in your data, which dataset to review first, how sources are performing and where to go next." },
      { property: "og:title", content: "Ask FreDA — domain assistant" },
      { property: "og:description", content: "Ask FreDA what changed in your data, which dataset to review first, how sources are performing and where to go next." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AskPage,
});

const NAV = [
  { to: "/", label: "Dashboard & review", desc: "See ADMV changes and approve records", icon: LayoutDashboard },
  { to: "/monitoring", label: "Monitor", desc: "Job runs, automation status and delivery", icon: Activity },
  { to: "/refresh", label: "Projects", desc: "Add sources or create a new project", icon: FolderPlus },
  { to: "/playbooks/agents", label: "Agents", desc: "Every source agent running for you", icon: Bot },
] as const;

function AskPage() {
  const customer = useActiveCustomer();

  return (
    <AppLayout>
      <PageHeader
        title="Ask FreDA"
        subtitle={`${customer.name} · guided assistant for ${customer.industry.toLowerCase()} data, reviews and sources`}
        actions={
          <Link to="/playbooks">
            <Button size="sm" variant="outline">
              <ArrowLeft className="h-3.5 w-3.5" /> Playbooks
            </Button>
          </Link>
        }
      />

      <div className="px-7 pb-8 space-y-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 items-stretch">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to}>
                <Card className="p-4 h-full flex items-start gap-3 hover:border-primary/50 transition">
                  <span className="h-9 w-9 shrink-0 rounded-md bg-info-bg text-info inline-flex items-center justify-center">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold inline-flex items-center gap-1">
                      {n.label} <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">{n.desc}</div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>

        <AskFredaPanel />
      </div>
    </AppLayout>
  );
}
