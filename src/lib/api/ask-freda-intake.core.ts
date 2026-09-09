// AI-driven requirement-gathering for Ask FreDA's "new agent / solution"
// intake flow. The basics (type, name, industry, geography) are collected
// via fixed quick-reply/free-text steps in AskFredaPanel.tsx; once those are
// known, this engine asks OpenAI what the single most useful follow-up
// question is (grounded in what's already been said, so it doesn't repeat
// itself or ask something irrelevant to that industry/geography), and later
// turns the whole conversation into structured ticket fields. Reuses the
// same OpenAI plumbing as monitoring-refresh.core.ts rather than
// duplicating it — this file only knows about intake-specific prompts.
import { callOpenAI, parseAiJson } from "./monitoring-refresh.core";

export type QaTurn = { question: string; answer: string };

export type IntakeContext = {
  requestType: "Agent" | "Solution";
  name: string;
  industry: string;
  geography: string;
  qaHistory: QaTurn[];
};

export type FollowUpResult = { question: string | null; done: boolean };

export type IntakeSummary = {
  sources: string[];
  datapoints: string[];
  schedule: string;
  summary: string;
};

const MAX_FOLLOWUPS = 3;

function contextBlock(ctx: IntakeContext): string {
  const lines = [
    `Request type: ${ctx.requestType}`,
    `Name / description: ${ctx.name}`,
    `Industry: ${ctx.industry}`,
    `Geography: ${ctx.geography}`,
  ];
  if (ctx.qaHistory.length) {
    lines.push("", "Already asked and answered:");
    for (const t of ctx.qaHistory) lines.push(`Q: ${t.question}\nA: ${t.answer}`);
  }
  return lines.join("\n");
}

export function buildFollowUpPrompt(ctx: IntakeContext): string {
  return `You are FreDA, a data-sourcing assistant helping a customer scope a new ${ctx.requestType === "Agent" ? "data extraction agent (a single source)" : "packaged data solution (multiple sources bundled together)"}.

${contextBlock(ctx)}

Your job: ask ONE more short, specific question that would most help a data engineering team actually build this — e.g. which websites/portals to source from, which exact data fields/attributes to extract, update frequency, or any constraint specific to the ${ctx.industry} industry and ${ctx.geography} geography. Never re-ask something already answered above. If you already have enough to hand this off to an engineer (industry, geography, roughly what data is needed, and either a schedule or an obvious default), set done to true and question to null instead of asking a filler question.

You have already asked ${ctx.qaHistory.length} follow-up question(s); do not exceed ${MAX_FOLLOWUPS} total — if you're at or past that, set done to true.

Respond with ONLY a JSON object: {"question": "..." or null, "done": true or false}. No prose, no markdown.`;
}

export function buildSummaryPrompt(ctx: IntakeContext): string {
  return `You are FreDA, a data-sourcing assistant. A customer has finished scoping a new ${ctx.requestType === "Agent" ? "data extraction agent" : "packaged data solution"} request. Turn the conversation below into structured fields for the engineering ticket.

${contextBlock(ctx)}

Respond with ONLY a JSON object:
{
  "sources": ["short label or URL for each website/portal/source mentioned or clearly implied — best guess is fine, empty array if truly none was given"],
  "datapoints": ["each distinct data attribute/field the customer wants extracted, one per entry"],
  "schedule": "Daily" | "Weekly" | "Monthly" | a short custom cadence string if one was mentioned,
  "summary": "one or two sentence plain-English summary of the request, written for an engineer who will build it"
}
No prose outside the JSON, no markdown code fences.`;
}

function safeParseFollowUp(raw: string): FollowUpResult {
  try {
    const parsed = parseAiJson(raw);
    const question = typeof parsed.question === "string" && parsed.question.trim() ? parsed.question.trim() : null;
    const done = parsed.done === true || question === null;
    return { question: done ? null : question, done };
  } catch {
    return { question: null, done: true };
  }
}

function safeParseSummary(raw: string, ctx: IntakeContext): IntakeSummary {
  try {
    const parsed = parseAiJson(raw);
    const sources = Array.isArray(parsed.sources) ? parsed.sources.map(String).filter(Boolean) : [];
    const datapoints = Array.isArray(parsed.datapoints) ? parsed.datapoints.map(String).filter(Boolean) : [];
    const schedule = typeof parsed.schedule === "string" && parsed.schedule.trim() ? parsed.schedule.trim() : "Weekly";
    const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallbackSummary(ctx);
    return { sources, datapoints, schedule, summary };
  } catch {
    return fallbackIntakeSummary(ctx);
  }
}

function fallbackSummary(ctx: IntakeContext): string {
  return `${ctx.requestType} request for ${ctx.industry} (${ctx.geography}): ${ctx.name}`;
}

/** Used when no AI key is configured, or a call fails — keeps the flow
 *  working end to end (just without AI-picked follow-ups), same graceful
 *  degradation pattern as monitoring-refresh.core.ts's `!apiKey` path. */
export function fallbackIntakeSummary(ctx: IntakeContext): IntakeSummary {
  return {
    sources: [],
    datapoints: ctx.qaHistory.map((t) => t.answer.trim()).filter(Boolean),
    schedule: "Weekly",
    summary: fallbackSummary(ctx),
  };
}

export async function getNextFollowUp(ctx: IntakeContext, apiKey: string, model: string): Promise<FollowUpResult> {
  if (!apiKey || ctx.qaHistory.length >= MAX_FOLLOWUPS) return { question: null, done: true };
  try {
    const raw = await callOpenAI(apiKey, model, buildFollowUpPrompt(ctx), 20000);
    return safeParseFollowUp(raw);
  } catch {
    return { question: null, done: true };
  }
}

export async function summarizeIntake(ctx: IntakeContext, apiKey: string, model: string): Promise<IntakeSummary> {
  if (!apiKey) return fallbackIntakeSummary(ctx);
  try {
    const raw = await callOpenAI(apiKey, model, buildSummaryPrompt(ctx), 20000);
    return safeParseSummary(raw, ctx);
  } catch {
    return fallbackIntakeSummary(ctx);
  }
}
