import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import { WORKFLOWS } from "@/data/workflows";
import {
  Target,
  ArrowRight,
  Sparkles,
  Database,
  Workflow as WorkflowIcon,
  Activity,
  Radar,
  Boxes,
  Bot,
  Search,
  FileSpreadsheet,
  MessageSquare,
  Stethoscope,
  UtensilsCrossed,
  Scale,
  Car,
  ShieldCheck,
  ShoppingBag,
  ShieldAlert,
} from "lucide-react";
import { fetchBotCatalog } from "@/lib/bot-catalog";
import { jobsCacheUpdatedEventName, readJobsCache, writeJobsCache } from "@/lib/jobs-cache";
import { setUseCase, useUseCase, USE_CASES, type UseCase } from "@/lib/useCase";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Choose your use case - FreshData AI" },
      {
        name: "description",
        content:
          "Three ways to get data: run site-specific agents, refresh a dataset category, or let the assistant discover sources on the fly.",
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
  const [activeJobsCount, setActiveJobsCount] = useState(18);
  const [pendingReviewCount, setPendingReviewCount] = useState(7);

  const baseApiUrl = (() => {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port !== "8131"
    ) {
      return `http://${window.location.hostname}:8131`;
    }
    return "";
  })();

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

  useEffect(() => {
    let active = true;

    const syncPendingReview = () => {
      if (!active) return;
      const jobs = readJobsCache();
      setActiveJobsCount(jobs.filter((job) => job?.status === "Running").length);
      setPendingReviewCount(jobs.filter((job) => job?.status === "Review Pending").length);
    };

    const refreshJobs = async () => {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`, { credentials: "include" });
        if (!response.ok) return;
        const data = await response.json();
        if (!active || !Array.isArray(data)) return;
        writeJobsCache(data);
      } catch {
        // Keep the cached count if the backend is unavailable.
      } finally {
        syncPendingReview();
      }
    };

    syncPendingReview();
    void refreshJobs();
    const timer = window.setInterval(refreshJobs, 3000);
    window.addEventListener(jobsCacheUpdatedEventName(), syncPendingReview);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(jobsCacheUpdatedEventName(), syncPendingReview);
    };
  }, [baseApiUrl]);

  const stats = [
    { label: "Agents in Library", value: botCount, icon: Database, tone: "info" as const },
    { label: "Workflows", value: WORKFLOWS.length, icon: WorkflowIcon, tone: "purple" as const },
    { label: "Active Jobs", value: activeJobsCount, icon: Activity, tone: "success" as const },
    { label: "Pending Review", value: pendingReviewCount, icon: Sparkles, tone: "warning" as const },
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

        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute -inset-x-6 -inset-y-8 overflow-hidden">
            <div className="fd-aurora absolute left-[6%] top-0 h-56 w-56 rounded-full bg-emerald-500/25 blur-3xl" />
            <div className="fd-aurora absolute left-[42%] top-6 h-56 w-56 rounded-full bg-violet-500/25 blur-3xl [animation-delay:3s]" />
            <div className="fd-aurora absolute right-[6%] top-0 h-56 w-56 rounded-full bg-fuchsia-500/25 blur-3xl [animation-delay:6s]" />
          </div>
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
            <FlipTile
            active={uc === "targeted"}
            tone="emerald"
            tags={["Site-specific", "Scheduled"]}
            icon={Radar}
            title="Agents"
            aka="Trusted sites, tuned agents"
            art={<TargetedArt />}
            summary="Point Freda at a site you already trust and let a tuned agent keep it fresh on a schedule."
            facts={[
              { k: "Agents onboarded", v: `${botCount || 827}` },
              { k: "Categories", v: "14" },
              { k: "New site SLA", v: "2-7 days" },
              { k: "Refresh", v: "Daily / weekly / monthly" },
            ]}
            details={[
              "Complexity graded Simple / Medium / Complex before onboarding",
              "Every agent ships with crawl policy, metadata and terms of use",
              "Unlocks Sources & Agents, Monitoring and Jobs",
            ]}
            cta="Open Agents"
            onPick={() => pick("targeted", "/site-specific")}
          />
          <FlipTile
            active={uc === "openweb"}
            tone="violet"
            tags={["Category-driven", "Templates"]}
            icon={Boxes}
            title="Solutions"
            aka="Start from a category, not a URL"
            art={<DatasetArt />}
            summary="Choose a data category and Freda assembles the company sites plus the third-party sources around it."
            facts={[
              { k: "Categories", v: "6+ verticals" },
              { k: "Sources / category", v: "10-14" },
              { k: "Default source", v: "Company website" },
              { k: "Upload", v: "Your file, auto-mapped" },
            ]}
            details={[
              "Healthcare, hospitality, legal, insurance, automotive, commerce",
              "Marketplaces and directories curated per category",
              "Unlocks Dataset Setup, Workflows and Review",
            ]}
            cta="Open Solutions"
            onPick={() => pick("openweb", "/any-site")}
          />
          <FlipTile
            active={uc === "discovery"}
            tone="rose"
            tags={["New", "Guided"]}
            icon={Bot}
            title="Freda AI"
            aka="Your data solution consultant"
            art={<DiscoveryArt />}
            summary="Not sure which agent or category fits? Answer a short set of questions and Freda designs the solution."
            facts={[
              { k: "Format", v: "3 question batches" },
              { k: "Output", v: "Sources + workflow" },
              { k: "You get", v: "Volume & timeline" },
              { k: "Then", v: "Admin builds it" },
            ]}
            details={[
              "Multiple-choice interview - no blank chat box",
              "Recommends sources, attributes and refresh cadence",
              "Raises a solution request tracked on the dashboard",
            ]}
            cta="Ask Freda AI"
            onPick={() => pick("discovery", "/discover")}
          />
        </div>

        <LegalNotice />
      </div>
      </div>
    </AppLayout>
  );
}

function LegalNotice() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-bg/60 px-4 py-3 text-foreground">
      <div className="flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold">Scraping terms - quick heads-up</div>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground mt-0.5">
            We only collect publicly accessible pages, honor each site's robots.txt and rate limits, and never
            touch logged-in or paywalled content or personal data. Extracted values are stored with their source URL
            and timestamp so every field can be traced back and re-verified. You remain responsible for how the
            output is used under the source site's terms of use and applicable data-protection law.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- tile artwork: deep ink base, mesh glow, fine line-art ---------- */

function ArtFrame({
  glow,
  children,
}: {
  /** two tint colours for the mesh gradient */
  glow: [string, string];
  children: React.ReactNode;
}) {
  return (
    <div
      className="fd-sheen relative h-24 overflow-hidden rounded-xl ring-1 ring-inset ring-white/15"
      style={{
        background: `radial-gradient(120% 140% at 0% 0%, ${glow[0]}, transparent 60%), radial-gradient(120% 140% at 100% 100%, ${glow[1]}, transparent 60%), linear-gradient(135deg,#111a33,#0b1020)`,
      }}
    >
      {/* mesh glow */}
      <div
        className="fd-orb absolute -left-8 -top-10 h-32 w-32 rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${glow[0]}, transparent 70%)` }}
      />
      <div
        className="fd-orb absolute -bottom-12 -right-6 h-32 w-32 rounded-full blur-2xl [animation-delay:1.8s]"
        style={{ background: `radial-gradient(circle, ${glow[1]}, transparent 70%)` }}
      />

      {/* hairline grid */}
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(120%_100%_at_50%_0%,black,transparent)]" />
      {/* top light sweep */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      {children}
    </div>
  );
}

