import { apiFetch } from "@/lib/api";

export type SessionInfo = {
  session_token: string;
  username: string;
  user_id: string;
  display_name: string;
  role: "user" | "admin";
  created_at: string;
  updated_at: string;
  expires_at: string;
  last_seen_at: string;
};

const CURRENT_SESSION_STORAGE_KEY = "freda.auth.session.v1";

export function getStoredSession(): SessionInfo | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed as SessionInfo;
  } catch {
    return null;
  }
}

export function setStoredSession(session: SessionInfo | null | undefined) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (!session) {
      window.localStorage.removeItem(CURRENT_SESSION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures; the cookie session still works.
  }
}

export function clearStoredSession() {
  setStoredSession(null);
}

export async function fetchSession(): Promise<SessionInfo | null | undefined> {
  try {
    const response = await apiFetch("/api/v1/auth/me", { timeoutMs: 5000 });
    if (response.status === 401) {
      clearStoredSession();
      return null;
    }
    if (!response.ok) return undefined;
    const data = await response.json();
    const session = (data?.session ?? null) as SessionInfo | null;
    setStoredSession(session);
    return session;
  } catch {
    return undefined;
  }
}

export async function loginRequest(username: string, password: string, role: "user" | "admin") {
  const response = await apiFetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role }),
    timeoutMs: 10000,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Login failed");
  }
  return data as { success: boolean; session: SessionInfo };
}

export async function signupRequest(username: string, password: string, displayName?: string) {
  const response = await apiFetch("/api/v1/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, display_name: displayName }),
    timeoutMs: 10000,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Sign up failed");
  }
  return data as { success: boolean; session: SessionInfo };
}

export async function logoutRequest() {
  await apiFetch("/api/v1/auth/logout", { method: "POST" });
  clearStoredSession();
}
