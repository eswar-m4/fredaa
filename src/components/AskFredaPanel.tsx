import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Send, Sparkles, ArrowRight } from "lucide-react";
import { Button, Card, SectionTitle } from "@/components/ui-bits";
import { addTicket } from "@/lib/ticket-store";
import { useActiveCustomer } from "@/lib/workspace";
import { fmt, rollup, hrsAgo } from "@/data/customers";
import { cn } from "@/lib/utils";

type NavHint = { to: string; label: string };
type Msg = { role: "user" | "freda"; text: string; nav?: NavHint };

export function AskFredaPanel() {
  const customer = useActiveCustomer();
  const stats = rollup(customer);

  const suggestions = [
    "What is FreDA and how does it work?",
    "Where do I review and approve records?",
    "What changed in my data this week?",
    "Which dataset needs attention first?",
    "How do I add a new source to a project?",
    "How do I change the refresh schedule?",
    "How do I download approved records?",
    "Request a new project or solution",
  ];

  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "freda",
      text: `Hi — I'm FreDA, your data assistant for ${customer.name}. I know every screen in this workspace and all ${customer.projects.length} datasets in it.\n\nAsk me to explain how FreDA works, to analyse what changed (ADMV), to tell you what to review first, or to walk you to the right screen.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [flow, setFlow] = useState<number>(-1);
  const [draft, setDraft] = useState<{ name: string; sources: string[]; datapoints: string[]; schedule: string }>({
    name: "",
    sources: [],
    datapoints: [],
    schedule: "Weekly",
  });
  const endRef = useRef<HTMLDivElement>(null);

  function answer(q: string): { text: string; nav?: NavHint } {
    const s = q.toLowerCase();
    const worst = [...customer.projects].sort((a, b) => b.pendingReview - a.pendingReview)[0]!;
    const stale = [...customer.projects].sort((a, b) => a.freshness - b.freshness)[0]!;
    const best = [...customer.projects].sort((a, b) => b.accuracy - a.accuracy)[0]!;

    const has = (...w: string[]) => w.some((x) => s.includes(x));

    // ---- what FreDA is / how it works
    if (has("what is freda", "what can you", "how does freda", "how do you work", "explain freda", "about freda", "help me use", "how to use"))
      return {
        text:
          "FreDA — Fresh Data Automation — keeps the external data you rely on sourced, verified and refreshed on a schedule you control.\n\nHow it runs end to end:\n1. Source — agents are onboarded on the websites you trust (Playbooks → Agents).\n2. Extract — each run pulls only the datapoints your project defines.\n3. Validate — records are normalised, deduped and confidence scored.\n4. Review — you approve a sample batch by batch on the Dashboard.\n5. Deliver — approved records are downloadable or synced on a cadence.\n\nAsk me about any of those steps and I'll take you to the screen.",
        nav: { to: "/", label: "Open Dashboard" },
      };

    if (has("navigate", "where do i", "which screen", "take me", "lost", "get started", "where to start"))
      return {
        text:
          "Four places to know:\n• Dashboard — ADMV change signature, review by project, and the review workspace.\n• Monitor — job runs, automation status, failures and delivery.\n• Playbooks → Agents — the sources behind each project; add, retire, reschedule.\n• Playbooks → Solutions — packaged datasets to start a new project.\nPlus Request tracker for anything you've asked the FreDA team to build.\n\nTell me what you're trying to do and I'll point precisely.",
        nav: { to: "/", label: "Open Dashboard" },
      };

    // ---- concepts
    if (has("admv", "change signature"))
      return {
        text: `ADMV is how FreDA reports change on every run: Added, Deleted, Modified, Verified.\n\nThis cycle across ${stats.projects} datasets: ${fmt(stats.admv.added)} added, ${fmt(stats.admv.deleted)} deleted, ${fmt(stats.admv.modified)} modified, ${fmt(stats.admv.verified)} verified. Verified means re-checked and unchanged — that's the healthy majority.\n\nBiggest mover right now: ${worst.name}.`,
        nav: { to: "/", label: "See ADMV on Dashboard" },
      };

    if (has("confidence", "sampling", "sample"))
      return {
        text:
          "Every extracted record carries a confidence score. In the review workspace you set a minimum confidence and a sampling rate (2%–5% is typical) — FreDA then serves you a representative batch instead of all records. Approve or reject batch by batch; the review contour on the left tracks how much of the sample you've cleared.",
        nav: { to: "/", label: "Open review" },
      };

    if (has("review", "approve", "pending"))
      return {
        text: `${fmt(stats.pendingReview)} records are waiting on you. Start with "${worst.name}" — ${fmt(worst.pendingReview)} pending.\n\nOn the Dashboard, hit Review on that project row. In the workspace you can filter by ADMV type or datapoint, set a confidence threshold, approve a whole batch, or approve all Added / Deleted / Modified at once. When the review completes, the same row turns into a Download button.`,
        nav: { to: "/", label: "Review by project" },
      };

    if (has("accuracy", "quality", "coverage"))
      return {
        text:
          `Quality by dataset:\n${customer.projects.map((p) => `• ${p.name} — ${p.accuracy}% accuracy · ${p.coverage}% coverage · ${p.freshness}% fresh`).join("\n")}\n\nStrongest: ${best.name}. Accuracy only lands once a review cycle is completed, so anything still running shows a dash.`,
        nav: { to: "/", label: "See project table" },
      };

    if (has("stale", "fresh", "old data", "last run"))
      return {
        text: `Least fresh dataset is "${stale.name}" at ${stale.freshness}% freshness — last run ${hrsAgo(stale.lastRefreshHrs)}. Re-run it from Monitor, or tighten its cadence in Agents so it refreshes more often.`,
        nav: { to: "/monitoring", label: "Open Monitor" },
      };

    if (has("source", "website", "url", "agent"))
      return {
        text:
          `${customer.projects.map((p) => `• ${p.name} — ${p.sources.length} sources · ${p.frequency.toLowerCase()} agent · last run ${hrsAgo(p.lastRefreshHrs)}`).join("\n")}\n\nTo add or retire a source: Playbooks → Agents, pick the project, paste the URL and choose the attributes to extract. That raises a request; the FreDA team builds the bot and onboards it to your workspace.`,
        nav: { to: "/playbooks/agents", label: "Manage sources" },
      };

    if (has("schedule", "cadence", "daily", "weekly", "monthly", "refresh"))
      return {
        text:
          "Refresh cadence lives per project in Playbooks → Agents: Daily, Weekly, Monthly, or a custom rule (e.g. every 2 weeks, Tuesday 06:00 UTC). Saving it logs a request so your delivery lead can confirm the new run window. Live run status is on Monitor.",
        nav: { to: "/playbooks/agents", label: "Set schedule" },
      };

    if (has("monitor", "job", "automation", "failed", "run status"))
      return {
        text:
          "Monitor shows every scheduled job: last run, duration, records touched, failures and retries, plus delivery status for each destination. You can trigger a re-run for anything in scope from there.",
        nav: { to: "/monitoring", label: "Open Monitor" },
      };

    if (has("download", "export", "sync", "deliver", "s3", "snowflake", "api"))
      return {
        text:
          "Once a project's review is complete, the Action needed column on the Dashboard becomes a Download button (CSV/XLSX of approved records only). For continuous delivery, set up a sync to S3, Snowflake or the API from Monitor.",
        nav: { to: "/monitoring", label: "Delivery & sync" },
      };

    if (has("solution", "dataset setup", "catalogue", "template"))
      return {
        text:
          "Solutions are packaged datasets you can stand up without naming sources yourself. Pick a tile, then walk the setup: configure → upload → wired sources → attributes → schedule → launch. Launching raises a build request to the FreDA team.",
        nav: { to: "/playbooks/solutions", label: "Browse Solutions" },
      };

    if (has("ticket", "request", "status of", "req"))
      return {
        text:
          "Everything you ask for — new sources, schedule changes, new projects — becomes a REQ ticket. The Request tracker shows its stage: scoping, source access, bot build, QA, onboarding, handover.",
        nav: { to: "/requests", label: "Open Request tracker" },
      };

    if (has("what changed", "chang", "week", "this cycle", "delta"))
      return {
        text: `Across ${stats.projects} ${customer.industry.toLowerCase()} datasets this cycle: ${fmt(stats.admv.added)} added, ${fmt(stats.admv.deleted)} deleted, ${fmt(stats.admv.modified)} modified and ${fmt(stats.admv.verified)} verified. Biggest mover: ${worst.name}. ${fmt(stats.pendingReview)} records are queued for your review.`,
        nav: { to: "/", label: "Open Dashboard" },
      };

    return {
      text:
        `I can help with:\n• How FreDA works, end to end\n• What changed (ADMV) and what it means\n• What to review first and how sampling/confidence works\n• Source and schedule changes on your projects\n• Job health, delivery and downloads\n• Requesting a new project or solution\n\nAsk in your own words — e.g. "which dataset is stale?" or "how do I add a source?".`,
    };
  }


  const FLOW_PROMPTS = [
    "Great — let's set it up. What should the new project or solution be called?",
    "Which websites or sources should FreDA extract from? Paste them comma separated.",
    "Which datapoints do you need? Comma separated (e.g. Company name, HQ city, Revenue).",
    "How often should it refresh — Daily, Weekly, Monthly or a custom cadence?",
  ];

  function handleFlow(q: string): string {
    if (flow === 0) {
      setDraft((d) => ({ ...d, name: q }));
      setFlow(1);
      return FLOW_PROMPTS[1]!;
    }
    if (flow === 1) {
      setDraft((d) => ({ ...d, sources: q.split(",").map((s) => s.trim()).filter(Boolean) }));
      setFlow(2);
      return FLOW_PROMPTS[2]!;
    }
    if (flow === 2) {
      setDraft((d) => ({ ...d, datapoints: q.split(",").map((s) => s.trim()).filter(Boolean) }));
      setFlow(3);
      return FLOW_PROMPTS[3]!;
    }
    const schedule = q;
    const sources = draft.sources;
    const datapoints = draft.datapoints;
    const days = Math.max(3, Math.round(sources.length * 1.5 + datapoints.length * 0.2));
    const t = addTicket({
      workspaceId: customer.id,
      workspaceName: customer.name,
      project: draft.name || "New solution",
      type: "New project",
      detail: `Ask FreDA request — ${draft.name || "New solution"} · ${sources.length} sources · ${datapoints.length} datapoints · ${schedule}`,
      raisedBy: `${customer.shortName.toLowerCase()} workspace user`,
      estimateDays: days,
      sources,
      datapoints,
      frequency: schedule,
    });
    setFlow(-1);
    return `Done — ${t.id} raised with your FreDA admin.\n\n• Project: ${draft.name}\n• Sources: ${sources.length}\n• Datapoints: ${datapoints.length}\n• Refresh: ${schedule}\n• Estimate: ${days} days to build and onboard\n\nAdmin will approve it, build the bots in the backend and onboard it to your workspace. Track it in the Request tracker.`;
  }

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    let reply: { text: string; nav?: NavHint };
    if (flow >= 0) {
      reply = { text: handleFlow(q) };
    } else if (/new (project|solution|dataset)|add (a )?(project|solution|dataset)|request a/i.test(q)) {
      setFlow(0);
      reply = { text: FLOW_PROMPTS[0]! };
    } else {
      reply = answer(q);
    }
    setMessages((m) => [...m, { role: "user", text: q }, { role: "freda", ...reply }]);
    setInput("");
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
  }

  return (
    <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5 items-stretch">
      <Card className="flex flex-col h-[540px]">
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[78%] rounded-lg px-3.5 py-2.5 text-[13px] whitespace-pre-line",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.text}
                {m.nav && (
                  <Link
                    to={m.nav.to}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/15 transition"
                  >
                    {m.nav.label} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-border p-3 flex items-center gap-2"
        >
          <input
            suppressHydrationWarning
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${customer.industry.toLowerCase()} data, reviews, sources…`}
            className="h-10 flex-1 px-3 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
          />
          <Button type="submit" size="md">
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        </form>
      </Card>

      <div className="space-y-5">
        <Card className="p-5">
          <SectionTitle hint={customer.industry}>Suggested questions</SectionTitle>
          <div className="space-y-2 mt-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="w-full text-left text-[12.5px] rounded-md border border-border px-3 py-2 hover:bg-secondary transition inline-flex items-center gap-2"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" /> {s}
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <SectionTitle>Workspace context</SectionTitle>
          <ul className="text-[12.5px] text-muted-foreground space-y-1.5 mt-2">
            <li>Workspace: <span className="text-foreground font-medium">{customer.name}</span></li>
            <li>Domain: <span className="text-foreground font-medium">{customer.industry}</span></li>
            <li>Datasets: <span className="text-foreground font-medium">{stats.projects}</span></li>
            <li>Records: <span className="text-foreground font-medium">{fmt(stats.records)}</span></li>
            <li>Pending review: <span className="text-foreground font-medium">{fmt(stats.pendingReview)}</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
