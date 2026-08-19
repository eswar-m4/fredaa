import { useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button, Card, SectionTitle } from "@/components/ui-bits";
import { addTicket } from "@/lib/ticket-store";
import { useActiveCustomer } from "@/lib/workspace";
import { fmt, rollup, hrsAgo } from "@/data/customers";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "freda"; text: string };

export function AskFredaPanel() {
  const customer = useActiveCustomer();
  const stats = rollup(customer);

  const suggestions = [
    "Request a new project or solution",
    `What changed in ${customer.industry.toLowerCase()} data this week?`,
    "Which dataset needs review first?",
    "Show me accuracy by project",
    "Which sources are stale?",
    "How do I download approved records?",
  ];

  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "freda",
      text: `Hi — I'm FreDA. I know ${customer.name}'s ${customer.industry.toLowerCase()} domain and the ${customer.projects.length} datasets in this workspace. Ask me what changed, what to review, or how the data is sourced.`,
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

  function answer(q: string): string {
    const s = q.toLowerCase();
    const worst = [...customer.projects].sort((a, b) => b.pendingReview - a.pendingReview)[0]!;
    const stale = [...customer.projects].sort((a, b) => a.freshness - b.freshness)[0]!;

    if (s.includes("chang") || s.includes("admv") || s.includes("week"))
      return `Across ${stats.projects} ${customer.industry.toLowerCase()} datasets this cycle: ${fmt(stats.admv.added)} added, ${fmt(stats.admv.deleted)} deleted, ${fmt(stats.admv.modified)} modified and ${fmt(stats.admv.verified)} verified. Biggest mover: ${worst.name}.`;
    if (s.includes("review"))
      return `${fmt(stats.pendingReview)} records are pending review. Start with "${worst.name}" — ${fmt(worst.pendingReview)} pending. Open Dashboard → Review to approve batch by batch.`;
    if (s.includes("accuracy") || s.includes("quality"))
      return customer.projects.map((p) => `• ${p.name}: ${p.accuracy}% accuracy, ${p.coverage}% coverage`).join("\n");
    if (s.includes("source") || s.includes("agent"))
      return customer.projects
        .map((p) => `• ${p.name} — ${p.sources.length} sources, ${p.frequency.toLowerCase()} agent, last run ${hrsAgo(p.lastRefreshHrs)}`)
        .join("\n");
    if (s.includes("download") || s.includes("export") || s.includes("sync"))
      return `Once a review is completed, the Dashboard "Action needed" column turns into a Download button — or use Monitor to schedule a continuous sync to S3, Snowflake or the API.`;
    if (s.includes("stale") || s.includes("fresh"))
      return `Least fresh dataset is "${stale.name}" at ${stale.freshness}% freshness (last run ${hrsAgo(stale.lastRefreshHrs)}). Re-run it from Monitor.`;
    return `I can help with ${customer.industry.toLowerCase()} data questions: what changed (ADMV), review priorities, dataset accuracy and coverage, source health and downloads.`;
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
    let reply: string;
    if (flow >= 0) {
      reply = handleFlow(q);
    } else if (/new (project|solution|dataset)|add (a )?(project|solution|dataset)|request a/i.test(q)) {
      setFlow(0);
      reply = FLOW_PROMPTS[0]!;
    } else {
      reply = answer(q);
    }
    setMessages((m) => [...m, { role: "user", text: q }, { role: "freda", text: reply }]);
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
                  "max-w-[75%] rounded-lg px-3.5 py-2.5 text-[13px] whitespace-pre-line",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.text}
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
