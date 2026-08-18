import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { UserRound, LogIn, Loader2, UserPlus, Radar, Database, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import fredaLogo from "@/assets/freda-mobius-bold.png";
import { Button, Card, Input, Select } from "@/components/ui-bits";
import { clearStoredSession, fetchSession, loginRequest, setStoredSession, signupRequest } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  head: () => ({ meta: [{ title: "Login - Freda" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [role, setRole] = useState<"user" | "admin">("user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    if (mode === "signup") return "Create a new account with your own username and password.";
    if (role === "admin") return "Administrator access — all workspaces, sources and tickets.";
    return "Workspace access — your projects, review, monitoring and playbooks.";
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
          <div className="flex items-center gap-4">
            <img src={fredaLogo} alt="Freda logo" className="h-14 w-14 object-contain" />
            <h1 className="text-5xl font-bold tracking-tight text-foreground">FreDA</h1>
          </div>

          <p className="max-w-lg text-lg font-medium text-muted-foreground leading-relaxed">
            Data, sourced and verified — kept fresh on a schedule you control.
          </p>


          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: Radar, title: "Source", copy: "Agents mapped to the sites and directories you trust." },
              { icon: Database, title: "Extract", copy: "The exact datapoints you need — structured and deduplicated." },
              { icon: CheckCircle2, title: "Validate", copy: "ADMV change scoring with human-in-the-loop review." },
              { icon: RefreshCw, title: "Refresh", copy: "Scheduled reruns that keep your dataset current." },
            ].map((s) => (
              <Card key={s.title} className="border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-info-bg border border-info/20 flex items-center justify-center">
                    <s.icon className="h-4 w-4 text-info" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{s.title}</div>
                    <div className="text-xs text-muted-foreground leading-5 mt-0.5">{s.copy}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-info-bg border border-info/20 flex items-center justify-center">
                  <UserRound className="h-5 w-5 text-info" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Workspace user</div>
                  <div className="text-xs text-muted-foreground">Dashboard, review, monitoring and playbooks.</div>
                </div>
              </div>
            </Card>
            <Card className="border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Database className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Administrator</div>
                  <div className="text-xs text-muted-foreground">All sources across workspaces, tickets and access control.</div>
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
                  setUsername("");
                  setPassword("");
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
                setUsername("");
                setPassword("");
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
