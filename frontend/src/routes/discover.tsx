import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Send,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card } from "@/components/ui-bits";
import { getBaseApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  clearAskFredaSession,
  readAskFredaSession,
  writeAskFredaSession,
} from "@/lib/ask-freda-session";

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

type AiAction = { label: string; route: string | null; action?: string | null };

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

type QuestionSpec = {
  text: string;
  options?: string[];
  multi?: boolean;
  allowOther?: boolean;
  selected?: string[];
  field?: string;
};

type NextQuestion = string | QuestionSpec;

type AiResponse = {
  message: string;
  actions: AiAction[];
  next_question: NextQuestion | null;
  phase: string;
  matches: CatalogMatch[];
  state?: Record<string, unknown>;
};

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

type Turn =
  | { kind: "user"; text: string }
  | { kind: "freda"; text: string; actions: AiAction[]; matches?: CatalogMatch[]; note?: string }
  | { kind: "question"; text: string; options?: string[]; multi?: boolean; allowOther?: boolean; selected?: string[]; field?: string };

const PATH_ACTIONS = new Set(["expand", "build_new", "revise", "confirm", "submit_job", "use_existing"]);

const INITIAL_TURN: Turn = {
  kind: "freda",
  text:
    "Hi! I'm Ask Freda, your AI solution consultant for the Freda platform.\n\nTell me what you need in your own words — for example:\n• \"Annual reports of Indian listed companies, refreshed weekly\"\n• \"Hospital data in Chennai with doctors and specialties, monthly\"\n• \"Scrape Amazon pricing for laptops daily\"\n\nI'll check existing agents and solutions first before asking anything.",
  actions: [],
  note: "Public sources only. Estimates are not a quote.",
};

function goToAppRoute(navigate: ReturnType<typeof useNavigate>, route: string) {
  const [path, qs] = route.split("?");
  const search = Object.fromEntries(new URLSearchParams(qs || ""));
  void navigate({
    to: path as never,
    ...(Object.keys(search).length ? { search: search as never } : {}),
  });
}

function normalizeQuestion(raw: NextQuestion | null | undefined): QuestionSpec | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? { text, options: [], multi: isMultiPrompt(text, []), allowOther: true } : null;
  }
  const text = (raw.text || "").trim();
  if (!text) return null;
  const options = Array.isArray(raw.options) ? raw.options.filter(Boolean) : [];
  return {
    text,
    options,
    multi: Boolean(raw.multi) || isMultiPrompt(text, options, raw.field),
    allowOther: raw.allowOther !== false,
    selected: raw.selected || [],
    field: raw.field,
  };
}

function isAllAvailableFields(value: string) {
  return /^all available fields$/i.test(value.trim());
}

function isMultiPrompt(text: string, options: string[], field?: string) {
  if (field === "attributes" || field === "sourceNames") return true;
  if (options.some((item) => /all available fields/i.test(item))) return true;
  return /\b(attributes?|fields to collect|information would you like|which websites or source names|source names should freda use)\b/i.test(
    text,
  );
}

function compactText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[?!.]+$/g, "").trim();
}

function looksLikeSameQuestion(left: string, right: string) {
  const a = compactText(left);
  const b = compactText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const stem = a.slice(0, Math.min(80, a.length));
  return stem.length >= 40 && b.startsWith(stem) && Math.abs(a.length - b.length) < 120;
}

/** Keep intro copy in the chat bubble; the question itself lives with the choices. */
function leadInWithoutQuestion(message: string, questionText: string) {
  const msg = (message || "").trim();
  const question = (questionText || "").trim();
  if (!msg) return "";
  if (!question) return msg;
  if (looksLikeSameQuestion(msg, question)) return "";
  const idx = compactText(msg).lastIndexOf(compactText(question));
  if (idx >= 0) {
    // Fall back to original-case slice using the raw question when it is a suffix.
    const rawIdx = msg.toLowerCase().lastIndexOf(question.toLowerCase());
    if (rawIdx >= 0) {
      const before = msg.slice(0, rawIdx).trim();
      const after = msg.slice(rawIdx + question.length).trim();
      if (!after || /^[.!?\u2026]*$/.test(after)) {
        return before.replace(/[:\-\u2014\u2013\s]+$/g, "").trim();
      }
    }
  }
  const parts = msg.split(/\n{2,}/);
  if (parts.length > 1 && looksLikeSameQuestion(parts[parts.length - 1], question)) {
    return parts.slice(0, -1).join("\n\n").trim();
  }
  const sentences = msg.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1 && looksLikeSameQuestion(sentences[sentences.length - 1], question)) {
    return sentences.slice(0, -1).join(" ").trim();
  }
  return msg;
}

