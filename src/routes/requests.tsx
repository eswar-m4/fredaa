import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Clock, Info, Search, Ticket } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Card, Input, PageHeader, SectionTitle } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { requestsFor } from "@/data/customers";
import { useTickets, type TicketStatus } from "@/lib/ticket-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: "Request tracker — FreDA" },
      { name: "description", content: "Every source addition, retirement, schedule change and new build you raised, with its REQ number, estimate and admin status." },
      { property: "og:title", content: "Request tracker — FreDA" },
      { property: "og:description", content: "Track every request you raised with FreDA and where it sits in the build queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RequestsPage,
});

const TONE: Record<string, "info" | "warning" | "success" | "purple" | "destructive" | "neutral"> = {
  Estimating: "info",
  "Awaiting admin approval": "warning",
  Approved: "success",
  "In build": "purple",
  Delivered: "success",
  Rejected: "destructive",
};

function RequestsPage() {
  const customer = useActiveCustomer();
  const live = useTickets().filter((t) => t.workspaceId === customer.id);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | TicketStatus>("all");

  const rows = useMemo(() => {
    const seeded = requestsFor(customer).map((r) => ({
      id: r.id,
      project: r.project,
      type: r.type,
      detail: r.detail,
      createdAt: r.submitted,
      status: r.status as TicketStatus,
      estimateDays: r.estimateDays,
      adminNote: undefined as string | undefined,
      frequency: undefined as string | undefined,
    }));
    const mine = live.map((t) => ({
      id: t.id,
      project: t.project,
      type: t.type,
      detail: t.detail,
      createdAt: "Just now",
      status: t.status,
      estimateDays: t.estimateDays,
      adminNote: t.adminNote,
      frequency: t.frequency,
    }));
    return [...mine, ...seeded].filter(
      (r) => (status === "all" || r.status === status) && (!q.trim() || `${r.id} ${r.detail} ${r.project}`.toLowerCase().includes(q.toLowerCase())),
    );
  }, [live, customer, q, status]);

  const open = rows.filter((r) => r.status === "Awaiting admin approval" || r.status === "Estimating").length;

  return (
    <AppLayout>
      <PageHeader
        title="Request tracker"
        subtitle={`${customer.name} · ${rows.length} requests · ${open} waiting on your FreDA admin`}
      />

      <div className="px-7 pb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[300px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search requests…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {(["all", "Estimating", "Awaiting admin approval", "Approved", "In build", "Delivered", "Rejected"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "h-8 px-3 rounded-md border text-[11.5px] font-medium transition",
                status === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>

        <Card className="p-5">
          <SectionTitle hint="add · retire · reschedule · new build">Requests raised by your workspace</SectionTitle>
          <p className="text-[11.5px] text-muted-foreground -mt-1 mb-3 inline-flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-[1px] shrink-0" />
            Each request gets a sequential REQ number the moment you raise it. Your FreDA admin approves, estimates and builds against that number — the status here
            updates as they work it.
          </p>

          <div className="grid lg:grid-cols-2 gap-3 items-stretch">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3.5 flex flex-col">
                <div className="flex items-start gap-2">
                  <span className="h-8 w-8 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                    <Ticket className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-snug">{r.detail}</div>
                    <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono">{r.id}</span>
                      <span>· {r.project}</span>
                      <span>· {r.type}</span>
                      <span>· submitted {r.createdAt}</span>
                      {r.frequency && <span>· {r.frequency}</span>}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {r.estimateDays} day estimate
                      </span>
                    </div>
                    {r.adminNote && <div className="text-[11.5px] text-foreground mt-1.5 rounded-md bg-secondary/50 px-2 py-1">Admin: {r.adminNote}</div>}
                  </div>
                  <Badge tone={TONE[r.status] ?? "neutral"} className="whitespace-nowrap">
                    {r.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
