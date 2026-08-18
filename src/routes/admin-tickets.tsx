import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Clock, Hammer, PackageCheck, Search, Ticket as TicketIcon, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle } from "@/components/ui-bits";
import { CUSTOMERS } from "@/data/customers";
import { setTicketNote, setTicketStatus, useTickets, type TicketStatus } from "@/lib/ticket-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-tickets")({
  head: () => ({
    meta: [
      { title: "Ticket queue — FreDA admin" },
      { name: "description", content: "Every request raised by workspace users — approve, estimate, start the build, mark delivered or reject with a note." },
      { property: "og:title", content: "Ticket queue — FreDA admin" },
      { property: "og:description", content: "Approve, build and deliver customer requests from a single admin queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminTicketsPage,
});

const TONE: Record<TicketStatus, "info" | "warning" | "success" | "purple" | "destructive"> = {
  Estimating: "info",
  "Awaiting admin approval": "warning",
  Approved: "success",
  "In build": "purple",
  Delivered: "success",
  Rejected: "destructive",
};

const LANES: TicketStatus[] = ["Awaiting admin approval", "Approved", "In build", "Delivered"];

function AdminTicketsPage() {
  const tickets = useTickets();
  const [q, setQ] = useState("");
  const [workspace, setWorkspace] = useState<"all" | string>("all");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const rows = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (workspace === "all" || t.workspaceId === workspace) &&
          (!q.trim() || `${t.id} ${t.detail} ${t.project} ${t.workspaceName}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [tickets, workspace, q],
  );

  const counts = LANES.map((lane) => ({ lane, n: rows.filter((t) => t.status === lane).length }));

  return (
    <AdminLayout>
      <PageHeader
        title="Ticket queue"
        subtitle={`${rows.length} customer requests · ${rows.filter((t) => t.status === "Awaiting admin approval").length} waiting on you`}
      />

      <div className="space-y-4">
        <div className="grid sm:grid-cols-4 gap-3">
          {counts.map((c) => (
            <Card key={c.lane} className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{c.lane}</div>
              <div className="text-[24px] font-bold tabular-nums mt-1">{c.n}</div>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[300px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search tickets…" value={q} onChange={(e) => setQ(e.target.value)} />
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

        <Card className="p-5">
          <SectionTitle hint="approve · build · deliver">Requests raised by workspace users</SectionTitle>

          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[12.5px] text-muted-foreground">
              No live tickets yet. Requests raised from Agents, Solutions or the new-project builder land here instantly.
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-3 items-stretch">
              {rows.map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-3.5 flex flex-col">
                  <div className="flex items-start gap-2">
                    <span className="h-8 w-8 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                      <TicketIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-snug">{t.detail}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono">{t.id}</span>
                        <span>· {t.workspaceName}</span>
                        <span>· {t.project}</span>
                        <span>· {t.type}</span>
                        <span>· raised by {t.raisedBy}</span>
                        {t.frequency && <span>· {t.frequency}</span>}
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {t.estimateDays} day estimate
                        </span>
                      </div>
                      {t.sources.length > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-1 truncate">
                          Sources: {t.sources.slice(0, 3).join(", ")}
                          {t.sources.length > 3 ? ` +${t.sources.length - 3}` : ""}
                        </div>
                      )}
                      {t.datapoints.length > 0 && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          Datapoints: {t.datapoints.slice(0, 5).join(", ")}
                          {t.datapoints.length > 5 ? ` +${t.datapoints.length - 5}` : ""}
                        </div>
                      )}
                      {t.fileName && <div className="text-[11px] text-muted-foreground truncate">Attachment: {t.fileName}</div>}
                      {t.adminNote && <div className="text-[11.5px] mt-1.5 rounded-md bg-secondary/50 px-2 py-1">Note: {t.adminNote}</div>}
                    </div>
                    <Badge tone={TONE[t.status]} className="whitespace-nowrap">
                      {t.status}
                    </Badge>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setTicketStatus(t.id, "Approved")}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setTicketStatus(t.id, "In build")}>
                        <Hammer className="h-3.5 w-3.5" /> Start build
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setTicketStatus(t.id, "Delivered")}>
                        <PackageCheck className="h-3.5 w-3.5" /> Mark delivered
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTicketStatus(t.id, "Rejected")}>
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Note back to the customer…"
                        value={noteDraft[t.id] ?? ""}
                        onChange={(e) => setNoteDraft((n) => ({ ...n, [t.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={!(noteDraft[t.id] ?? "").trim()}
                        onClick={() => {
                          setTicketNote(t.id, (noteDraft[t.id] ?? "").trim());
                          setNoteDraft((n) => ({ ...n, [t.id]: "" }));
                        }}
                      >
                        Save note
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
