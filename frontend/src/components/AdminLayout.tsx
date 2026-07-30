import { Link, useNavigate } from "@tanstack/react-router";
import { ReactNode, useEffect, useState } from "react";
import { LogOut, Shield, Users, Activity, RefreshCw } from "lucide-react";

import { Badge, Button } from "@/components/ui-bits";
import { fetchSession, logoutRequest, type SessionInfo } from "@/lib/auth";

type AdminNavItem = { to: string; label: string; icon: typeof Users };

const NAV_ITEMS: AdminNavItem[] = [
  { to: "/admin", label: "Requests", icon: Users },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const current = await fetchSession();
      if (!active) return;
      if (current === null) {
        navigate({ to: "/login", search: { next: "/admin" } });
        return;
      }
      if (current) {
        if (current.role !== "admin") {
          navigate({ to: "/", replace: true });
          return;
        }
        setSession(current);
        setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [navigate]);

  const onLogout = async () => {
    setSigningOut(true);
    try {
      await logoutRequest();
      window.location.replace("/login");
    } finally {
      setSigningOut(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading admin console...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-72 shrink-0 border-r border-border bg-card px-5 py-6 flex flex-col">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-info-bg border border-info/20 flex items-center justify-center">
            <Shield className="h-5 w-5 text-info" />
          </div>
          <div>
            <div className="text-lg font-semibold">Admin Console</div>
            <div className="text-xs text-muted-foreground">Request oversight and audit trail</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-info/20 bg-info-bg p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Signed in as</div>
          <div className="mt-2 text-sm font-semibold">{session?.display_name || session?.username}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="info">{session?.role}</Badge>
            <span>{session?.username}</span>
          </div>
        </div>

        <nav className="mt-6 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-foreground hover:bg-info-bg"
              >
                <Icon className="h-4 w-4 text-info" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-6">
          <Button
            variant="outline"
            className="w-full"
            onClick={onLogout}
            disabled={signingOut}
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Signing out..." : "Sign out"}
          </Button>
          <div className="mt-4 text-xs text-muted-foreground">
            Monitoring and review links remain in the consumer app. This console is read-first with workflow traceability.
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Workflow Requests</div>
            <div className="text-xs text-muted-foreground">By Source and By Dataset request visibility</div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Activity className="h-4 w-4 text-info" />
            Live polling enabled
          </div>
        </header>
        <main className="bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
