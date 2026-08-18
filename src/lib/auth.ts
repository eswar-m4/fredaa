// Demo authentication for the FreDA prototype.
// No backend is wired to this build, so sessions live in the browser.

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
const ACCOUNTS_STORAGE_KEY = "freda.auth.accounts.v1";

type StoredAccount = { username: string; password: string; role: "user" | "admin"; display_name: string };

function readAccounts(): StoredAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: StoredAccount[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // ignore
  }
}

function makeSession(account: StoredAccount): SessionInfo {
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 12);
  return {
    session_token: `demo-${Math.random().toString(36).slice(2)}`,
    username: account.username,
    user_id: `u_${account.username.toLowerCase()}`,
    display_name: account.display_name || account.username,
    role: account.role,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expires.toISOString(),
    last_seen_at: now.toISOString(),
  };
}

export function getStoredSession(): SessionInfo | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionInfo;
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
    // ignore
  }
}

export function clearStoredSession() {
  setStoredSession(null);
}

export async function fetchSession(): Promise<SessionInfo | null> {
  const session = getStoredSession();
  if (!session) return null;
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    clearStoredSession();
    return null;
  }
  return session;
}

export async function loginRequest(username: string, password: string, role: "user" | "admin") {
  const name = username.trim();
  if (!name) throw new Error("Enter a username");
  if (!password) throw new Error("Enter a password");

  const accounts = readAccounts();
  const existing = accounts.find((a) => a.username.toLowerCase() === name.toLowerCase());

  if (existing) {
    if (existing.password !== password) throw new Error("Incorrect password");
    const account = { ...existing, role };
    writeAccounts(accounts.map((a) => (a.username === existing.username ? account : a)));
    const session = makeSession(account);
    setStoredSession(session);
    return { success: true, session };
  }

  const account: StoredAccount = { username: name, password, role, display_name: name };
  writeAccounts([...accounts, account]);
  const session = makeSession(account);
  setStoredSession(session);
  return { success: true, session };
}

export async function signupRequest(username: string, password: string, displayName?: string) {
  const name = username.trim();
  if (!name) throw new Error("Enter a username");
  if (password.length < 4) throw new Error("Password must be at least 4 characters");

  const accounts = readAccounts();
  if (accounts.some((a) => a.username.toLowerCase() === name.toLowerCase())) {
    throw new Error("That username already exists — sign in instead");
  }
  const account: StoredAccount = { username: name, password, role: "user", display_name: displayName || name };
  writeAccounts([...accounts, account]);
  const session = makeSession(account);
  setStoredSession(session);
  return { success: true, session };
}

export async function logoutRequest() {
  clearStoredSession();
}
