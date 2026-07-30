import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Shield, UserRound, LogIn, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button, Card, Input, Select } from "@/components/ui-bits";
import { clearStoredSession, fetchSession, loginRequest, setStoredSession, signupRequest } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  head: () => ({ meta: [{ title: "Login - FreshData AI" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [role, setRole] = useState<"user" | "admin">("user");
  const [username, setUsername] = useState("user");
  const [password, setPassword] = useState("REDACTED_USER_PASS");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      const session = await fetchSession();
      if (!active) return;
      if (session) {
        navigate({ to: session.role === "admin" ? "/admin" : "/", replace: true });
        return;
      }
      setChecking(false);
    }
    void checkSession();
    return () => {
      active = false;
    };
  }, [navigate]);

  const hint = useMemo(() => {
    if (mode === "signup") return "Create a new user account.\nUse your own username and password.";
    if (role === "admin") return "Demo Credentials\nUsername: admin\nPassword: REDACTED_ADMIN_PASS";
    return "Demo Credentials\nUsername: user\nPassword: REDACTED_USER_PASS";
  }, [mode, role]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    try {
      const cleanedUsername = username.trim();
      const cleanedPassword = password;
      const result =
        mode === "signup"
          ? await signupRequest(cleanedUsername, cleanedPassword, cleanedUsername)
          : await loginRequest(cleanedUsername, cleanedPassword, role);
      setStoredSession(result.session);
      const target = next || (result.session.role === "admin" ? "/admin" : "/");
      window.location.assign(target);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking session...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-3 rounded-full border border-info/20 bg-info-bg px-4 py-2 text-sm text-foreground">
            <Shield className="h-4 w-4" />
            FreshData
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight">Welcome to FreshData</h1>
            <p className="max-w-xl text-sm text-muted-foreground leading-6">
              Select your role and sign in to continue.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-info-bg border border-info/20 flex items-center justify-center">
                  <UserRound className="h-5 w-5 text-info" />
                </div>
                <div>
                  <div className="text-sm font-semibold">User</div>
                  <div className="text-xs text-muted-foreground">Access data enrichment workflows, monitoring, and exports.</div>
                </div>
              </div>
            </Card>
            <Card className="border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-info-bg border border-info/20 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Administrator</div>
                  <div className="text-xs text-muted-foreground">Access the admin console to review requests, onboard sources, and manage workflows.</div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        <Card className="border-border bg-card p-6 shadow-sm">
          <div className="mb-6">
            <div className="text-lg font-semibold">{mode === "signup" ? "Sign Up" : "Sign In"}</div>
            <div className="text-sm text-muted-foreground">
              {mode === "signup"
                ? "Create a new account to keep jobs separate for each user."
                : "Enter your credentials to continue."}
            </div>
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            {mode === "signin" && (
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Account Type</label>
                <Select value={role} onChange={(e) => {
                  const nextRole = e.target.value as "user" | "admin";
                  setRole(nextRole);
                  setUsername(nextRole === "admin" ? "admin" : "user");
                  setPassword(nextRole === "admin" ? "REDACTED_ADMIN_PASS" : "REDACTED_USER_PASS");
                }} className="h-11 bg-background border-input text-foreground">
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Username</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 bg-background border-input text-foreground placeholder:text-muted-foreground"
                placeholder="Username"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 bg-background border-input text-foreground placeholder:text-muted-foreground"
                placeholder="Password"
              />
            </div>

            <div className="rounded-xl border border-info/20 bg-info-bg px-4 py-3 text-xs text-info whitespace-pre-line">
              {hint}
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {loading ? (mode === "signup" ? "Creating account..." : "Signing in...") : mode === "signup" ? "Create Account" : "Sign In"}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full"
              onClick={() => {
                setMode((prev) => (prev === "signin" ? "signup" : "signin"));
                clearStoredSession();
                setRole("user");
                setUsername("user");
                setPassword("REDACTED_USER_PASS");
              }}
            >
              <UserPlus className="h-4 w-4" />
              {mode === "signin" ? "Create an account" : "Back to sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
