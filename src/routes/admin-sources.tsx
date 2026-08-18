import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Boxes, CheckCircle2, Clock, Database, ExternalLink, Globe, Hammer, Search, Ticket, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle } from "@/components/ui-bits";
import { CUSTOMERS, fmt, requestsFor } from "@/data/customers";
import { setTicketStatus, useTickets, type Ticket as TicketRow, type TicketStatus } from "@/lib/ticket-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-sources")({
  head: () => ({
    meta: [
      { title: "Sources & tickets — FreDA admin" },
      { name: "description", content: "Admin view of every source agent across all workspaces plus the tickets and build requests raised by customers." },
      { property: "og:title", content: "Sources & tickets — FreDA admin" },
      { property: "og:description", content: "Every source across all workspaces and every customer ticket in one console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminSourcesPage,
});

const STATUS_TONE: Record<TicketStatus, "info" | "warning" | "success" | "purple" | "destructive"> = {
  Estimating: "info",
  "Awaiting admin approval": "warning",
  Approved: "success",
  "In build": "purple",
  Delivered: "success",
  Rejected: "destructive",
};

function AdminSourcesPage() {
  const [tab, setTab] = useState<"sources" | "tickets">("sources");
  const [q, setQ] = useState("");
  const [workspace, setWorkspace] = useState<"all" | string>("all");
  const live = useTickets();

  const seeded: TicketRow[] = useMemo(
    () =>
      CUSTOMERS.flatMap((c) =>
        requestsFor(c).map((r) => ({
          id: r.id,
          workspaceId: c.id,
          workspaceName: c.name,
          project: r.project,
          type: r.type,
          detail: r.detail,
          raisedBy: c.accountManager,
          createdAt: r.submitted,
          status: r.status as TicketStatus,
          estimateDays: r.estimateDays,
          sources: [],
          datapoints: [],
        })),
      ),
    [],
  );

  const tickets = [...live, ...seeded].filter(
    (t) => (workspace === "all" || t.workspaceId === workspace) && (!q.trim() || `${t.id} ${t.detail} ${t.project} ${t.workspaceName}`.toLowerCase().includes(q.toLowerCase())),
  );

  const sources = CUSTOMERS.filter((c) => workspace === "all" || c.id === workspace)
    .flatMap((c) => c.projects.flatMap((p) => p.sources.map((s) => ({ ...s, project: p, customer: c }))))
    .filter((s) => !q.trim() || `${s.label} ${s.url} ${s.project.name} ${s.customer.name}`.toLowerCase().includes(q.toLowerCase()));

  const open = tickets.filter((t) => t.status === "Awaiting admin approval" || t.status === "Estimating").length;

  return (
    <AdminLayout>
      <PageHeader
        title="Sources & tickets"
        subtitle={`${sources.length} source agents across ${CUSTOMERS.length} workspaces · ${open} tickets awaiting action`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant={tab === "sources" ? "primary" : "outline"} onClick={() => setTab("sources")}>
              <Database className="h-3.5 w-3.5" /> All sources
            </Button>
            <Button size="sm" variant={tab === "tickets" ? "primary" : "outline"} onClick={() => setTab("tickets")}>
              <Ticket className="h-3.5 w-3.5" /> Tickets ({tickets.length})
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[300px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder={tab === "sources" ? "Search sources…" : "Search tickets…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button
            onClick={() => setWorkspace("all")}
            className={cn(
              "h-8 px-3 rounded-md border text-[11.5px] font-medium transition",
              workspace === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
            )}
          >
            All workspaces
          </button>
          {CUSTOMERS.map((c) => (
            <button
              key={c.id}
              onClick={() => setWorkspace(c.id)}
              className={cn(
                "h-8 px-3 rounded-md border text-[11.5px] font-medium transition",
                workspace === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {c.shortName}
            </button>
          ))}
        </div>

        {tab === "sources" ? (
          <Card className="p-5">
            <SectionTitle hint={`${sources.length} agents`}>All source agents</SectionTitle>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="text-left font-semibold py-2">Source</th>
                    <th className="text-left font-semibold py-2">Workspace</th>
                    <th className="text-left font-semibold py-2">Project</th>
                    <th className="text-center font-semibold py-2">Status</th>
                    <th className="text-right font-semibold py-2">Records</th>
                    <th className="text-right font-semibold py-2">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={`${s.customer.id}-${s.id}`} className="border-b border-border/60">
                      <td className="py-2.5 pr-3">
                        <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-medium hover:text-primary transition">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[240px]">{s.label}</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{s.customer.shortName}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground truncate max-w-[220px]">{s.project.name}</td>
                      <td className="py-2.5 text-center">
                        <Badge tone={s.status === "Live" ? "success" : s.status === "Paused" ? "warning" : "info"}>{s.status}</Badge>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{fmt(s.records)}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{s.addedOn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <SectionTitle hint={`${open} awaiting action`}>Tickets raised by customers</SectionTitle>
            <div className="mt-2 grid lg:grid-cols-2 gap-3 items-stretch">
              {tickets.map((t) => (
                <div key={`${t.workspaceId}-${t.id}`} className="rounded-lg border border-border p-3.5 flex flex-col">
                  <div className="flex items-start gap-2">
                    <span className="h-8 w-8 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                      <Boxes className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-snug">{t.detail}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono">{t.id}</span>
                        <span>· {t.workspaceName}</span>
                        <span>· {t.project}</span>
                        <span>· raised by {t.raisedBy}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {t.estimateDays} day estimate
                        </span>
                      </div>
                      {t.sources.length > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-1 truncate">Sources: {t.sources.slice(0, 3).join(", ")}{t.sources.length > 3 ? ` +${t.sources.length - 3}` : ""}</div>
                      )}
                      {t.datapoints.length > 0 && (
                        <div className="text-[11px] text-muted-foreground truncate">Datapoints: {t.datapoints.slice(0, 5).join(", ")}{t.datapoints.length > 5 ? ` +${t.datapoints.length - 5}` : ""}</div>
                      )}
                    </div>
                    <Badge tone={STATUS_TONE[t.status]} className="whitespace-nowrap">
                      {t.status}
                    </Badge>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={!live.some((x) => x.id === t.id)} onClick={() => setTicketStatus(t.id, "Approved")}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={!live.some((x) => x.id === t.id)} onClick={() => setTicketStatus(t.id, "In build")}>
                      <Hammer className="h-3.5 w-3.5" /> Start build
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!live.some((x) => x.id === t.id)} onClick={() => setTicketStatus(t.id, "Rejected")}>
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
