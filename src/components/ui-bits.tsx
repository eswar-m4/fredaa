import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("bg-card border border-border rounded-lg shadow-[0_1px_3px_rgba(15,27,46,0.05)]", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

type BadgeTone = "info" | "success" | "warning" | "destructive" | "neutral" | "purple";
const tones: Record<BadgeTone, string> = {
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  destructive: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-secondary-foreground",
  purple: "bg-purple-bg text-purple-token",
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-8 px-3 text-[12px]",
    md: "h-9 px-4 text-[13px]",
    lg: "h-11 px-5 text-[14px]",
  };
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
    ghost: "text-foreground hover:bg-secondary",
    outline: "border border-border bg-card hover:bg-secondary",
  };
  return (
    <button
      suppressHydrationWarning
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        sizes[size],
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      suppressHydrationWarning
      {...props}
      className={cn(
        "h-9 w-full px-3 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground",
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      suppressHydrationWarning
      {...props}
      className={cn(
        "h-9 w-full px-2.5 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40",
        props.className,
      )}
    />
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="w-full flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const isLast = i === steps.length - 1;
        return (
          <li key={s} className={cn("flex flex-col md:flex-row md:items-center gap-3", !isLast && "md:flex-1")}>
            <div className="flex items-center gap-2 shrink-0">
              <div
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
                  done && "bg-success text-white",
                  active && "bg-primary text-primary-foreground",
                  !done && !active && "bg-secondary text-muted-foreground",
                )}
              >
                {done ? "✓" : i + 1}
              </div>
              <span className={cn("text-[12px] whitespace-nowrap", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {s}
              </span>
            </div>
            {!isLast && (
              <div className="flex md:flex-1 items-center min-w-[16px] h-4 md:h-auto pl-[11px] md:pl-0">
                <div className="w-[1.5px] h-full md:w-auto md:h-[1.5px] md:flex-1 bg-border" />
                <span className="hidden md:inline text-muted-foreground text-[10px] ml-1 select-none">→</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
