import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Card, PageHeader } from "@/components/ui-bits";
import { WORKFLOWS } from "@/data/workflows";
import {
  Target,
  Globe2,
  Compass,
  ArrowRight,
  Sparkles,
  Database,
  Workflow as WorkflowIcon,
  Activity,
  Search,
  FileSpreadsheet,
  MessageSquare,
  Stethoscope,
  UtensilsCrossed,
  Scale,
  Car,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { fetchBotCatalog } from "@/lib/bot-catalog";
import { setUseCase, useUseCase, USE_CASES, type UseCase } from "@/lib/useCase";
import type { ReactNode } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Choose your use case - FreshData AI" },
      {
        name: "description",
        content: "Three ways to get data: run site-specific agents, refresh a dataset category, or let the assistant discover sources on the fly.",
      },
      { property: "og:title", content: "Choose your use case - FreshData AI" },
      {
        property: "og:description",
        content: "Site-specific agents, dataset categories, and on-the-fly AI source discovery in one workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const uc = useUseCase();
  const navigate = useNavigate();
  const [botCount, setBotCount] = useState(0);

  useEffect(() => {
    let active = true;
    fetchBotCatalog()
      .then((payload) => {
        if (!active) return;
        const libraryCount = payload.bots?.filter((bot) => bot.catalog_kind === "built_in").length ?? payload.total ?? 0;
        setBotCount(libraryCount);
      })
      .catch(() => {
        if (!active) return;
        setBotCount(0);
      });
    return () => {
      active = false;
    };
  }, []);

  const stats = [
    { label: "Agents in Library", value: botCount, icon: Database, tone: "info" as const },
    { label: "Workflows", value: WORKFLOWS.length, icon: WorkflowIcon, tone: "purple" as const },
    { label: "Active Jobs", value: 18, icon: Activity, tone: "success" as const },
    { label: "Pending Review", value: 7, icon: Sparkles, tone: "warning" as const },
  ];

  const pick = (mode: Exclude<UseCase, null>, to: string) => {
    setUseCase(mode);
    navigate({ to });
  };

  return (
    <AppLayout>
      <PageHeader
        title="Choose your use case"
        subtitle="Pick how you want to source data. The workspace and side navigation adapt to that choice."
      />

      <div className="px-7 pb-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => {
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
          <UseCaseCard
            active={uc === "targeted"}
            tone="info"
            tags={["Site-specific", "Scheduled"]}
            icon={Target}
            title={USE_CASES.targeted.name}
            aka="Run tuned agents against sites you already trust"
            art={<TargetedArt />}
            description="You name the source. We classify complexity, reuse existing agents or onboard new ones, and refresh on your schedule."
            bullets={[
              `Browse ${botCount || 827} onboarded agents across 14 categories`,
              "Upload a new site and AI estimates SLA in days",
              "Every agent carries crawl policy, metadata and terms of use",
            ]}
            shows={["Sources (pick or add)", "Agent Library", "Jobs"]}
            cta="Use this"
            onPick={() => pick("targeted", "/site-specific")}
          />
          <UseCaseCard
            active={uc === "openweb"}
            tone="purple"
            tags={["Category-driven", "Templates"]}
            icon={Globe2}
            title={USE_CASES.openweb.name}
            aka="Start from a category, not a URL"
            art={<DatasetArt />}
            description="Tell us what attributes you want. Every category defaults to the company's own website and adds a wide list of third-party sources."
            bullets={[
              "Healthcare, hospitality, attorneys, automotive, insurance, commerce",
              "Company website by default plus many third-party sources per category",
              "Upload your own file and AI maps it onto the template",
            ]}
            shows={["Dataset Setup", "Workflows", "Review"]}
            cta="Use this"
            onPick={() => pick("openweb", "/any-site")}
          />
          <UseCaseCard
            active={uc === "discovery"}
            tone="warning"
            tags={["New", "AI assistant"]}
            icon={Compass}
            title={USE_CASES.discovery.name}
            aka="Ask for data in plain words"
            art={<DiscoveryArt />}
            description="No source, no template, no bot required. Describe the data you want or drop a file, and the assistant works out where it lives."
            bullets={[
              "Search finds the URLs, an LLM lifts the fields, validation confirms them",
              "Get sources, entity list, data points, volume, runtime and samples",
              "Ends with a hand-off into By Source or By Dataset",
            ]}
            shows={["Assistant", "Source shortlist", "Next steps"]}
            cta="Ask the assistant"
            onPick={() => pick("discovery", "/discover")}
          />
        </div>

        <LegalNotice />
      </div>
    </AppLayout>
  );
}

function LegalNotice() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-bg/60 px-4 py-3 text-foreground">
      <div className="flex items-start gap-2">
        <ShieldBadge />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold">Scraping terms — quick heads-up</div>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground mt-0.5">
            We only collect publicly accessible pages, honor each site&apos;s robots.txt and rate limits, and never
            touch logged-in or paywalled content or personal data. Extracted values are stored with their source URL
            and timestamp so every field can be traced back and re-verified. You remain responsible for how the output
            is used under the source site&apos;s terms of use and applicable data-protection law.
          </p>
        </div>
      </div>
    </div>
  );
}