function TargetedArt() {
  return (
    <ArtFrame glow={["rgba(16,185,129,0.95)", "rgba(34,211,238,0.8)"]}>
      {/* radar rings */}
      <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full border border-emerald-300/25" />
      <div className="absolute -right-1 -top-1 h-20 w-20 rounded-full border border-emerald-300/20" />
      <div className="absolute inset-0 flex items-center gap-2 px-4">
        {["practo.com", "99acres", "cardekho"].map((s, i) => (
          <div
            key={s}
            className="flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5 text-[10px] font-medium tracking-wide text-emerald-50/90 shadow-[0_8px_20px_-12px_rgba(0,0,0,0.9)] backdrop-blur-sm"
            style={{ transform: `translateY(${i * 6 - 6}px)` }}
          >
            <div className="mb-1 h-[3px] w-8 rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300" />
            {s}
          </div>
        ))}
      </div>
      <Search className="absolute -bottom-3 -right-3 h-14 w-14 text-emerald-200/15" strokeWidth={1.25} />
    </ArtFrame>
  );
}

function DatasetArt() {
  const icons = [Stethoscope, UtensilsCrossed, Scale, Car, ShieldCheck, ShoppingBag];
  return (
    <ArtFrame glow={["rgba(139,92,246,0.95)", "rgba(59,130,246,0.8)"]}>
      <div className="absolute inset-0 grid grid-cols-6 gap-1.5 p-3">
        {icons.map((Icon, i) => (
          <div
            key={i}
            className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] backdrop-blur-sm transition-colors"
            style={{ transform: `translateY(${(i % 2 ? 1 : -1) * 3}px)` }}
          >
            <Icon className="h-4 w-4 text-indigo-100/80" strokeWidth={1.5} />
          </div>
        ))}
      </div>
    </ArtFrame>
  );
}

