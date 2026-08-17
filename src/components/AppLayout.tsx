import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ReactNode, useState, useEffect } from "react";
import {
  LayoutDashboard,
  Activity,
  Upload,
  Bell,
  HelpCircle,
  MessageSquare,
  PanelLeft,
  ChevronsUpDown,
  Sun,
  Moon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchSession, logoutRequest, type SessionInfo } from "@/lib/auth";
import { CUSTOMERS } from "@/data/customers";
import { setActiveCustomer, useActiveCustomer } from "@/lib/workspace";
import fredaLogo from "@/assets/freda-mobius-bold.png";

type NavItem = { to: string; label: string; icon: typeof Activity; hash?: string };
type NavGroup = { group: string; items: NavItem[] };

const WORKSPACE: NavGroup = {
  group: "WORKSPACE",
  items: [
    { to: "/", label: "Dashboard & Review", icon: LayoutDashboard },
    { to: "/monitoring", label: "Monitoring & Refresh", icon: Activity },
    { to: "/export", label: "Export & Sync", icon: Upload },
  ],
};

const ASSIST: NavGroup = {
  group: "ASSISTANT",
  items: [{ to: "/ask-freda", label: "Ask FreDA", icon: MessageSquare }],
};


export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const customer = useActiveCustomer();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; detail: string; tone: string }>>([]);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  const baseApiUrl = (() => {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port !== "8131"
    ) {
      return `http://${window.location.hostname}:8131`;
    }
    return "";
  })();




  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved === "dark") {
        setTheme("dark");
        document.documentElement.classList.add("dark");
      }
      const collapsed = localStorage.getItem("sidebar-collapsed") === "true";
      if (collapsed) {
        setIsCollapsed(true);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      const session = await fetchSession();
      if (!active) return;
      if (session === null) {
        navigate({ to: "/login", search: { next: pathname }, replace: true });
        return;
      }
      if (session) {
        setSession(session);
        if (session.role === "admin") {
          navigate({ to: "/admin", replace: true });
          return;
        }
      }
    }
    void checkSession();
    return () => {
      active = false;
    };
  }, [navigate]);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", nextTheme);
  };

  const toggleSidebar = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  async function handleLogout() {
    try {
      await logoutRequest();
      window.location.replace("/login");
    } finally {
      // Hard redirect keeps stale router/session state from bouncing back into the app.
    }
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`Failed to load notifications (${response.status})`);
      }
      const data = await response.json();
      const sorted = [...(Array.isArray(data) ? data : [])].sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
      });
      const nextItems = sorted.slice(0, 5).map((job: any) => {
        const status = String(job.status || "Unknown");
        const title = `${job.source || "Job"} · ${status}`;
        const detail = job.last_refresh
          ? `Updated ${formatRelativeTime(job.last_refresh)}`
          : job.created_at
            ? `Created ${formatRelativeTime(job.created_at)}`
            : "Recent activity";
        return {
          id: String(job.id || `${title}-${detail}`),
          title,
          detail,
          tone: notificationTone(status),
        };
      });
      setNotifications(nextItems);
    } catch (err) {
      setNotifications([]);
      setNotificationsError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setNotificationsLoading(false);
    }
  }

  const groups: NavGroup[] = [WORKSPACE, ASSIST];


  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside
        className={[
          "shrink-0 h-full bg-navy text-navy-foreground flex flex-col transition-all duration-300 ease-in-out",
          isCollapsed ? "w-0 overflow-hidden" : "w-[230px]"
        ].join(" ")}
      >
        <div className="px-4 pt-4 pb-3 border-b border-white/10 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className="h-9 w-9 shrink-0 inline-flex items-center justify-center">
              <img src={fredaLogo} alt="Freda" width={512} height={512} className="h-9 w-9 object-contain" />
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-tight">Freda</div>
              <div className="text-[11px] text-white/60">B2B Data Intelligence</div>
            </div>
          </div>
        </div>

        {uc && (
          <div className="px-3 py-3 border-b border-white/10 whitespace-nowrap">
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1">Active playbook</div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-[12px]">
                {uc === "targeted" ? <Target className="h-3.5 w-3.5" /> : <Globe2 className="h-3.5 w-3.5" />}
                <span>{USE_CASES[uc].short}</span>
              </div>
              <button
                onClick={() => setUseCase(null)}
                title="Switch playbook"
                className="inline-flex items-center gap-1 text-[10px] text-white/60 hover:text-white"
              >
                <RefreshCw className="h-3 w-3" /> switch
              </button>
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {groups.map((g) => (
            <div key={g.group} className="whitespace-nowrap">
              <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-white/40 font-semibold">{g.group}</div>
              <ul className="space-y-0.5">
                {g.items.map((n) => {
                  const isPath = pathname === n.to || (n.to !== "/" && pathname.startsWith(n.to));
                  const wantsHash = !!n.hash;
                  const currentHash = (hash || "").replace(/^#/, "");
                  const active = wantsHash
                    ? isPath && currentHash === n.hash
                    : isPath && (!sameRouteHasHashSibling(g, n) || !currentHash);
                  const Icon = n.icon;
                  return (
                    <li key={n.label}>
                      <Link
                        to={n.to}
                        hash={n.hash}
                        className={[
                          "flex items-center gap-2.5 px-3 py-2 text-[13px] transition border-l-2",
                          active
                            ? "bg-primary text-primary-foreground border-transparent rounded-md dark:bg-card dark:text-foreground dark:border-primary dark:rounded-l-none"
                            : "text-white/80 hover:bg-white/8 hover:text-white border-transparent rounded-md dark:text-muted-foreground dark:hover:bg-card/40 dark:hover:text-foreground",
                        ].join(" ")}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{n.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10 text-[11px] text-white/50 whitespace-nowrap">v2.1 · enterprise</div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-border bg-card px-5 flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            suppressHydrationWarning
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition"
          >
            <PanelLeft className="h-4.5 w-4.5" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  suppressHydrationWarning
                  aria-label="Help"
                  title="Help"
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4">
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Quick help</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Common actions for the current workspace.
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <div className="font-medium text-foreground">Solutions</div>
                      <div className="text-muted-foreground text-xs">
                        Upload data, map fields, launch jobs, then review and save results.
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Agents</div>
                      <div className="text-muted-foreground text-xs">
                        Choose a source, run a scrape, and inspect the records in Review.
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Monitoring</div>
                      <div className="text-muted-foreground text-xs">
                        Track running, failed, and completed jobs from the latest run at the top.
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Popover
              open={notificationsOpen}
              onOpenChange={(open) => {
                setNotificationsOpen(open);
                if (open && !notificationsLoading) {
                  void loadNotifications();
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  suppressHydrationWarning
                  aria-label="Notifications"
                  title="Notifications"
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition"
                >
                  <Bell className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 overflow-hidden">
                <div className="border-b border-border px-4 py-3">
                  <div className="text-sm font-semibold text-foreground">Recent activity</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Latest job updates from Monitoring and Review.
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notificationsLoading ? (
                    <div className="px-4 py-4 text-sm text-muted-foreground">Loading notifications…</div>
                  ) : notificationsError ? (
                    <div className="px-4 py-4 text-sm text-destructive">{notificationsError}</div>
                  ) : notifications.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-muted-foreground">No recent notifications.</div>
                  ) : (
                    <div className="py-1">
                      {notifications.map((item) => (
                        <div key={item.id} className="px-4 py-3 hover:bg-secondary/50">
                          <div className="flex items-start gap-2">
                            <span className={["mt-1 h-2 w-2 rounded-full shrink-0", notificationDotClass(item.tone)].join(" ")} />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground truncate">{item.title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{item.detail}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <button
              onClick={toggleTheme}
              suppressHydrationWarning
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition"
            >
              {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  suppressHydrationWarning
                  aria-label="Account"
                  title="Account"
                  className="h-8 w-8 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center text-[12px] font-semibold hover:opacity-90 transition"
                >
                  {getAccountInitials(session)}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <div className="text-sm font-semibold text-foreground">
                    {session?.display_name || "User"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {session?.username || "user"}
                  </div>
                  <div className="mt-2 inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {session?.role || "user"}
                  </div>
                </div>
                <div className="p-2">
                  <button
                    onClick={() => void handleLogout()}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-secondary transition"
                  >
                    Log out
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function sameRouteHasHashSibling(g: NavGroup, n: NavItem) {
  return g.items.some((i) => i.to === n.to && i.label !== n.label && i.hash);
}

function getAccountInitials(session: SessionInfo | null) {
  const source = (session?.display_name || session?.username || "").trim();
  if (!source) return "U";
  const parts = source
    .replace(/[^A-Za-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  if (source.length >= 2) {
    return source.slice(0, 2).toUpperCase();
  }
  return source[0].toUpperCase();
}

function formatRelativeTime(isoStr: string) {
  if (!isoStr) return "just now";
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(isoStr).toLocaleDateString();
}

function notificationTone(status: string) {
  if (status === "Running") return "info";
  if (status === "Review" || status === "Review Pending") return "warning";
  if (status === "Completed" || status === "Execution Completed") return "success";
  if (status === "Failed") return "destructive";
  return "muted";
}

function notificationDotClass(tone: string) {
  if (tone === "info") return "bg-sky-500";
  if (tone === "warning") return "bg-amber-500";
  if (tone === "success") return "bg-emerald-500";
  if (tone === "destructive") return "bg-rose-500";
  return "bg-muted-foreground";
}
