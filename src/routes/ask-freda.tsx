import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button, Card, PageHeader, SectionTitle } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { compact, fmt, rollup, hrsAgo } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ask-freda")({
  head: () => ({
    meta: [
      { title: "Ask FreDA — Navigate and analyse your data" },
      { name: "description", content: "A simple assistant that answers questions about your datasets, changes and review queue, and points you to the right screen." },
      { property: "og:title", content: "Ask FreDA — Navigate and analyse your data" },
      { property: "og:description", content: "A simple assistant that answers questions about your datasets, changes and review queue, and points you to the right screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AskFredaPage,
});

type Msg = { role: "user" | "freda"; text: string };

const SUGGESTIONS = [
  "What changed since the last refresh?",
  "Which dataset needs review first?",
  "Show me accuracy by project",
  "How do I export approved records?",
  "Which datasets are stale?",
];

function AskFredaPage() {
  const customer = useActiveCustomer();
  const stats = rollup(customer);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "freda",
      text: `Hi — I'm FreDA. I can help you navigate ${customer.name}'s workspace and analyse what changed. Ask me about refreshes, review queues, accuracy or exports.`,
    },
  ]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  function answer(q: string): string {
    const s = q.toLowerCase();
    const worst = [...customer.projects].sort((a, b) => b.pendingReview - a.pendingReview)[0]!;
    const stale = [...customer.projects].sort((a, b) => a.freshness - b.freshness)[0]!;

    if (s.includes("chang") || s.includes("admv") || s.includes("refresh cycle"))
      return `Across ${stats.projects} datasets this cycle: ${fmt(stats.admv.added)} added, ${fmt(stats.admv.deleted)} deleted, ${fmt(stats.admv.modified)} modified and ${fmt(stats.admv.verified)} verified. Biggest mover: ${worst.name}.`;
    if (s.includes("review"))
      return `${fmt(stats.pendingReview)} records are pending review. Start with "${worst.name}" — ${fmt(worst.pendingReview)} pending at ${worst.accuracy}% accuracy. Open Dashboard → Review to approve record by record.`;
    if (s.includes("accuracy") || s.includes("quality"))
      return customer.projects.map((p) => `• ${p.name}: ${p.accuracy}% accuracy, ${p.coverage}% coverage`).join("\n");
    if (s.includes("export") || s.includes("sync") || s.includes("download"))
      return `Go to Export & Sync. Pick the datasets, choose "Approved records only", then either generate a one-time CSV/Parquet export or enable continuous sync to S3, Snowflake or the API.`;
    if (s.includes("stale") || s.includes("fresh"))
      return `Least fresh dataset is "${stale.name}" at ${stale.freshness}% freshness (last run ${hrsAgo(stale.lastRefreshHrs)}). You can re-run it from Monitoring → Refresh.`;
    if (s.includes("record") || s.includes("how many") || s.includes("volume"))
      return `${customer.name} has ${fmt(stats.records)} records across ${stats.projects} datasets (${compact(stats.records)} total), each tracking ${customer.projects[0]!.datapoints.length} datapoints.`;
    if (s.includes("monitor"))
      return `Monitoring shows every dataset's schedule, last run, change volume and health. You can trigger an on-demand refresh from there.`;
    return `I can help with: what changed (ADMV), review priorities, dataset accuracy and coverage, refresh health, and exports. Try one of the suggested questions on the right.`;
  }

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    setMessages((m) => [...m, { role: "user", text: q }, { role: "freda", text: answer(q) }]);
    setInput("");
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
  }

  return (
    <AppLayout>
      <PageHeader title="Ask FreDA" subtitle="Navigate the workspace and analyse your data — ask in plain English." />
      <div className="px-7 pb-8 grid xl:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <Card className="flex flex-col h-[calc(100vh-230px)] min-h-[420px]">
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
              placeholder="Ask about changes, review queue, accuracy, exports…"
              className="h-10 flex-1 px-3 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
            />
            <Button type="submit" size="md">
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </form>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle>Suggested questions</SectionTitle>
            <div className="space-y-2 mt-2">
              {SUGGESTIONS.map((s) => (
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
              <li>Customer: <span className="text-foreground font-medium">{customer.name}</span></li>
              <li>Datasets: <span className="text-foreground font-medium">{stats.projects}</span></li>
              <li>Records: <span className="text-foreground font-medium">{fmt(stats.records)}</span></li>
              <li>Pending review: <span className="text-foreground font-medium">{fmt(stats.pendingReview)}</span></li>
              <li>Avg accuracy: <span className="text-foreground font-medium">{stats.accuracy.toFixed(1)}%</span></li>
            </ul>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
