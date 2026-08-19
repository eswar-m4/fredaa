import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Target,
  ArrowRight,
  Sparkles,
  Radar,
  Boxes,
  Bot,
  Stethoscope,
  UtensilsCrossed,
  Scale,
  Car,
  ShieldCheck,
  ShoppingBag,
  MessageSquare,
  FileSpreadsheet,
  Search,
  Settings2,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button, Card, PageHeader } from "@/components/ui-bits";
import { LegalNotice } from "@/components/LegalNotice";
import { useActiveCustomer } from "@/lib/workspace";
import { solutionsFor } from "@/lib/playbook-solutions";

export const Route = createFileRoute("/playbooks/")({
  head: () => ({
    meta: [
      { title: "Choose your playbook — FreDA" },
      {
        name: "description",
        content:
          "Three playbooks to get data: run site-specific agents, refresh a packaged solution, or let Ask FreDA design the solution with you.",
      },
      { property: "og:title", content: "Choose your playbook — FreDA" },
      {
        property: "og:description",
        content: "Site-specific agents, packaged solutions and FreDA's guided assistant in one workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlaybooksPage,
});

function PlaybooksPage() {
  const customer = useActiveCustomer();
  const solutions = solutionsFor(customer);
  const navigate = useNavigate();

  const [flippedId, setFlippedId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const requestFlip = (id: string) => {
    clearTimers();
    if (flippedId === id) return;
    if (flippedId) {
      setFlippedId(null);
      timers.current.push(window.setTimeout(() => setFlippedId(id), 900));
    } else {
      timers.current.push(window.setTimeout(() => setFlippedId(id), 400));
    }
  };

  const requestClose = (id: string) => {
    clearTimers();
    timers.current.push(
      window.setTimeout(() => {
        setFlippedId((cur) => (cur === id ? null : cur));
      }, 500),
    );
  };

  const totalSources = customer.projects.reduce((a, p) => a + p.sources.length, 0);
  const totalDatapoints = customer.projects.reduce((a, p) => a + p.datapoints.length, 0);

  return (
    <AppLayout>
      <PageHeader
        title="Choose your playbook"
        subtitle={`${customer.name} · run agents on the sites you trust, pick a ready solution, or let FreDA design one with you.`}
      />

      <div className="relative px-7 pb-8 space-y-6">
        <div aria-hidden className="pointer-events-none absolute inset-0 -top-24 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:34px_34px] [mask-image:radial-gradient(100%_70%_at_50%_0%,black,transparent)]" />
          <div className="absolute left-1/2 top-0 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.14),transparent)] blur-2xl" />
          <div className="absolute -left-24 bottom-0 h-[320px] w-[320px] rounded-full bg-[radial-gradient(closest-side,rgba(16,185,129,0.12),transparent)] blur-2xl" />
          <div className="absolute -right-24 bottom-10 h-[320px] w-[320px] rounded-full bg-[radial-gradient(closest-side,rgba(232,121,249,0.12),transparent)] blur-2xl" />
        </div>

        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute -inset-x-6 -inset-y-8 overflow-hidden">
            <div className="fd-aurora absolute left-[6%] top-0 h-56 w-56 rounded-full bg-emerald-500/25 blur-3xl" />
            <div className="fd-aurora absolute left-[42%] top-6 h-56 w-56 rounded-full bg-violet-500/25 blur-3xl [animation-delay:3s]" />
            <div className="fd-aurora absolute right-[6%] top-0 h-56 w-56 rounded-full bg-fuchsia-500/25 blur-3xl [animation-delay:6s]" />
          </div>
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
            <FlipTile
              id="agents"
              flipped={flippedId === "agents"}
              onOpen={requestFlip}
              onClose={requestClose}
              active={false}
              tone="emerald"
              tag="Site-specific"
              icon={Radar}
              title="Agents"
              aka="You already know the websites"
              art={<TargetedArt sources={customer.projects.flatMap((p) => p.sources).slice(0, 3).map((s) => s.label)} />}
              summary="Your trusted sites onboarded as tuned extraction agents, kept fresh on the schedule you set."
              facts={[
                { k: "Agents running", v: `${customer.projects.length}` },
                { k: "Sources", v: `${totalSources}` },
                { k: "Datapoints", v: `${totalDatapoints}` },
                { k: "Refresh", v: "Daily / weekly / monthly" },
              ]}
              details={[
                "Every agent ships with crawl policy, metadata and terms of use",
                "Change deltas (ADMV) captured on every run",
                "Feeds Dashboard review and Monitor jobs",
              ]}
              cta="Open Agents"
              onPick={() => navigate({ to: "/playbooks/agents" })}
            />
            <FlipTile
              id="solutions"
              flipped={flippedId === "solutions"}
              onOpen={requestFlip}
              onClose={requestClose}
              active={false}
              tone="violet"
              tag="Category-driven"
              icon={Boxes}
              title="Solutions"
              aka="You know the data, not the sites"
              art={<DatasetArt />}
              summary={`Packaged ${customer.industry.toLowerCase()} datasets sourced from official websites plus trusted third-party sources.`}
              facts={[
                { k: "Solutions", v: `${solutions.length}` },
                { k: "Domain", v: customer.industry },
                { k: "Default source", v: "Official website" },
                { k: "Third-party", v: "10-14 per category" },
              ]}
              details={[
                "Curated marketplaces and directories per category",
                "Normalised, deduped and confidence scored",
                "Request a solution and the build team scopes it",
              ]}
              cta="Open Solutions"
              onPick={() => navigate({ to: "/playbooks/solutions" })}
            />
            <FlipTile
              id="ask"
              flipped={flippedId === "ask"}
              onOpen={requestFlip}
              onClose={requestClose}
              active={false}
              tone="rose"
              tag="Guided"
              icon={Bot}
              title="Ask FreDA"
              aka="Not sure where to start?"
              art={<DiscoveryArt />}
              summary="Ask about what changed, which dataset to review first, source health or how to download approved records."
              facts={[
                { k: "Chat", v: "Guided" },
                { k: "Scope", v: customer.industry },
                { k: "You get", v: "Answers on your data" },
                { k: "Then", v: "Jump to the screen" },
              ]}
              details={[
                "Knows this workspace's datasets and their status",
                "Explains ADMV deltas, coverage and freshness",
                "Points you to review, monitor or download next",
              ]}
              cta="Ask FreDA"
              onPick={() => navigate({ to: "/playbooks/ask" })}
            />
          </div>
        </div>


        {/* how it works band */}
        <div className="relative rounded-2xl border border-border bg-card/70 p-5 overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:16px_16px]"
          />
          <div className="relative">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">How FreDA delivers</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              {[
                { icon: Search, t: "Source", d: "Official company websites first, then curated third-party sources." },
                { icon: Boxes, t: "Extract", d: "Tuned agents and LLM extraction pull the fields you asked for." },
                { icon: ShieldCheck, t: "Validate", d: "Normalised, deduped and cross-checked before it reaches you." },
                { icon: Radar, t: "Refresh", d: "Daily, weekly or monthly runs with monitoring and change deltas." },
              ].map((s) => (
                <div key={s.t} className="rounded-xl border border-border bg-background/60 p-3.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <div className="text-[13px] font-semibold mt-2">{s.t}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <LegalNotice />
      </div>
    </AppLayout>
  );
}

/* ---------- tile artwork ---------- */

function ArtFrame({ glow, children }: { glow: [string, string]; children: React.ReactNode }) {
  return (
    <div
      className="fd-sheen relative h-28 overflow-hidden rounded-xl ring-1 ring-inset ring-white/15"
      style={{
        background: `radial-gradient(120% 140% at 0% 0%, ${glow[0]}, transparent 60%), radial-gradient(120% 140% at 100% 100%, ${glow[1]}, transparent 60%), linear-gradient(135deg,#111a33,#0b1020)`,
      }}
    >
      <div
        className="fd-orb absolute -left-8 -top-10 h-32 w-32 rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${glow[0]}, transparent 70%)` }}
      />
      <div
        className="fd-orb absolute -bottom-12 -right-6 h-32 w-32 rounded-full blur-2xl [animation-delay:1.8s]"
        style={{ background: `radial-gradient(circle, ${glow[1]}, transparent 70%)` }}
      />
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(120%_100%_at_50%_0%,black,transparent)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      {children}
    </div>
  );
}

function TargetedArt({ sources }: { sources: string[] }) {
  const labels = sources.length ? sources : ["source one", "source two", "source three"];
  return (
    <ArtFrame glow={["rgba(16,185,129,0.95)", "rgba(34,211,238,0.8)"]}>
      <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full border border-emerald-300/25" />
      <div className="absolute -right-1 -top-1 h-20 w-20 rounded-full border border-emerald-300/20" />
      <div className="absolute inset-0 flex items-center gap-2 px-4">
        {labels.map((s, i) => (
          <div
            key={s + i}
            className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5 text-[10px] font-medium tracking-wide text-emerald-50/90 shadow-[0_8px_20px_-12px_rgba(0,0,0,0.9)] backdrop-blur-sm"
            style={{ transform: `translateY(${i * 6 - 6}px)` }}
          >
            <div className="mb-1 h-[3px] w-8 rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300" />
            <span className="block truncate">{s}</span>
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
            className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] backdrop-blur-sm"
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
  id,
  flipped,
  onOpen,
  onClose,
  active,
  tone,
  tag,
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
  id: string;
  flipped: boolean;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  active: boolean;
  tone: "emerald" | "violet" | "rose";
  tag: string;
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
  const t = TONE_CLASS[tone];

  return (
    <div
      className="group relative h-[340px] [perspective:1400px]"
      onMouseEnter={() => onOpen(id)}
      onMouseLeave={() => onClose(id)}
      onClick={() => (flipped ? onClose(id) : onOpen(id))}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br ${t.glow} opacity-0 blur-xl transition-opacity duration-700 group-hover:opacity-60`}
      />
      <div
        className={[
          "relative h-full w-full transition-transform duration-[800ms] ease-in-out [transform-style:preserve-3d]",
          flipped ? "[transform:rotateY(180deg)]" : "",
        ].join(" ")}
      >
        {/* front */}
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <Card
            className={[
              "fd-tile relative overflow-hidden p-5 h-full flex flex-col cursor-pointer border-border/70 group-hover:shadow-2xl",
              active ? `ring-2 ${t.ring}` : "",
            ].join(" ")}
          >
            <div aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.glow}`} />
            {art}
            <div className="flex items-start gap-3 mt-4">
              <div className={`fd-float h-11 w-11 shrink-0 rounded-xl inline-flex items-center justify-center shadow-sm ${t.icon}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className={`fd-gradient-text text-[19px] font-bold leading-tight truncate ${t.text}`}>{title}</h2>
                <div className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{aka}</div>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed">{summary}</p>
            <div className="mt-auto pt-4">
              <Button
                className="w-full justify-center"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onPick();
                }}
              >
                {cta} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
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
              <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${t.chip}`}>{tag}</span>
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
              className="w-full mt-2 justify-center"
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
