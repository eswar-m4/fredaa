import { Link, useRouterState } from "@tanstack/react-router";
import { ReactNode, useState, useEffect } from "react";
import {
  LayoutDashboard,
  Target,
  Globe2,
  Library,
  Workflow as WorkflowIcon,
  Activity,
  CheckSquare,
  Upload,
  Bell,
  Search,
  HelpCircle,
  GitBranch,
  RefreshCw,
  Menu,
  Sun,
  Moon,
} from "lucide-react";
import { setUseCase, useUseCase, USE_CASES } from "@/lib/useCase";

type NavItem = { to: string; label: string; icon: typeof Target; hash?: string };
type NavGroup = { group: string; items: NavItem[] };

const BASE: NavGroup = {
  group: "Overview",
  items: [{ to: "/", label: "Use Cases", icon: LayoutDashboard }],
};

const TARGETED: NavGroup = {
  group: "Site Specific",
  items: [
    { to: "/site-specific", label: "Sources & Agents", icon: Library },
  ],
};



const OPENWEB: NavGroup = {
  group: "Any Site",
  items: [
    { to: "/any-site", label: "Field Mapping", icon: GitBranch },
    { to: "/workflows", label: "Workflows", icon: WorkflowIcon },
    { to: "/review", label: "Review", icon: CheckSquare },
  ],
};

const OPERATE: NavGroup = {
  group: "Operate",
  items: [
    { to: "/monitoring", label: "Monitoring", icon: Activity },
    { to: "/export", label: "Export & Sync", icon: Upload },
  ],
};

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const uc = useUseCase();

  const [isCollapsed, setIsCollapsed] = useState(false);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

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

  const groups: NavGroup[] = [BASE];
  if (uc === "targeted") groups.push(TARGETED);
  if (uc === "openweb") groups.push(OPENWEB);
  if (uc) groups.push(OPERATE);

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
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center font-bold">F</div>
            <div>
              <div className="text-[15px] font-semibold leading-tight">FreshData AI</div>
              <div className="text-[11px] text-white/60">B2B Data Intelligence</div>
            </div>
          </div>
        </div>

        {uc && (
          <div className="px-3 py-3 border-b border-white/10 whitespace-nowrap">
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1">Active use case</div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-[12px]">
                {uc === "targeted" ? <Target className="h-3.5 w-3.5" /> : <Globe2 className="h-3.5 w-3.5" />}
                <span>{USE_CASES[uc].short}</span>
              </div>
              <button
                onClick={() => setUseCase(null)}
                title="Switch use case"
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
                          "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-white/80 hover:bg-white/8 hover:text-white",
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
            <Menu className="h-4 w-4" />
          </button>
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              suppressHydrationWarning
              placeholder="Search sources, workflows, attributes…"
              className="w-full h-9 pl-9 pr-3 rounded-md bg-secondary text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <button suppressHydrationWarning className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground">
            <HelpCircle className="h-4 w-4" />
          </button>
          <button suppressHydrationWarning className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground">
            <Bell className="h-4 w-4" />
          </button>
          <button
            onClick={toggleTheme}
            suppressHydrationWarning
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition"
          >
            {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center text-[12px] font-semibold">
            JD
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