function ShieldBadge() {
  return (
    <div className="mt-0.5 h-4 w-4 rounded-full border border-warning/40 bg-warning/10 inline-flex items-center justify-center shrink-0">
      <span className="block h-1.5 w-1.5 rounded-full bg-warning" />
    </div>
  );
}

function ArtFrame({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={`relative h-28 overflow-hidden rounded-lg bg-gradient-to-br ${className}`}>
      <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_20%_30%,white_1.5px,transparent_1.5px)] [background-size:20px_20px]" />
      {children}
    </div>
  );
}

function TargetedArt() {
  return (
    <ArtFrame className="from-sky-500 via-blue-600 to-indigo-700">
      <div className="absolute inset-0 flex items-center gap-2 px-4">
        {["practo.com", "99acres", "cardekho"].map((s, i) => (
          <div
            key={s}
            className="flex-1 rounded-md bg-white/15 backdrop-blur-sm px-2 py-2 text-[10px] font-medium text-white/95 border border-white/20"
            style={{ transform: `translateY(${i * 6 - 6}px)` }}
          >
            <div className="h-1 w-8 rounded-full bg-white/60 mb-1.5" />
            {s}
          </div>
        ))}
      </div>
      <Search className="absolute -bottom-2 -right-2 h-16 w-16 text-white/20" />
    </ArtFrame>
  );
}

function DatasetArt() {
  const icons = [Stethoscope, UtensilsCrossed, Scale, Car, ShieldCheck, ShoppingBag];
  return (
    <ArtFrame className="from-fuchsia-600 via-purple-600 to-indigo-700">
      <div className="absolute inset-0 grid grid-cols-3 gap-1.5 p-3">
        {icons.map((Icon, i) => (
          <div
            key={i}
            className="rounded-md bg-white/15 border border-white/20 backdrop-blur-sm inline-flex items-center justify-center"
          >
            <Icon className="h-4 w-4 text-white/90" />
          </div>
        ))}
      </div>
    </ArtFrame>
  );
}

function DiscoveryArt() {
  return (
    <ArtFrame className="from-amber-500 via-orange-500 to-rose-500">
      <div className="absolute inset-0 flex flex-col justify-center gap-1.5 px-4">
        <div className="self-start rounded-lg rounded-bl-sm bg-white/20 border border-white/25 px-2.5 py-1 text-[10px] text-white">
          Describe the data you need
        </div>
        <div className="self-end rounded-lg rounded-br-sm bg-white/90 px-2.5 py-1 text-[10px] font-medium text-orange-700 inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3" /> sources · volume · runtime
        </div>
        <div className="self-start rounded-lg rounded-bl-sm bg-white/20 border border-white/25 px-2.5 py-1 text-[10px] text-white inline-flex items-center gap-1">
          <FileSpreadsheet className="h-3 w-3" /> or upload a file
        </div>
      </div>
      <MessageSquare className="absolute -bottom-3 -right-3 h-16 w-16 text-white/15" />
    </ArtFrame>
  );
}

function UseCaseCard({
  active,
  tone,
  tags,
  icon: Icon,
  title,
  aka,
  art,
  description,
  bullets,
  shows,
  cta,
  onPick,
}: {
  active: boolean;
  tone: "info" | "purple" | "warning";
  tags: string[];
  icon: typeof Target;
  title: string;
  aka: string;
  art: ReactNode;
  description: string;
  bullets: string[];
  shows: string[];
  cta: string;
  onPick: () => void;
}) {
  const toneClass =
    tone === "info" ? "bg-info-bg text-info" : tone === "purple" ? "bg-purple-bg text-purple-token" : "bg-warning-bg text-warning";

  return (
    <button type="button" onClick={onPick} className="text-left group flex flex-col h-full">
      <Card
        className={[
          "p-4 flex flex-col h-full border transition-all duration-200 group-hover:border-primary/50 group-hover:shadow-md",
          active ? "ring-2 ring-primary" : "",
        ].join(" ")}
      >
        <div>{art}</div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="flex items-start gap-3 mt-3">
          <div className={`h-14 w-14 rounded-lg inline-flex items-center justify-center shrink-0 ${toneClass}`}>
            <Icon className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold leading-tight">{title}</h2>
            <div className="text-[11px] text-muted-foreground mt-0.5">{aka}</div>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-muted-foreground mt-3">{description}</p>

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
              <Badge key={s} tone="neutral" className="bg-secondary text-foreground">
                {s}
              </Badge>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-md font-medium transition h-11 px-4 text-[13px] bg-[#2d67b2] text-white group-hover:bg-[#275ea0]">
            {cta} <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </Card>
    </button>
  );
}
