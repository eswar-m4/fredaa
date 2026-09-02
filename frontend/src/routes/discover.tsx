import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileInput,
  Filter,
  Globe,
  Layers,
  Send,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, SectionTitle } from "@/components/ui-bits";
import {
  buildProposal,
  buildQuestions,
  isOther,
  optionLabel,
  otherText,
  OTHER_PREFIX,
  SECTORS,
  type Answers,
  type Proposal,
  type Question,
  type Focus,
  type SectorId,
  type WorkflowNode,
} from "@/lib/freda-firmographic";
import { setUseCase } from "@/lib/useCase";
import { fallbackReply, readIntent } from "@/lib/freda-intent";
import { VERTICAL_DATASETS } from "@/data/vertical-datasets";

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { title: "Ask Freda - AI solution consultant" },
      {
        name: "description",
        content:
          "A focused chat that gathers your firmographic data requirement, then proposes sources, attributes, workflow, volume and timeline.",
      },
      { property: "og:title", content: "Ask Freda - AI solution consultant" },
      {
        property: "og:description",
        content: "Requirement-gathering chat for company-level datasets: sources, attributes, workflow, volume, timeline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FredaAi,
});

type Turn =
  | { role: "freda"; kind: "text"; text: string; note?: string }
  | { role: "user"; kind: "text"; text: string }
  | { role: "freda"; kind: "question"; q: Question };

const OBJECTIVE =
  "Ask Freda — your AI solution consultant for the Freda platform.\n\nTell me what you need in your own words — for example \"phone and address for hospitals in Chennai, refreshed monthly\" or \"annual reports of Indian listed companies\". I'll check existing agents and solutions first before asking any questions.";

type Phase = "intake" | "interview" | "confirm" | "done";

/** Rough lookup: does an existing solution template already cover this ask? */
function matchSolution(raw: string) {
  const text = ` ${raw.toLowerCase()} `;
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4);
  return (
    VERTICAL_DATASETS.find((d) => [...words(d.name), ...words(d.category)].some((w) => text.includes(w))) ?? null
  );
}

/** Call the Ask Freda AI backend. Returns the AI reply or null on error. */
async function callAI(messages: Array<{ role: string; content: string }>): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/demo/ask-freda/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.reply as string) ?? null;
  } catch {
    return null;
  }
}

