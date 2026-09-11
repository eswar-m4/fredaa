import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  ExternalLink,
  Send,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import { readIntent } from "@/lib/freda-intent";

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { title: "Ask Freda - AI solution consultant" },
      {
        name: "description",
        content:
          "AI-powered consultant that checks existing agents and solutions first, then scopes new ones.",
      },
      { property: "og:title", content: "Ask Freda - AI solution consultant" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FredaAi,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiAction = { label: string; route: string | null };

/** A real, retrieved catalog item (solution or agent) — never derived from
 *  the model's own prose, always the actual search result. */
type CatalogMatch = {
  type: "solution" | "agent";
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  coverage?: number | null;
  refresh?: string | null;
  sources?: string[];
  url?: string | null;
  route: string;
};

type NextQuestion = string | { text: string; options?: string[] };

type AiResponse = {
  message: string;
  actions: AiAction[];
  next_question: NextQuestion | null;
  phase: string;
  matches: CatalogMatch[];
};

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

type Turn =
  | { kind: "user"; text: string }
  | { kind: "freda"; text: string; actions: AiAction[]; matches?: CatalogMatch[]; note?: string }
  | { kind: "question"; text: string; options?: string[] };

const INITIAL_TURN: Turn = {
  kind: "freda",
  text:
    "Hi! I'm Ask Freda, your AI solution consultant for the Freda platform.\n\nTell me what you need in your own words — for example:\n• \"Annual reports of Indian listed companies, refreshed weekly\"\n• \"Hospital data in Chennai with doctors and specialties, monthly\"\n• \"Scrape Amazon pricing for laptops daily\"\n\nI'll check existing agents and solutions first before asking anything.",
  actions: [],
  note: "Public sources only. Estimates are not a quote.",
};

// ---------------------------------------------------------------------------
// Build intent context string so AI never re-asks what's already known
// ---------------------------------------------------------------------------

function buildIntentContext(userMessage: string): string {
  const intent = readIntent(userMessage);
  const lines: string[] = [];

  if (intent.captured.length > 0) {
    lines.push("ALREADY KNOWN FROM THE USER'S MESSAGE (do NOT ask about these):");
    intent.captured.forEach((c) => lines.push(`  • ${c.label}: ${c.value}`));
  }

  if (intent.agentHits.length > 0) {
    lines.push("ONBOARDED SOURCES MENTIONED BY USER:");
    intent.agentHits.forEach((h) =>
      lines.push(`  • ${h.site} — already available as an agent in ${h.hit.where}`)
    );
  }

  if (intent.newSites.length > 0) {
    lines.push("SITES MENTIONED BUT NOT ONBOARDED:");
    intent.newSites.forEach((s) => lines.push(`  • ${s}`));
  }

  if (intent.outOfScope) {
    lines.push("NOTE: Part of the request may be out of scope (login-walled or personal data).");
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

// In local dev the frontend (port 5433) and backend (port 8000) are separate
// servers with no proxy between them — a bare relative fetch("/api/...")
// resolves against the frontend's own origin and 404s. Same pattern already
// used by dashboard.tsx / monitoring.tsx / review.tsx for this reason.
function getBaseApiUrl(): string {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port !== "8000"
  ) {
    return `http://${window.location.hostname}:8000`;
  }
  return "";
}

async function callAI(messages: ChatMessage[]): Promise<AiResponse> {
  try {
    const res = await fetch(`${getBaseApiUrl()}/api/v1/demo/ask-freda/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      message: data.message ?? "I encountered an error. Please try again.",
      actions: Array.isArray(data.actions) ? data.actions : [],
      next_question: data.next_question ?? null,
      phase: data.phase ?? "requirements_gathering",
      matches: Array.isArray(data.matches) ? data.matches : [],
    };
  } catch (err) {
    console.error("Ask Freda chat request failed:", err);
    return {
      message: "I encountered an error reaching the AI service. Please try again.",
      actions: [],
      next_question: null,
      phase: "requirements_gathering",
      matches: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function FredaAi() {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Conversation history sent to the AI (role/content pairs)
  const [history, setHistory] = useState<ChatMessage[]>([]);
  // Visual chat turns (rendered bubbles)
  const [turns, setTurns] = useState<Turn[]>([INITIAL_TURN]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string>("intake");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  // ------------------------------------------------------------------
  // Add a Freda turn from an AI response
  // ------------------------------------------------------------------
  function applyAiResponse(res: AiResponse) {
    setPhase(res.phase);

    // Main message bubble — matches are the real, retrieved catalog results,
    // rendered as clickable cards regardless of what the message text says.
    setTurns((prev) => [
      ...prev,
      { kind: "freda", text: res.message, actions: res.actions, matches: res.matches },
    ]);

    // If AI wants to ask a follow-up question, add it as a separate turn.
    // next_question can be a plain string or { text, options } for a
    // choice-based question — normalize both into the question turn shape.
    const questionText =
      typeof res.next_question === "string" ? res.next_question : res.next_question?.text;
    const questionOptions =
      typeof res.next_question === "object" && res.next_question ? res.next_question.options : undefined;

    if (questionText) {
      setTurns((prev) => [...prev, { kind: "question", text: questionText, options: questionOptions }]);
    }

    // Mirror into AI history as assistant turn (combine message + question so
    // the model has full context on what it said)
    const assistantContent = questionText ? `${res.message}\n\n${questionText}` : res.message;
    setHistory((prev) => [...prev, { role: "assistant", content: assistantContent }]);
  }

  // ------------------------------------------------------------------
  // Send a user message (first turn or follow-up)
  // ------------------------------------------------------------------
  async function send(overrideText?: string) {
    const text = (overrideText ?? draft).trim();
    if (!text || loading || submitted) return;
    setDraft("");
    setLoading(true);

    // Render user bubble immediately
    setTurns((prev) => [...prev, { kind: "user", text }]);

    let outgoing: ChatMessage[];

    if (phase === "intake") {
      // First message: augment with extracted intent context so AI doesn't re-ask
      const context = buildIntentContext(text);
      const augmented = context
        ? `${text}\n\n${context}`
        : text;
      outgoing = [{ role: "user", content: augmented }];
      setHistory(outgoing);
    } else {
      // Subsequent messages: add raw user reply to history
      const updated: ChatMessage[] = [...history, { role: "user", content: text }];
      setHistory(updated);
      outgoing = updated;
    }

    const res = await callAI(outgoing);
    setLoading(false);
    applyAiResponse(res);
  }

  // ------------------------------------------------------------------
  // Submit the requirement to admin
  // ------------------------------------------------------------------
  async function submit() {
    setSubmitted(true);
    setSubmitError(false);
    const firstUserTurn = turns.find((t) => t.kind === "user") as { text: string } | undefined;
    const title = (firstUserTurn?.text ?? "Solution Request").slice(0, 120);
    const transcript = turns
      .filter((t): t is { kind: "user" | "freda" | "question"; text: string } & Turn => "text" in t)
      .map((t) => `${t.kind === "user" ? "User" : "Freda"}: ${t.text}`)
      .join("\n\n");

    try {
      await fetch(`${getBaseApiUrl()}/api/v1/demo/solution-request`, {
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
      setTurns((prev) => [
        ...prev,
        {
          kind: "freda",
          text: "Your requirement has been submitted. The admin team will review it — you can track progress in Monitoring once it's approved and assigned a job.",
          actions: [{ label: "View in Monitoring", route: "/monitoring" }],
        },
      ]);
    } catch {
      setSubmitted(false);
      setSubmitError(true);
    }
  }

  function restart() {
    setHistory([]);
    setTurns([INITIAL_TURN]);
    setDraft("");
    setLoading(false);
    setPhase("intake");
    setSubmitted(false);
    setSubmitError(false);
  }

  const hasExchanged = turns.some((t) => t.kind === "user");
  const showSubmit =
    hasExchanged &&
    !submitted &&
    !loading &&
    ["confirming", "confirmed", "requirements_gathering", "partial_match", "capability_found"].includes(phase);

  return (
    <AppLayout>
      <PageHeader
        title="Ask Freda"
        subtitle="AI solution consultant — checks existing agents and solutions first, then scopes new ones."
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
              <div className="text-[11px] text-muted-foreground">
                Agents · Solutions · New data requests
              </div>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  loading ? "bg-amber-400 animate-pulse" : "bg-success animate-pulse"
                }`}
              />
              {submitted ? "Submitted" : loading ? "Thinking…" : "Ready"}
            </span>
          </div>

          {/* Chat area */}
          <div
            ref={scrollRef}
            className="overflow-y-auto px-5 py-4 space-y-4 max-h-[62vh] min-h-[460px]"
          >
            {turns.map((turn, i) => {
              if (turn.kind === "user") {
                return (
                  <div key={i} className="flex justify-end gap-2">
                    <div className="rounded-lg bg-primary text-primary-foreground px-3.5 py-2.5 text-[13px] leading-relaxed max-w-[78%] whitespace-pre-line">
                      {turn.text}
                    </div>
                    <span className="h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center">
                      <UserIcon className="h-3.5 w-3.5" />
                    </span>
                  </div>
                );
              }

              if (turn.kind === "question") {
                const isLatest = i === turns.length - 1;
                return (
                  <div key={i} className="flex gap-2.5">
                    <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <div className="max-w-[80%] space-y-2">
                      <div className="rounded-lg bg-secondary border border-primary/20 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground font-medium">
                        {turn.text}
                      </div>
                      {/* Choice options — click to answer instantly, or type a free-text reply instead */}
                      {turn.options && turn.options.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {turn.options.map((opt, oi) => (
                            <button
                              key={oi}
                              disabled={!isLatest || loading || submitted}
                              onClick={() => send(opt)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-card hover:bg-primary/10 disabled:opacity-50 disabled:cursor-default text-primary px-3 py-1.5 text-[12px] font-medium transition-colors"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // kind === "freda"
              return (
                <div key={i} className="flex gap-2.5">
                  <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="max-w-[82%] space-y-2">
                    <div className="rounded-lg bg-secondary px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-foreground">
                      {turn.text}
                      {turn.note && (
                        <div className="text-[11.5px] text-muted-foreground mt-1.5">{turn.note}</div>
                      )}
                    </div>

                    {/* Real catalog matches — retrieved data, not the model's prose.
                        Each card is genuinely clickable and opens that exact
                        solution/agent on its real screen. */}
                    {turn.matches && turn.matches.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {turn.matches.map((m, mi) => (
                          <Card key={mi} className="p-3 border-border">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Badge tone={m.type === "solution" ? "purple" : "info"} className="text-[10px]">
                                    {m.type === "solution" ? "Solution" : "Agent"}
                                  </Badge>
                                  {m.category && (
                                    <span className="text-[10.5px] text-muted-foreground truncate">{m.category}</span>
                                  )}
                                </div>
                                <div className="text-[12.5px] font-semibold mt-1 truncate">{m.name}</div>
                                {m.description && (
                                  <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                    {m.description}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1 text-[10.5px] text-muted-foreground">
                                  {typeof m.coverage === "number" && <span>{m.coverage}% coverage</span>}
                                  {m.refresh && <span>{m.refresh} refresh</span>}
                                  {m.sources && m.sources.length > 0 && (
                                    <span className="truncate">Sources: {m.sources.slice(0, 2).join(", ")}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => navigate({ to: m.route })}
                              className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
                            >
                              Open <ArrowRight className="h-3 w-3" />
                            </button>
                          </Card>
                        ))}
                      </div>
                    )}

                    {/* Action buttons — clickable, navigate to actual platform routes */}
                    {turn.actions && turn.actions.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {turn.actions.map((action, ai) =>
                          action.route ? (
                            <button
                              key={ai}
                              onClick={() => navigate({ to: action.route as string })}
                              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary px-3 py-1.5 text-[12px] font-medium transition-colors"
                            >
                              {action.label}
                              <ExternalLink className="h-3 w-3 opacity-60" />
                            </button>
                          ) : (
                            <button
                              key={ai}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card hover:bg-secondary text-foreground px-3 py-1.5 text-[12px] font-medium transition-colors"
                            >
                              {action.label}
                              <ArrowRight className="h-3 w-3 opacity-60" />
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Loading dots */}
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

          {/* Submit banner */}
          {showSubmit && (
            <div className="border-t border-border px-5 py-3 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" onClick={submit}>
                Submit requirement to admin team
              </Button>
              {submitError && (
                <span className="text-[11.5px] text-destructive">
                  Submission failed — please try again.
                </span>
              )}
              <span className="text-[11.5px] text-muted-foreground">
                Or keep chatting to refine the requirement first.
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
                    : phase === "intake"
                    ? "e.g. annual reports of Indian listed companies, refreshed weekly…"
                    : "Type your answer or add more details…"
                }
                className="flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground disabled:opacity-50"
              />
              <Button disabled={!draft.trim() || loading || submitted} onClick={() => send()}>
                <Send className="h-4 w-4" /> Send
              </Button>
            </div>
            <div className="text-[11.5px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              Public sources only. Freda checks existing agents and solutions before asking any questions.
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
