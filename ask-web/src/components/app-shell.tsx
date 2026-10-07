"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LayoutGrid, Menu, Radio, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Ask Freda", icon: Sparkles },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/solutions", label: "Solutions", icon: LayoutGrid },
  { href: "/monitoring", label: "Monitoring", icon: Radio },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-white/12 text-white"
                : "text-white/70 hover:bg-white/8 hover:text-white",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 pt-6 pb-4">
          <p className="text-[11px] font-medium tracking-[0.18em] text-sidebar-foreground/55 uppercase">
            F.R.E.D.A.
          </p>
          <p className="font-heading mt-1 text-xl text-white">Ask Freda</p>
          <p className="mt-1 text-xs leading-5 text-white/55">
            Needs-first consultant for Agents and Solutions
          </p>
        </div>
        <div className="px-3">
          <NavLinks />
        </div>
        <p className="mt-auto px-5 py-4 text-[11px] leading-4 text-white/40">
          Reuse first. Extend second. Create new third.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <details className="relative">
            <summary className="inline-flex size-8 list-none items-center justify-center rounded-lg hover:bg-muted [&::-webkit-details-marker]:hidden">
              <Menu className="size-4" />
              <span className="sr-only">Open menu</span>
            </summary>
            <div className="absolute top-10 left-0 z-50 w-64 rounded-xl border bg-sidebar p-3 text-sidebar-foreground shadow-lg">
              <p className="px-3 pb-2 text-xs tracking-wide text-white/55 uppercase">F.R.E.D.A.</p>
              <NavLinks />
            </div>
          </details>
          <div>
            <p className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              F.R.E.D.A.
            </p>
            <p className="font-heading text-base leading-none">Ask Freda</p>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