function DiscoveryArt() {
  return (
    <ArtFrame glow={["rgba(249,115,22,0.95)", "rgba(217,70,239,0.85)"]}>
      <div className="absolute inset-0 flex flex-col justify-center gap-1 px-4">
        <div className="self-start rounded-lg rounded-bl-sm border border-white/10 bg-white/[0.07] px-2.5 py-1 text-[10px] text-rose-50/90 backdrop-blur-sm">
          Describe the data you need
        </div>
        <div className="inline-flex self-end items-center gap-1 rounded-lg rounded-br-sm bg-gradient-to-r from-orange-300 to-fuchsia-300 px-2.5 py-1 text-[10px] font-semibold text-[#2a0d1f] shadow-[0_8px_20px_-10px_rgba(232,121,249,0.9)]">
          <Sparkles className="h-3 w-3" /> sources · volume · runtime
        </div>
        <div className="inline-flex self-start items-center gap-1 rounded-lg rounded-bl-sm border border-white/10 bg-white/[0.07] px-2.5 py-1 text-[10px] text-rose-50/90 backdrop-blur-sm">
          <FileSpreadsheet className="h-3 w-3" /> or upload a file
        </div>
      </div>
      <MessageSquare className="absolute -bottom-3 -right-3 h-14 w-14 text-fuchsia-200/15" strokeWidth={1.25} />
    </ArtFrame>
  );
}

const TONE_CLASS: Record<"emerald" | "violet" | "rose", { icon: string; chip: string; ring: string; glow: string; text: string }> = {
  emerald: {
    icon: "bg-gradient-to-br from-emerald-400 to-teal-600 text-white",
    chip: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25",
    ring: "ring-emerald-500/40",
    glow: "from-emerald-400 via-teal-500 to-cyan-500",
    text: "[--fd-g1:#34d399] [--fd-g2:#22d3ee]",
  },
  violet: {
    icon: "bg-gradient-to-br from-violet-500 to-blue-600 text-white",
    chip: "bg-violet-500/10 text-violet-400 border-violet-500/25",
    ring: "ring-violet-500/40",
    glow: "from-violet-500 via-indigo-500 to-blue-500",
    text: "[--fd-g1:#a78bfa] [--fd-g2:#60a5fa]",
  },
  rose: {
    icon: "bg-gradient-to-br from-orange-400 to-fuchsia-600 text-white",
    chip: "bg-rose-500/10 text-rose-400 border-rose-500/25",
    ring: "ring-rose-500/40",
    glow: "from-orange-400 via-rose-500 to-fuchsia-500",
    text: "[--fd-g1:#fb923c] [--fd-g2:#e879f9]",
  },
};

