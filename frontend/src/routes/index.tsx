import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import bots from "@/data/bots.json";
import { WORKFLOWS } from "@/data/workflows";
import { Target, Globe2, ArrowRight, Sparkles, Database, Workflow as WorkflowIcon, Activity } from "lucide-react";
import { setUseCase, useUseCase, USE_CASES } from "@/lib/useCase";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Use Cases – FreshData AI" },
      { name: "description", content: "Pick a use case: Targeted source extraction or Open web data discovery." },
    ],
  }),
  component: Home,
});

const STATS = [
  { label: "Agents in Library", value: (bots as any).bots.length, icon: Database, tone: "info" as const },
  { label: "Workflows", value: WORKFLOWS.length, icon: WorkflowIcon, tone: "purple" as const },
  { label: "Active Jobs", value: 18, icon: Activity, tone: "success" as const },
  { label: "Pending Review", value: 7, icon: Sparkles, tone: "warning" as const },
];

function Home() {
  const uc = useUseCase();
  const navigate = useNavigate();

  const pick = (mode: "targeted" | "openweb") => {
    setUseCase(mode);
    navigate({ to: mode === "targeted" ? "/site-specific" : "/any-site" });
  };

  return (
    <AppLayout>
      <PageHeader
        title="Choose your use case"
        subtitle="Pick how you want to source data. The workspace and side navigation will adapt to that use case."
      />

      <div className="px-7 pb-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[12px] text-muted-foreground">{s.label}</div>
                    <div className="text-[24px] font-semibold mt-1">{s.value}</div>
                  </div>
                  <Badge tone={s.tone} className="!p-2">
                    <Icon className="h-4 w-4" />
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <UseCaseCard
            active={uc === "targeted"}
            tone="info"
            badge="Use Case 1"
            icon={Target}
            title={USE_CASES.targeted.name}
            aka="(aka Targeted Source Extraction)"
            description="You name the source – SOS, registry, directory, retail site. We classify complexity (Simple / Medium / Complex), reuse existing agents or onboard new ones, and refresh on your schedule."
            bullets={[
              "Browse 827 onboarded agents across 14 categories",
              "Upload a new site → AI estimates SLA (days)",
              "Frequency: daily, weekly, monthly, quarterly",
            ]}
            shows={["Sources (pick or add)", "Agent Library", "Jobs"]}
            cta="Use this"
            onPick={() => pick("targeted")}
          />
          <UseCaseCard
            active={uc === "openweb"}
            tone="purple"
            badge="Use Case 2"
            icon={Globe2}
            title={USE_CASES.openweb.name}
            aka="(aka Open Web / Any-Source)"
            description="Tell us what attributes you want. We map them to our golden B2B superset and chain the right workflows across SEC, registries and the open web."
            bullets={[
              "Superset of firmographic, contact, financial, funding & compliance attributes",
              "AI auto-maps your fields to the standard schema",
              "Pre-built workflows: Company, Financial, NAP, Registry, Funding…",
            ]}
            shows={["Field Mapping", "Workflows", "Review"]}
            cta="Use this"
            onPick={() => pick("openweb")}
          />
        </div>
      </div>
    </AppLayout>
  );
}

function UseCaseCard({
  active,
  tone,
  badge,
  icon: Icon,
  title,
  aka,
  description,
  bullets,
  shows,
  cta,
  onPick,
}: {
  active: boolean;
  tone: "info" | "purple";
  badge: string;
  icon: typeof Target;
  title: string;
  aka: string;
  description: string;
  bullets: string[];
  shows: string[];
  cta: string;
  onPick: () => void;
}) {
  return (
    <div onClick={onPick} className="cursor-pointer group flex flex-col h-full">
      <Card className={["p-6 flex flex-col h-full group-hover:border-primary/50 group-hover:shadow-md transition-all duration-200", active ? "ring-2 ring-primary" : ""].join(" ")}>
        <div className="flex items-center gap-2 mb-3">
          <Badge tone={tone}>{badge}</Badge>
          {active && <Badge tone="success">Active</Badge>}
        </div>
        <div className="flex items-start gap-4">
          <div
            className={
              tone === "info"
                ? "h-12 w-12 rounded-lg bg-info-bg text-info inline-flex items-center justify-center"
                : "h-12 w-12 rounded-lg bg-purple-bg text-purple-token inline-flex items-center justify-center"
            }
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold">{title}</h2>
            <div className="text-[11px] text-muted-foreground">{aka}</div>
            <p className="text-[13px] text-muted-foreground mt-1">{description}</p>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-[13px] flex-1">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <span className="text-success mt-0.5">✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
            Unlocks these screens
          </div>
          <div className="flex flex-wrap gap-1.5">
            {shows.map((s) => (
              <Badge key={s} tone="neutral">{s}</Badge>
            ))}
          </div>
        </div>
        <div className="mt-5">
          <div className="inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition h-9 px-4 text-[13px] bg-primary text-primary-foreground group-hover:bg-primary/90">
            {cta} <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </Card>
    </div>
  );
}
