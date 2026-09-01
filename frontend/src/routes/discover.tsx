import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, ShieldCheck, Sparkles, User as UserIcon } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { title: "Ask Freda - AI solution consultant" },
      {
        name: "description",
        content:
          "AI-powered consultant that understands your data requirement and finds or creates the right Freda solution.",
      },
      { property: "og:title", content: "Ask Freda - AI solution consultant" },
      {
        property: "og:description",
        content: "Tell Freda what data you need — she'll find or scope the right solution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FredaAi,
});

type Message = { role: "user" | "assistant"; content: string };

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hi! I'm Ask Freda, your AI solution consultant for the Freda data intelligence platform.\n\nTell me what data you need — describe it in your own words. For example:\n• \"I need a list of all hospitals in Chennai with specialties, refreshed monthly\"\n• \"Get Amazon product prices across categories daily\"\n• \"Annual reports of Indian listed companies\"\n\nI'll find existing agents and solutions that already cover your need, or scope a new one with you.",
};

async function callAI(messages: Message[]): Promise<string> {
  const res = await fetch("/api/v1/demo/ask-freda/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.reply as string;
}

async function submitRequirement(messages: Message[]): Promise<void> {
  const firstUserMsg = messages.find((m) => m.role === "user");
  const title = firstUserMsg?.content?.slice(0, 120) ?? "Solution Request";
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Freda"}: ${m.content}`)
    .join("\n\n");

  await fetch("/api/v1/demo/solution-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      title,
      request: transcript,
      attributes: [],
      sources: [],
      metadata: [],
      workflow: [],
      volume: null,
      timeline: null,
      cadence: null,
    }),
  });
}

function FredaAi() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const hasExchanged = messages.some((m) => m.role === "user");

  async function send() {
    const text = draft.trim();
    if (!text || loading) return;
    setDraft("");

    const userMsg: Message = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);

    try {
      const reply = await callAI(next);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I encountered an error. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setSubmitted(true);
    setSubmitError(false);
    try {
      await submitRequirement(messages);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Your requirement has been submitted. The admin team will review it — you can track progress in Monitoring once it's approved and assigned a job.",
        },
      ]);
    } catch {
      setSubmitted(false);
      setSubmitError(true);
    }
  }

  function restart() {
    setMessages([INITIAL_MESSAGE]);
    setDraft("");
    setLoading(false);
    setSubmitted(false);
    setSubmitError(false);
  }

  return (
    <AppLayout>
      <PageHeader
        title="Ask Freda"
        subtitle="AI solution consultant for agents, solutions and new data requests."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="purple" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> AI Consultant
            </Badge>
            {hasExchanged && (
              <Button variant="outline" size="sm" onClick={restart}>
                Start over
              </Button>
            )}
          </div>
        }
      />

      <div className="px-7 pb-8">
        <Card className="overflow-hidden max-w-3xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border px-5 py-3">
            <span className="h-7 w-7 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
              <Bot className="h-4 w-4" />
            </span>
            <div>
              <div className="text-[13px] font-semibold leading-tight">Ask Freda</div>
              <div className="text-[11px] text-muted-foreground">Agents, solutions and new data requests</div>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${loading ? "bg-amber-400 animate-pulse" : "bg-success animate-pulse"}`} />
              {submitted ? "Submitted" : loading ? "Thinking…" : "Ready"}
            </span>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="overflow-y-auto px-5 py-4 space-y-4 max-h-[62vh] min-h-[440px]"
          >
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-2.5"}>
                {m.role === "assistant" && (
                  <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                )}
                <div
                  className={[
                    "rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed max-w-[80%] whitespace-pre-line",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground",
                  ].join(" ")}
                >
                  {m.content}
                </div>
                {m.role === "user" && (
                  <span className="h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center ml-2">
                    <UserIcon className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-2.5">
                <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <div className="rounded-lg bg-secondary px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Submit banner (once conversation is underway and not yet submitted) */}
          {hasExchanged && !submitted && !loading && (
            <div className="border-t border-border px-5 py-3 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" onClick={handleSubmit}>
                Submit requirement to admin team
              </Button>
              {submitError && (
                <span className="text-[11.5px] text-destructive">Submission failed — please try again.</span>
              )}
              <span className="text-[11.5px] text-muted-foreground">
                Or keep chatting to refine before submitting.
              </span>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border px-5 py-3 space-y-2">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                disabled={loading || submitted}
                placeholder={
                  submitted
                    ? "Requirement submitted."
                    : "Tell Freda what data you need…"
                }
                className="flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground disabled:opacity-50"
              />
              <Button disabled={!draft.trim() || loading || submitted} onClick={send}>
                <Send className="h-4 w-4" /> Send
              </Button>
            </div>
            <div className="text-[11.5px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              Public sources only. Freda asks only what's still missing to scope the build.
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