function FlipTile({
  active,
  tone,
  tags,
  icon: Icon,
  title,
  aka,
  art,
  summary,
  facts,
  details,
  cta,
  onPick,
}: {
  active: boolean;
  tone: "emerald" | "violet" | "rose";
  tags: string[];
  icon: typeof Target;
  title: string;
  aka: string;
  art: React.ReactNode;
  summary: string;
  facts: { k: string; v: string }[];
  details: string[];
  cta: string;
  onPick: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const t = TONE_CLASS[tone];

  return (
    <div
      className="group relative h-[340px] [perspective:1400px]"
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
      onClick={() => setFlipped((v) => !v)}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br ${t.glow} opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-60`}
      />
      <div
        className={[
          "relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d]",
          flipped ? "[transform:rotateY(180deg)]" : "",
        ].join(" ")}
      >
        {/* front */}
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <Card
            className={[
              "fd-tile relative overflow-hidden p-4 h-full flex flex-col cursor-pointer border-border/70 group-hover:shadow-2xl",
              active ? `ring-2 ${t.ring}` : "",
            ].join(" ")}
          >
            <div aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.glow}`} />
            {art}
            <div className="flex items-start gap-2.5 mt-3">
              <div className={`fd-float h-10 w-10 shrink-0 rounded-lg inline-flex items-center justify-center shadow-sm ${t.icon}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className={`fd-gradient-text text-[18px] font-bold leading-tight truncate ${t.text}`}>{title}</h2>
                  {tags.slice(0, 1).map((tag) => (
                    <span key={tag} className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${t.chip}`}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{aka}</div>
              </div>
            </div>
            <p className="text-[12.5px] text-muted-foreground mt-2.5 leading-relaxed line-clamp-3">{summary}</p>
            <div className="grid grid-cols-2 gap-1.5 mt-auto pt-3">
              {facts.slice(0, 2).map((f) => (
                <div key={f.k} className="rounded-md bg-secondary px-2 py-1.5">
                  <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{f.k}</div>
                  <div className="text-[12.5px] font-semibold leading-snug truncate">{f.v}</div>
                </div>
              ))}
            </div>
            <Button
              className="w-full mt-2.5"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onPick();
              }}
            >
              {cta} <ArrowRight className="h-4 w-4" />
            </Button>
          </Card>
        </div>

        {/* back */}
        <div className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
          <Card className={`p-4 h-full flex flex-col ring-1 ${t.ring}`}>
            <div className="flex items-center gap-2.5">
              <div className={`h-8 w-8 shrink-0 rounded-lg inline-flex items-center justify-center ${t.icon}`}>
                <Icon className="h-4 w-4" />
              </div>
              <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
            </div>

            <div className="grid grid-cols-2 gap-1.5 mt-3">
              {facts.map((f) => (
                <div key={f.k} className="rounded-md border border-border px-2 py-1.5">
                  <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{f.k}</div>
                  <div className="text-[12px] font-semibold mt-0.5 leading-snug">{f.v}</div>
                </div>
              ))}
            </div>

            <ul className="mt-2.5 space-y-1 text-[12px] flex-1">
              {details.map((d) => (
                <li key={d} className="flex items-start gap-1.5">
                  <span className="text-success mt-0.5">✓</span>
                  <span className="text-muted-foreground leading-snug">{d}</span>
                </li>
              ))}
            </ul>

            <Button
              className="w-full mt-2"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onPick();
              }}
            >
              {cta} <ArrowRight className="h-4 w-4" />
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
