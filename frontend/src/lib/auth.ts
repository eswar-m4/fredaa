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

// Read the non-httpOnly gateway cookie set by freda-auth server.mjs.
// Returns null if absent, malformed, or expired.
function getGatewayAuthCookie(): { username: string; userType: string; exp: number } | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie.split(";").find((c) => c.trim().startsWith("freda_auth="));
    if (!match) return null;
    const raw  = decodeURIComponent(match.trim().split("=").slice(1).join("="));
    const data = JSON.parse(atob(raw)) as { username: string; userType: string; exp: number };
    if (!data.username || !data.userType || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

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
  // Gateway auth cookie must be present — set by freda-auth gateway on login.
  // If absent the user has not authenticated through the gateway and must log in.
  const gateway = getGatewayAuthCookie();
  if (!gateway) {
    clearStoredSession();
    return null;
  }

  // Admin gateway users get a synthetic local session — no backend round-trip needed.
  if (gateway.userType === "admin") {
    const existing = getStoredSession();
    if (existing?.role === "admin" && existing.username === gateway.username) return existing;
    const now = new Date().toISOString();
    const session: SessionInfo = {
      session_token: `gw-admin-${gateway.username}`,
      username: gateway.username,
      user_id: `admin-${gateway.username}`,
      display_name: gateway.username,
      role: "admin",
      created_at: now,
      updated_at: now,
      expires_at: new Date(gateway.exp).toISOString(),
      last_seen_at: now,
    };
    setStoredSession(session);
    return session;
  }

  // Helper: synthesize a local session from the gateway cookie so the user
  // can access the app even when the backend is temporarily unreachable.
  function gatewayFallbackSession(): SessionInfo {
    const now = new Date().toISOString();
    const s: SessionInfo = {
      session_token: `gw-${gateway.username}`,
      username: gateway.username,
      user_id: `market-${gateway.username}`,
      display_name: gateway.username,
      role: "user",
      created_at: now,
      updated_at: now,
      expires_at: new Date(gateway.exp).toISOString(),
      last_seen_at: now,
    };
    setStoredSession(s);
    return s;
  }

  try {
    const response = await apiFetch("/api/v1/auth/me", { timeoutMs: 5000 });
    if (response.status === 401) {
      // Gateway authenticated but backend session not yet established — sync now.
      clearStoredSession();
      const syncRes = await apiFetch("/api/v1/auth/gateway-sync", {
        method: "POST",
        timeoutMs: 5000,
      });
      if (!syncRes.ok) return gatewayFallbackSession();
      const syncData = await syncRes.json();
      const session = (syncData?.session ?? null) as SessionInfo | null;
      if (!session) return gatewayFallbackSession();
      setStoredSession(session);
      return session;
    }
    if (!response.ok) return gatewayFallbackSession();
    const data = await response.json();
    const session = (data?.session ?? null) as SessionInfo | null;
    if (!session) return gatewayFallbackSession();
    setStoredSession(session);
    return session;
  } catch {
    return gatewayFallbackSession();
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
  try {
    await apiFetch("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearStoredSession();
    if (typeof document !== "undefined") {
      document.cookie = "freda_auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
      document.cookie = "freda_gateway_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    }
    if (typeof window !== "undefined") {
      window.location.href = "/auth/logout";
    }
  }
}