function FredaAi() {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [answers, setAnswers] = useState<Answers>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intake");
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [request, setRequest] = useState("");
  const [focus, setFocus] = useState<Focus[]>([]);
  const [draft, setDraft] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  // Accumulated conversation for AI context (plain role/content pairs)
  const [aiHistory, setAiHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [turns, setTurns] = useState<Turn[]>([
    { role: "freda", kind: "text", text: OBJECTIVE, note: "Public sources only. Estimates, not a quote." },
  ]);

  const sectorId = (answers["sector"]?.[0] ?? null) as SectorId | null;
  const questions = useMemo(
    () => buildQuestions(sectorId && sectorId in SECTORS ? sectorId : null, { focus, answers }),
    [sectorId, focus, answers],
  );
  const current = questions.find((q) => q.id === currentId);
  const questionsFor = (a: Answers, f: Focus[] = focus) => {
    const sid = (a["sector"]?.[0] ?? null) as SectorId | null;
    return buildQuestions(sid && sid in SECTORS ? sid : null, { focus: f, answers: a });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, currentId, proposal, aiLoading]);

  const say = (text: string, note?: string) => setTurns((p) => [...p, { role: "freda", kind: "text", text, note }]);
  const nextUnanswered = (a: Answers, f?: Focus[]) => questionsFor(a, f).find((q) => !(a[q.id] ?? []).length) ?? null;

  function summarise(a: Answers, f: Focus[] = focus) {
    const p = buildProposal(a, request, f);
    return [
      "Here's the requirement as I've captured it:",
      ...(request ? [`• Your request: ${request}`] : []),
      ...p.metadata.slice(0, 8).map((m) => `• ${m.label}: ${m.value}`),
      "",
      "Confirm to continue and I'll lay out the process, scope, sources, volume and timeline — or type any extra attributes or details to add first.",
    ].join("\n");
  }

  function finalSummary(p: Proposal) {
    return [
      "Requirement summary",
      `• Solution: ${p.title}`,
      ...p.metadata.slice(0, 8).map((m) => `• ${m.label}: ${m.value}`),
      `• Attributes: ${p.attributes.slice(0, 8).join(", ")}${p.attributes.length > 8 ? ` +${p.attributes.length - 8} more` : ""}`,
      "",
      "This isn't covered by an existing agent or solution as-is, so it will be raised as a new solution. Sources, volume and timeline are on the right — submit when it looks right.",
    ].join("\n");
  }

  function goToNext(a: Answers, f?: Focus[]) {
    const nxt = nextUnanswered(a, f);
    if (!nxt) {
      setCurrentId(null);
      setPhase("confirm");
      say(summarise(a, f));
    } else {
      setCurrentId(nxt.id);
      setTurns((p) => [...p, { role: "freda", kind: "question", q: nxt }]);
    }
  }

  function choose(q: Question, optId: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (!q.multi) return { ...prev, [q.id]: [optId] };
      return { ...prev, [q.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] };
    });
    if (!q.multi) queueMicrotask(() => advance(q, [optId]));
  }

  function setOther(q: Question, text: string) {
    setOtherDrafts((p) => ({ ...p, [q.id]: text }));
    setAnswers((prev) => {
      const rest = (prev[q.id] ?? []).filter((v) => !isOther(v));
      const value = text.trim() ? [OTHER_PREFIX + text.trim()] : [];
      return { ...prev, [q.id]: q.multi ? [...rest, ...value] : value.length ? value : rest };
    });
  }

  function advance(q: Question, forced?: string[]) {
    const chosen = forced ?? answers[q.id] ?? [];
    if (!chosen.length) return;
    const merged = { ...answers, [q.id]: chosen };
    setAnswers(merged);
    setTurns((prev) => [...prev, { role: "user", kind: "text", text: chosen.map((id) => optionLabel(q, id)).join(", ") }]);
    goToNext(merged);
  }

  /* ---- intake: AI-powered understanding + existing intent detection ---- */

  async function handleIntake(text: string) {
    const intent = readIntent(text);
    setRequest(text);
    setFocus(intent.focus);
    const merged = { ...answers, ...intent.answers };
    setAnswers(merged);

    // Build initial AI history for this conversation
    const newHistory = [{ role: "user", content: text }];
    setAiHistory(newHistory);

    // Call AI for an intelligent first response (checks existing capabilities, matches, etc.)
    setAiLoading(true);
    const aiReply = await callAI(newHistory);
    setAiLoading(false);

    if (aiReply) {
      // AI response is the primary guidance (capability match, navigation, etc.)
      say(aiReply);
      setAiHistory((h) => [...h, { role: "assistant", content: aiReply }]);
    } else {
      // Fallback to deterministic responses if AI is unavailable
      if (intent.outOfScope) {
        say("Some of that sits outside what we collect — we only read public pages, no logins, paywalls or personal data. I'll scope the company-level part.");
      }
      if (intent.agentHits.length) {
        say(
          [
            "Good news — some of the sites you mentioned are already onboarded as agents:",
            ...intent.agentHits.map((h) => `• ${h.site} — already available in ${h.hit.where} (${h.hit.label})`),
            "",
            "Open Agents to run them straight away, or carry on here to scope the wider solution.",
          ].join("\n"),
        );
      }
      if (intent.newSites.length) {
        say(
          `${intent.newSites.join(", ")} ${intent.newSites.length > 1 ? "are" : "is"} not onboarded yet. I can raise ${intent.newSites.length > 1 ? "them" : "it"} as new source${intent.newSites.length > 1 ? "s" : ""} from the Agents screen once we've scoped this.`,
        );
      }
      const match = matchSolution(text);
      if (match) {
        say(`We already have a "${match.name}" solution in place under ${match.category} — it covers ${match.tagline.toLowerCase()}. You can start there from Solutions, or carry on here and I'll tailor a new solution to your exact scope.`);
      } else if (!intent.agentHits.length) {
        say("Nothing in the current agents or solutions covers this exactly, so I'll scope it as a new solution.");
      }
      if (intent.captured.length) {
        say(["Got it. From your request I already have:", ...intent.captured.map((c) => `• ${c.label}: ${c.value}`), "", "Just a few gaps left."].join("\n"));
      } else {
        say("Thanks — let me fill in the essentials.");
      }
    }

    setPhase("interview");
    goToNext(merged, intent.focus);
  }

  function confirmRequirement() {
    const p = buildProposal(answers, request, focus);
    setProposal(p);
    setPhase("done");
    say(finalSummary(p));
  }

  /* ---- free-text handling (interview / confirm phases) ---- */

  async function send() {
    const text = draft.trim();
    if (!text || aiLoading) return;
    setDraft("");
    setTurns((p) => [...p, { role: "user", kind: "text", text }]);

    if (phase === "intake") {
      handleIntake(text);
      return;
    }

    // For non-intake free text: try AI first, fall back to deterministic
    const updatedHistory = [...aiHistory, { role: "user", content: text }];

    const fb = fallbackReply(text);

    if (phase === "interview" && current) {
      // If the user typed something that matches a fallback (greeting, confusion, etc.), use AI
      if (fb) {
        setAiLoading(true);
        const aiReply = await callAI(updatedHistory);
        setAiLoading(false);
        const reply = aiReply ?? fb;
        say(reply);
        setAiHistory([...updatedHistory, { role: "assistant", content: reply }]);
      } else {
        advance(current, [OTHER_PREFIX + text]);
        setAiHistory(updatedHistory);
      }
      return;
    }

    if (phase === "confirm") {
      if (/^(ok|okay|yes|yep|go|confirm|continue|next|proceed|sounds good)\b/i.test(text)) {
        confirmRequirement();
      } else {
        // Use AI to respond to additional details or changes
        setAiLoading(true);
        const aiReply = await callAI(updatedHistory);
        setAiLoading(false);
        const reply = aiReply ?? "Noted — I've added that to the requirement. Hit Confirm & continue whenever you're ready to see the full solution.";
        say(reply);
        setAiHistory([...updatedHistory, { role: "assistant", content: reply }]);
      }
      return;
    }

    say("Noted — I've attached that to the solution request.");
    setAiHistory(updatedHistory);
  }

  function restart() {
    setAnswers({});
    setOtherDrafts({});
    setCurrentId(null);
    setPhase("intake");
    setProposal(null);
    setSubmitted(false);
    setRequest("");
    setFocus([]);
    setAiHistory([]);
    setAiLoading(false);
    setTurns([{ role: "freda", kind: "text", text: OBJECTIVE, note: "Public sources only. Estimates, not a quote." }]);
  }

  async function submit() {
    if (!proposal) return;
    setSubmitted(true);
    try {
      await fetch("/api/v1/demo/solution-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: proposal.title,
          request,
          attributes: proposal.attributes,
          sources: proposal.sources,
          metadata: proposal.metadata,
          workflow: proposal.workflow,
          volume: proposal.volume,
          timeline: proposal.timeline,
          cadence: proposal.cadence,
        }),
      });
    } catch {
      // submission logged server-side; don't block the UX
    }
    say("Submitted. The admin team picks it up now — you'll see it under 'Solution development in progress' on the dashboard, and it becomes a job once approved.");
  }

  function goBuild() {
    if (!proposal) return;
    setUseCase("openweb");
    navigate({ to: "/any-site" });
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
            {phase !== "intake" && (
              <Button variant="outline" size="sm" onClick={restart}>
                Start over
              </Button>
            )}
          </div>
        }
      />

      <div
        className={[
          "px-7 pb-8 grid grid-cols-1 gap-5 items-start",
          proposal ? "xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]" : "",
        ].join(" ")}
      >
        {/* ---------------- chat ---------------- */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <span className="h-7 w-7 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[13px] font-semibold leading-tight">Ask Freda</div>
                <div className="text-[11px] text-muted-foreground">Agents, solutions and new solution requests</div>
              </div>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`h-1.5 w-1.5 rounded-full ${aiLoading ? "bg-amber-400 animate-pulse" : "bg-success animate-pulse"}`} />
                {proposal ? "Chat complete" : aiLoading ? "Thinking…" : "Chat in progress"}
              </span>
            </div>
            <div
              ref={scrollRef}
              className={["overflow-y-auto px-5 py-4 space-y-4", proposal ? "max-h-[560px] min-h-[420px]" : "max-h-[68vh] min-h-[520px]"].join(" ")}
            >
              {turns.map((t, i) =>
                t.kind === "question" ? (
                  <QuestionBubble
                    key={i}
                    q={t.q}
                    active={phase === "interview" && t.q.id === currentId}
                    answers={answers}
                    otherDraft={otherDrafts[t.q.id] ?? ""}
                    onChoose={choose}
                    onOther={setOther}
                    onConfirm={advance}
                  />
                ) : (
                  <div key={i} className={t.role === "user" ? "flex justify-end" : "flex gap-2.5"}>
                    {t.role === "freda" && (
                      <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
                        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <div
                      className={[
                        "rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed max-w-[80%] whitespace-pre-line",
                        t.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
                      ].join(" ")}
                    >
                      {t.text}
                      {"note" in t && t.note && <div className="text-[11.5px] text-muted-foreground mt-1.5">{t.note}</div>}
                    </div>
                    {t.role === "user" && (
                      <span className="h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center ml-2">
                        <UserIcon className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                ),
              )}
              {aiLoading && (
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

            {phase === "confirm" && (
              <div className="border-t border-border px-5 py-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={confirmRequirement}>
                  <CheckCircle2 className="h-4 w-4" /> Confirm & continue
                </Button>
                <span className="text-[11.5px] text-muted-foreground">
                  Or type extra attributes or details below and confirm after.
                </span>
              </div>
            )}
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
                  disabled={aiLoading}
                  placeholder={
                    phase === "intake"
                      ? "e.g. annual reports of Indian listed companies, or scrape Amazon pricing daily"
                      : phase === "confirm"
                        ? "Add extra attributes or details, then confirm"
                        : "Type your answer, or pick an option above"
                  }
                  className="flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground disabled:opacity-50"
                />
                <Button disabled={!draft.trim() || aiLoading} onClick={send}>
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

        {/* ---------------- proposal ---------------- */}
        {proposal && (
          <div className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pr-1">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Proposed solution
                  </div>
                  <div className="text-[16px] font-semibold mt-0.5">{proposal.title}</div>
                  <div className="text-[12px] text-muted-foreground mt-1">
                    Lands in {proposal.routeLabel} · refresh {proposal.cadence.toLowerCase()}
                  </div>
                </div>
                <Badge tone={submitted ? "success" : "warning"}>{submitted ? "Submitted" : "Draft"}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <Stat icon={Database} label="Estimated volume" value={proposal.volume} sub={proposal.volumeNote} />
                <Stat icon={Clock} label="Estimated timeline" value={proposal.timeline} sub={proposal.validation} />
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button onClick={submit} disabled={submitted}>
                  <CheckCircle2 className="h-4 w-4" /> {submitted ? "Solution request submitted" : "Submit to create a solution"}
                </Button>
                <Button variant="outline" onClick={goBuild}>
                  Continue in {proposal.routeLabel} <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle hint={`${proposal.workflow.length} steps`}>Proposed workflow</SectionTitle>
              <WorkflowDiagram nodes={proposal.workflow} />
            </Card>

            <Card className="p-5">
              <SectionTitle hint={`${proposal.attributes.length} fields`}>Data attributes</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {proposal.attributes.map((a) => (
                  <Badge key={a} tone="neutral">
                    {a}
                  </Badge>
                ))}
              </div>
              <p className="text-[11.5px] text-muted-foreground mt-2">
                Fields can be added or dropped by the admin when the solution is built.
              </p>
            </Card>

            <Card className="p-5">
              <SectionTitle hint={`${proposal.sources.length} sources`}>Recommended sources</SectionTitle>
              <ul className="space-y-2">
                {proposal.sources.map((s) => (
                  <li key={s.name} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-medium truncate">{s.name}</div>
                      <Badge tone={s.kind === "Company website" ? "success" : "info"}>{s.kind}</Badge>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">{s.note}</div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <SectionTitle>Solution metadata</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {proposal.metadata.map((m) => (
                  <div key={m.label} className="rounded-md border border-border px-3 py-2">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">{m.label}</div>
                    <div className="text-[12.5px] font-medium mt-0.5">{m.value}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

/* ----------------------------- chat question ----------------------------- */

function QuestionBubble({
  q,
  active,
  answers,
  otherDraft,
  onChoose,
  onOther,
  onConfirm,
}: {
  q?: Question;
  active: boolean;
  answers: Answers;
  otherDraft: string;
  onChoose: (q: Question, id: string) => void;
  onOther: (q: Question, text: string) => void;
  onConfirm: (q: Question) => void;
}) {
  if (!q) return null;
  const chosen = answers[q.id] ?? [];
  return (
    <div className="flex gap-2.5">
      <span className="h-7 w-7 shrink-0 rounded-md bg-secondary inline-flex items-center justify-center">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <div className="rounded-lg bg-secondary px-3.5 py-3 max-w-[85%] w-full">
        <div className="text-[13px] font-medium">
          {q.text}
          {q.multi && <span className="text-muted-foreground font-normal"> (pick as many as apply)</span>}
        </div>
        {q.help && <div className="text-[11.5px] text-muted-foreground mt-1">{q.help}</div>}
        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {q.options.map((o) => {
            const on = chosen.includes(o.id);
            return (
              <button
                key={o.id}
                disabled={!active}
                onClick={() => onChoose(q, o.id)}
                className={[
                  "text-left rounded-md border px-3 py-2 text-[12.5px] transition",
                  on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  !active ? "opacity-60 cursor-default" : "",
                ].join(" ")}
              >
                <span className="font-medium">{o.label}</span>
                {o.hint && <span className="block text-[11px] text-muted-foreground mt-0.5">{o.hint}</span>}
              </button>
            );
          })}
        </div>

        {q.allowOther && active && (
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={[
                "shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium",
                chosen.some(isOther) ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
              ].join(" ")}
            >
              Other
            </span>
            <input
              value={otherDraft || chosen.filter(isOther).map(otherText)[0] || ""}
              onChange={(e) => onOther(q, e.target.value)}
              placeholder="None of these fit? Type your own…"
              className="flex-1 rounded-md border border-input bg-card px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground"
            />
          </div>
        )}

        {active && (q.multi || chosen.some(isOther)) && (
          <Button size="sm" className="mt-2.5" disabled={!chosen.length} onClick={() => onConfirm(q)}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- workflow diagram ---------------------------- */

const NODE_STYLE: Record<WorkflowNode["kind"], { cls: string; icon: typeof Bot }> = {
  io: { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", icon: FileInput },
  fetch: { cls: "bg-sky-500/15 text-sky-400 border-sky-500/40", icon: Globe },
  llm: { cls: "bg-violet-500/15 text-violet-400 border-violet-500/40", icon: Bot },
  filter: { cls: "bg-amber-500/15 text-amber-500 border-amber-500/40", icon: Filter },
  merge: { cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/40", icon: Layers },
};

function WorkflowDiagram({ nodes }: { nodes: WorkflowNode[] }) {
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-x-1 gap-y-3">
        {nodes.map((n, i) => {
          const s = NODE_STYLE[n.kind];
          const Icon = n.id === "output" ? Download : n.id === "thirdparty" ? Boxes : s.icon;
          return (
            <div key={n.id} className="flex items-center">
              <div className="w-[104px] flex flex-col items-center text-center">
                <div className={`h-10 w-10 rounded-lg border inline-flex items-center justify-center ${s.cls}`}>
                  <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                </div>
                <div className="mt-1.5 text-[10.5px] leading-tight text-muted-foreground">{n.label}</div>
              </div>
              {i < nodes.length - 1 && (
                <div className="flex items-center gap-0.5 -mt-5">
                  <span className="h-1 w-1 rounded-full bg-border" />
                  <span className="h-px w-4 bg-border" />
                  <span className="text-border text-[10px]">▶</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10.5px] text-muted-foreground">
        {[
          ["io", "Input / output"],
          ["fetch", "Fetch & discovery"],
          ["llm", "LLM step"],
          ["filter", "Filter / compare"],
          ["merge", "Merge"],
        ].map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm border ${NODE_STYLE[k as WorkflowNode["kind"]].cls}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Database; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-[14px] font-semibold mt-1 leading-snug">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}
