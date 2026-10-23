const STORAGE_KEY = "freda.askFreda.session.v1";

export type AskFredaSavedSession = {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  turns: unknown[];
  phase: string;
  engineState: Record<string, unknown>;
  submitted: boolean;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function readAskFredaSession(): AskFredaSavedSession | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AskFredaSavedSession;
    if (!parsed || !Array.isArray(parsed.turns) || parsed.turns.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAskFredaSession(session: AskFredaSavedSession) {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota or private-mode — keep the in-memory chat either way.
  }
}

export function clearAskFredaSession() {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasAskFredaConversation() {
  const saved = readAskFredaSession();
  if (!saved) return false;
  return saved.turns.some((turn) => turn && typeof turn === "object" && (turn as { kind?: string }).kind === "user");
}