async function callAI(
  messages: ChatMessage[],
  opts?: { state?: Record<string, unknown>; action?: string | null },
): Promise<AiResponse> {
  try {
    const res = await fetch(`${getBaseApiUrl()}/api/v1/demo/ask-freda/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        messages,
        state: opts?.state || {},
        action: opts?.action || null,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      message: data.message ?? "I encountered an error. Please try again.",
      actions: Array.isArray(data.actions) ? data.actions : [],
      next_question: data.next_question ?? null,
      phase: data.phase ?? "requirements_gathering",
      matches: Array.isArray(data.matches) ? data.matches : [],
      state: data.state && typeof data.state === "object" ? data.state : {},
    };
  } catch (err) {
    console.error("Ask Freda chat request failed:", err);
    return {
      message: "I encountered an error reaching the AI service. Please try again.",
      actions: [],
      next_question: null,
      phase: "requirements_gathering",
      matches: [],
      state: {},
    };
  }
}

function QuestionChoices({
  question,
  disabled,
  onSubmit,
}: {
  question: Extract<Turn, { kind: "question" }>;
  disabled: boolean;
  onSubmit: (answer: string) => void;
}) {
  const options = question.options || [];
  const [picked, setPicked] = useState<string[]>(() => {
    const initial = question.selected || [];
    return initial.some((item) => isAllAvailableFields(item))
      ? initial.filter((item) => isAllAvailableFields(item))
      : initial;
  });
  const [other, setOther] = useState("");
  const multi = Boolean(question.multi);
  const allFieldsSelected = picked.some((item) => isAllAvailableFields(item));

  function toggle(option: string) {
    if (disabled) return;
    if (multi) {
      if (isAllAvailableFields(option)) {
        setPicked((current) => (current.some((item) => isAllAvailableFields(item)) ? [] : [option]));
        setOther("");
        return;
      }
      if (allFieldsSelected) return;
      setPicked((current) =>
        current.includes(option) ? current.filter((item) => item !== option) : [...current, option],
      );
      return;
    }
    setPicked([option]);
  }

  function submit() {
    const exclusive = picked.find((item) => isAllAvailableFields(item));
    const answer = exclusive || [...picked, other.trim()].filter(Boolean).join("; ");
    if (!answer || disabled) return;
    onSubmit(answer);
  }

  if (!options.length && !question.allowOther) return null;

  return (
    <div className="space-y-2" onKeyDown={(event) => event.stopPropagation()}>
      {options.length > 0 && (
        <div className="flex flex-col gap-1.5" role={multi ? "group" : "radiogroup"} aria-label={question.text}>
          {multi && (
            <div className="text-[11px] text-muted-foreground">
              {allFieldsSelected
                ? "All available fields covers every option. Clear it to pick individual fields."
                : "Select all that apply, then Continue."}
            </div>
          )}
          {options.map((option) => {
            const selected = picked.includes(option);
            const lockedOut = allFieldsSelected && !isAllAvailableFields(option);
            return (
              <button
                key={option}
                type="button"
                disabled={disabled || lockedOut}
                aria-pressed={selected}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggle(option);
                }}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors",
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card hover:bg-secondary",
                  (disabled || lockedOut) && "cursor-default opacity-60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border",
                    multi ? "rounded-[4px]" : "rounded-full",
                    selected ? "border-primary bg-primary" : "border-muted-foreground/40 bg-background",
                  )}
                  aria-hidden
                >
                  {selected ? (
                    <span className={cn("bg-primary-foreground", multi ? "h-2 w-2 rounded-[1px]" : "h-1.5 w-1.5 rounded-full")} />
                  ) : null}
                </span>
                <span className={cn("min-w-0 break-words", selected && "font-medium")}>{option}</span>
              </button>
            );
          })}
        </div>
      )}
      {question.allowOther !== false && (
        <input
          type="text"
          value={other}
          disabled={disabled || allFieldsSelected}
          onChange={(event) => setOther(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              submit();
            }
          }}
          placeholder="Other — type your own answer"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground disabled:opacity-50"
        />
      )}
      <Button type="button" size="sm" disabled={disabled || (!picked.length && !other.trim())} onClick={submit}>
        Continue
      </Button>
    </div>
  );
}

function FredaAi() {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedOnMount = useRef(readAskFredaSession());
  const historyRef = useRef<ChatMessage[]>((savedOnMount.current?.history as ChatMessage[]) || []);
  const engineStateRef = useRef<Record<string, unknown>>(savedOnMount.current?.engineState || {});
  const turnsRef = useRef<Turn[]>((savedOnMount.current?.turns as Turn[]) || [INITIAL_TURN]);
  const phaseRef = useRef(savedOnMount.current?.phase || "intake");
  const submittedRef = useRef(Boolean(savedOnMount.current?.submitted));
  const [ready, setReady] = useState(typeof window !== "undefined");

  const [history, setHistory] = useState<ChatMessage[]>(() => (savedOnMount.current?.history as ChatMessage[]) || []);
  const [turns, setTurns] = useState<Turn[]>(() => (savedOnMount.current?.turns as Turn[]) || [INITIAL_TURN]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string>(() => savedOnMount.current?.phase || "intake");
  const [submitted, setSubmitted] = useState(() => Boolean(savedOnMount.current?.submitted));
  const [submitError, setSubmitError] = useState(false);
  const [, setEngineState] = useState<Record<string, unknown>>(() => savedOnMount.current?.engineState || {});

  historyRef.current = history;
  turnsRef.current = turns;
  phaseRef.current = phase;
  submittedRef.current = submitted;

  useEffect(() => {
    const restored = readAskFredaSession();
    if (restored?.turns?.length) {
      const nextHistory = (restored.history as ChatMessage[]) || [];
      const nextTurns = restored.turns as Turn[];
      historyRef.current = nextHistory;
      turnsRef.current = nextTurns;
      phaseRef.current = restored.phase || "intake";
      submittedRef.current = Boolean(restored.submitted);
      engineStateRef.current = restored.engineState || {};
      setHistory(nextHistory);
      setTurns(nextTurns);
      setPhase(restored.phase || "intake");
      setSubmitted(Boolean(restored.submitted));
      setEngineState(restored.engineState || {});
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    pane.scrollTop = pane.scrollHeight;
  }, [turns, loading]);

  useEffect(() => {
    if (!ready) return;
    writeAskFredaSession({
      history,
      turns,
      phase,
      engineState: engineStateRef.current,
      submitted,
    });
  }, [ready, history, turns, phase, submitted]);

  function applyAiResponse(res: AiResponse) {
    setPhase(res.phase);
    const nextState = res.state && typeof res.state === "object" ? res.state : {};
    engineStateRef.current = nextState;
    setEngineState(nextState);

    const question = normalizeQuestion(res.next_question);
    const leadIn = question ? leadInWithoutQuestion(res.message, question.text) : (res.message || "").trim();
    setTurns((prev) => {
      const next: Turn[] = [...prev];
      if (leadIn || (res.actions && res.actions.length) || (res.matches && res.matches.length)) {
        next.push({ kind: "freda", text: leadIn, actions: res.actions, matches: res.matches });
      }
      if (question) {
        next.push({
          kind: "question",
          text: question.text,
          options: question.options,
          multi: question.multi,
          allowOther: question.allowOther,
          selected: question.selected,
          field: question.field,
        });
      }
      return next;
    });

    const assistantContent = leadIn && question && leadIn.toLowerCase() !== question.text.toLowerCase()
      ? `${leadIn}\n\n${question.text}`
      : (leadIn || question?.text || res.message);
    const nextHistory: ChatMessage[] = [...historyRef.current, { role: "assistant", content: assistantContent }];
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  }

  async function send(overrideText?: string, action?: string | null, displayText?: string) {
    const text = (overrideText ?? draft).trim();
    const pathAction = Boolean(action && PATH_ACTIONS.has(action));
    if ((!text && !action) || loading || submitted) return;
    setDraft("");
    setLoading(true);

    const shown = (displayText ?? (pathAction ? text || undefined : text))?.trim();
    if (shown) {
      setTurns((prev) => [...prev, { kind: "user", text: shown }]);
    }

    const outgoing: ChatMessage[] =
      text && !pathAction
        ? [...historyRef.current, { role: "user", content: text }]
        : historyRef.current;
    historyRef.current = outgoing;
    setHistory(outgoing);

    const res = await callAI(outgoing, { state: engineStateRef.current, action: action || null });
    setLoading(false);
    applyAiResponse(res);
  }

  function persistChat() {
    writeAskFredaSession({
      history: historyRef.current,
      turns: turnsRef.current,
      phase: phaseRef.current,
      engineState: engineStateRef.current,
      submitted: submittedRef.current,
    });
  }

  function openPlaybook(route: string) {
    persistChat();
    goToAppRoute(navigate, route);
  }

  async function onAction(action: AiAction) {
    if (action.route) {
      openPlaybook(action.route);
      return;
    }
    if (action.action) {
      await send(PATH_ACTIONS.has(action.action) ? "" : action.label, action.action, action.label);
    }
  }

  async function submit() {
    const genesisPhase = String(engineStateRef.current.phase || "");
    if (genesisPhase === "confirming" || genesisPhase === "estimated") {
      await send("", "submit_job", "Submit request");
      setSubmitted(true);
      return;
    }
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
    historyRef.current = [];
    engineStateRef.current = {};
    turnsRef.current = [INITIAL_TURN];
    phaseRef.current = "intake";
    submittedRef.current = false;
    clearAskFredaSession();
    setHistory([]);
    setTurns([INITIAL_TURN]);
    setDraft("");
    setLoading(false);
    setPhase("intake");
    setSubmitted(false);
    setSubmitError(false);
    setEngineState({});
  }

  const hasExchanged = turns.some((t) => t.kind === "user");
  const showSubmit =
    hasExchanged &&
    !submitted &&
    !loading &&
    ["confirming", "confirmed", "estimated"].includes(phase);
  const latestQuestionIndex = turns.reduce((found, turn, index) => (turn.kind === "question" ? index : found), -1);

  return (
    <AppLayout>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
        <Card className="flex min-h-0 flex-1 w-full max-w-3xl mx-auto flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3">
            <span className="h-7 w-7 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-[13px] font-semibold leading-tight">Ask Freda</div>
                <Badge tone="purple" className="gap-1.5">
                  <Sparkles className="h-3 w-3" /> AI Consultant
                </Badge>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                Agents · Solutions · New data requests
              </div>
            </div>
            {hasExchanged && (
              <Button type="button" variant="outline" size="sm" className="ml-auto shrink-0" onClick={restart}>
                Start over
              </Button>
            )}
            <span className={hasExchanged ? "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0" : "ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0"}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  loading ? "bg-amber-400 animate-pulse" : "bg-success animate-pulse"
                }`}
              />
              {submitted ? "Submitted" : loading ? "Thinking…" : "Ready"}
            </span>
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 space-y-4"
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
                const isLatest = i === latestQuestionIndex;
                return (
                  <div key={i} className="flex gap-2.5">
                    <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 max-w-[80%] space-y-2">
                      <div className="rounded-lg bg-secondary border border-primary/20 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground font-medium">
                        {turn.text}
                      </div>
                      <QuestionChoices
                        question={turn}
                        disabled={!isLatest || loading || submitted}
                        onSubmit={(answer) => void send(answer, "answer_question")}
                      />
                    </div>
                  </div>
                );
              }

              const actionsLive = i === turns.length - 1 || (turn.kind === "freda" && turns[i + 1]?.kind === "question" && i + 1 === latestQuestionIndex);
              return (
                <div key={i} className="flex gap-2.5">
                  <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 max-w-[82%] space-y-2">
                    {turn.text ? (
                      <div className="rounded-lg bg-secondary px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-foreground">
                        {turn.text}
                        {turn.note && (
                          <div className="text-[11.5px] text-muted-foreground mt-1.5">{turn.note}</div>
                        )}
                      </div>
                    ) : null}

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
                              type="button"
                              onClick={() => openPlaybook(m.route)}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary px-3 py-1.5 text-[12px] font-medium transition-colors"
                            >
                              {m.type === "agent" ? "Use this agent" : "Use this capability"}
                              <ArrowRight className="h-3 w-3 opacity-60" />
                            </button>
                          </Card>
                        ))}
                      </div>
                    )}

                    {turn.actions && turn.actions.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {turn.actions.map((action, ai) =>
                          (action.route || action.action) && actionsLive ? (
                            <button
                              key={ai}
                              type="button"
                              disabled={loading || submitted}
                              onClick={() => void onAction(action)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 disabled:opacity-50 text-primary px-3 py-1.5 text-[12px] font-medium transition-colors"
                            >
                              {action.label}
                              <ArrowRight className="h-3 w-3 opacity-60" />
                            </button>
                          ) : (
                            <button
                              key={ai}
                              type="button"
                              disabled
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card text-muted-foreground px-3 py-1.5 text-[12px] font-medium opacity-60"
                            >
                              {action.label}
                              <ArrowRight className="h-3 w-3 opacity-60" />
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

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

          {showSubmit && (
            <div className="shrink-0 border-t border-border px-5 py-3 flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" onClick={submit}>
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

          <div className="shrink-0 border-t border-border px-5 py-3 space-y-2">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const gathering = ["requirements_gathering", "gathering", "revising"].includes(phase);
                    void send(undefined, gathering ? "answer_question" : null);
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
              <Button
                type="button"
                disabled={!draft.trim() || loading || submitted}
                onClick={() => {
                  const gathering = ["requirements_gathering", "gathering", "revising"].includes(phase);
                  void send(undefined, gathering ? "answer_question" : null);
                }}
              >
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
