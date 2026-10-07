import { emptySession, readSession, writeSession, type ChatSession } from "@/lib/freda/session";
import { useCapabilityHref } from "@/lib/freda/capability-link";
import type { AgentHit, SolutionHit, UserActionType } from "@/lib/freda/types";

const API = process.env.FREDA_API_URL || "http://127.0.0.1:43148";

function detailFrom(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Request failed";
  const record = payload as { detail?: unknown; error?: unknown };
  const detail = record.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (item && typeof item === "object" && "msg" in item ? String(item.msg) : ""))
      .filter(Boolean)
      .join(" ") || "Request failed";
  }
  if (typeof record.error === "string") return record.error;
  return "Request failed";
}

function isUseThisCapability(action?: UserActionType, message?: string, phase?: string) {
  if (action === "use_existing") return true;
  if (phase !== "awaiting_path") return false;
  return /\b(use this( capability)?|use existing|without the missing sources)\b/i.test(message || "");
}

function namedCapability(
  message: string | undefined,
  solutions: SolutionHit[],
  agents: AgentHit[],
): { kind: "solution" | "agent"; id: string } | undefined {
  const raw = (message || "").trim();
  if (!raw) return undefined;
  const rest = raw.replace(/^use\s+/i, "").replace(/\s+capability\.?$/i, "").trim().toLowerCase();
  if (!rest || rest === "this" || rest === "existing" || rest.startsWith("this ") || rest.startsWith("existing ")) {
    return undefined;
  }
  const solution =
    solutions.find((item) => item.name.toLowerCase() === rest) ||
    solutions.find((item) => rest.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(rest));
  if (solution) return { kind: "solution", id: solution.id };
  const agent =
    agents.find((item) => item.name.toLowerCase() === rest) ||
    agents.find((item) => rest.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(rest));
  if (agent) return { kind: "agent", id: agent.id };
  return undefined;
}

function capabilityRedirect(data: ChatSession, message?: string): string {
  const solutions = data.state.solutionHits || [];
  const agents = data.state.agentHits || [];
  const named = namedCapability(message, solutions, agents);
  if (named?.kind === "solution") return useCapabilityHref("solution", named.id);
  if (named?.kind === "agent") return useCapabilityHref("agent", named.id);
  if (solutions.length === 1) return useCapabilityHref("solution", solutions[0].id);
  if (solutions.length > 1) return useCapabilityHref();
  if (agents.length === 1) return useCapabilityHref("agent", agents[0].id);
  return useCapabilityHref();
}

export async function handleFredaForm(formData: FormData): Promise<{ redirectTo?: string } | void> {
  const { id, data } = await readSession();

  if (formData.get("reset")) {
    await writeSession(id, emptySession());
    return;
  }

  const suggestion = String(formData.get("suggestion") || "").trim();
  const typed = String(formData.get("message") || "").trim();
  const selected = formData.getAll("choice").map((value) => String(value).trim()).filter(Boolean);
  const other = String(formData.get("choice_other") || "").trim();
  const assembled = [...selected, other].filter(Boolean).join("; ");
  const message = suggestion || typed || assembled;
  const actionRaw = String(formData.get("action") || "").trim();
  const action = (actionRaw || undefined) as UserActionType | undefined;

  if (!message && !action) return;

  if (
    isUseThisCapability(action, message, data.state.phase) ||
    (data.state.phase === "awaiting_path" &&
      namedCapability(message, data.state.solutionHits || [], data.state.agentHits || []))
  ) {
    return { redirectTo: capabilityRedirect(data, message) };
  }

  try {
    const response = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        state: data.state,
        action,
        history: [
          ...data.turns.slice(-8).map((turn) => ({ role: turn.role, text: turn.text })),
          ...(message ? [{ role: "user", text: message }] : []),
        ],
      }),
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      await writeSession(id, { ...data, error: detailFrom(payload) });
      return;
    }
    const nextTurns = [...data.turns];
    if (message) {
      nextTurns.push({ id: `user-${nextTurns.length + 1}`, role: "user", text: message });
    }
    nextTurns.push({
      id: `freda-${nextTurns.length + 1}`,
      role: "freda",
      text: payload.text as string,
      cards: payload.cards,
    });
    await writeSession(id, {
      state: payload.state,
      turns: nextTurns,
      error: null,
    });
  } catch (error) {
    await writeSession(id, {
      ...data,
      error:
        error instanceof Error
          ? error.message
          : "The Ask Freda Python API is not reachable. Start it with npm run api.",
    });
  }
}
