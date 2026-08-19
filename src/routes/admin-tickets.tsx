import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Hammer,
  Inbox,
  PackageCheck,
  Search,
  Ticket as TicketIcon,
  UserCog,
  XCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle } from "@/components/ui-bits";
import { CUSTOMERS, fmt } from "@/data/customers";
import {
  ONBOARDING_STEPS,
  setTicketAssignee,
  setTicketNote,
  setTicketStatus,
  toggleOnboardingStep,
  useTickets,
  type Ticket,
  type TicketStatus,
} from "@/lib/ticket-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-tickets")({
  head: () => ({
    meta: [
      { title: "Ticket queue — FreDA admin" },
      { name: "description", content: "Open any customer request, work it end to end — approve, build the bots, QA, onboard to the workspace and deliver." },
      { property: "og:title", content: "Ticket queue — FreDA admin" },
      { property: "og:description", content: "Work customer requests end to end: approve, build bots, QA, onboard and deliver." },
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
  const [tab, setTab] = useState<"queue" | "projects">("queue");
  const [q, setQ] = useState("");
  const [workspace, setWorkspace] = useState<"all" | string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (workspace === "all" || t.workspaceId === workspace) &&
          (!q.trim() || `${t.id} ${t.detail} ${t.project} ${t.workspaceName}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [tickets, workspace, q],
  );

  useEffect(() => {
    if (openId && !rows.some((t) => t.id === openId)) setOpenId(null);
  }, [rows, openId]);

  const selected = rows.find((t) => t.id === openId) ?? rows[0] ?? null;
  const counts = LANES.map((lane) => ({ lane, n: rows.filter((t) => t.status === lane).length }));

  return (
    <AdminLayout>
      <PageHeader
        title="Ticket queue & onboarding desk"
        subtitle={`${rows.length} customer requests · ${rows.filter((t) => t.status === "Awaiting admin approval").length} waiting on you`}
      />

      <div className="space-y-4">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["queue", "projects"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-8 px-4 text-[11.5px] font-medium transition",
                tab === t ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {t === "queue" ? `Request desk · ${rows.length}` : `All workspace projects · ${CUSTOMERS.reduce((a, c) => a + c.projects.length, 0)}`}
            </button>
          ))}
        </div>

        {tab === "projects" ? (
          <AllProjects />
        ) : (
          <>
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

            <div className="grid xl:grid-cols-[380px_1fr] gap-4 items-start">
              <Card className="p-4">
                <SectionTitle hint="click to open">Inbox</SectionTitle>
                {rows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-[12.5px] text-muted-foreground">
                    <Inbox className="h-5 w-5 mx-auto mb-2 opacity-60" />
                    No live tickets yet. Requests raised from Agents, Solutions or Ask FreDA land here instantly.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
                    {rows.map((t) => {
                      const on = selected?.id === t.id;
                      const done = (t.onboarding ?? []).length;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setOpenId(t.id)}
                          className={cn(
                            "w-full text-left rounded-lg border px-3 py-2.5 transition",
                            on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-muted-foreground">{t.id}</span>
                            <Badge tone={TONE[t.status]} className="ml-auto whitespace-nowrap">
                              {t.status}
                            </Badge>
                          </div>
                          <div className="text-[12.5px] font-medium leading-snug mt-1 line-clamp-2">{t.detail}</div>
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {t.workspaceName} · {t.type} · {done}/{ONBOARDING_STEPS.length} onboarding steps
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              {selected ? <WorkPanel key={selected.id} t={selected} /> : <Card className="p-10 text-center text-[12.5px] text-muted-foreground">Select a ticket to work on it.</Card>}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function WorkPanel({ t }: { t: Ticket }) {
  const [note, setNote] = useState(t.adminNote ?? "");
  const [owner, setOwner] = useState(t.assignee ?? "");
  const done = t.onboarding ?? [];
  const pct = Math.round((done.length / ONBOARDING_STEPS.length) * 100);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 shrink-0 rounded-lg bg-purple-bg text-purple-token inline-flex items-center justify-center">
          <TicketIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug">{t.detail}</div>
          <div className="text-[11.5px] text-muted-foreground mt-1 flex flex-wrap gap-x-2">
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
        </div>
        <Badge tone={TONE[t.status]} className="whitespace-nowrap">
          {t.status}
        </Badge>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 inline-flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" /> Sources to onboard · {t.sources.length}
          </div>
          {t.sources.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">No source changes in this request.</div>
          ) : (
            <ul className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
              {t.sources.map((s) => (
                <li key={s} className="flex items-center gap-2 text-[12px]">
                  <Bot className="h-3.5 w-3.5 text-info shrink-0" />
                  <span className="truncate">{s.replace(/^https?:\/\//, "")}</span>
                  {s.startsWith("http") && (
                    <a href={s} target="_blank" rel="noreferrer" className="ml-auto text-primary shrink-0">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {t.fileName && <div className="text-[11.5px] text-muted-foreground mt-2">Attachment: {t.fileName}</div>}
          {typeof t.monthlyRecords === "number" && (
            <div className="text-[11.5px] text-muted-foreground mt-1">Projected volume: {fmt(t.monthlyRecords)} records / month</div>
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Datapoints requested · {t.datapoints.length}</div>
          <div className="flex flex-wrap gap-1.5 max-h-[150px] overflow-y-auto pr-1">
            {t.datapoints.length === 0 ? (
              <span className="text-[12px] text-muted-foreground">Inherits project datapoints.</span>
            ) : (
              t.datapoints.map((d) => (
                <span key={d} className="h-6 px-2 rounded-md bg-secondary text-secondary-foreground text-[11px] inline-flex items-center">
                  {d}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Backend onboarding checklist</span>
          <span className="text-[11.5px] font-semibold tabular-nums">{pct}% complete</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-3">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {ONBOARDING_STEPS.map((s) => {
            const on = done.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleOnboardingStep(t.id, s)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] font-medium text-left transition",
                  on ? "border-success/40 bg-success-bg text-success" : "border-border hover:bg-secondary",
                )}
              >
                <CheckCircle2 className={cn("h-4 w-4 shrink-0", on ? "opacity-100" : "opacity-30")} />
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 inline-flex items-center gap-1.5">
            <UserCog className="h-3.5 w-3.5" /> Assigned engineer
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="e.g. bot-team / A. Rao" value={owner} onChange={(e) => setOwner(e.target.value)} />
            <Button size="sm" className="shrink-0" disabled={!owner.trim()} onClick={() => setTicketAssignee(t.id, owner.trim())}>
              Assign
            </Button>
          </div>
          {t.assignee && <div className="text-[11.5px] text-muted-foreground mt-2">Currently with {t.assignee}</div>}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Note back to the customer</div>
          <div className="flex items-center gap-2">
            <Input placeholder="Visible in their request tracker…" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" className="shrink-0" disabled={!note.trim()} onClick={() => setTicketNote(t.id, note.trim())}>
              Save
            </Button>
          </div>
          {t.adminNote && <div className="text-[11.5px] mt-2 rounded-md bg-secondary/50 px-2 py-1">Sent: {t.adminNote}</div>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setTicketStatus(t.id, "Approved")}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Approve request
        </Button>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setTicketStatus(t.id, "In build")}>
          <Hammer className="h-3.5 w-3.5" /> Start bot build
        </Button>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setTicketStatus(t.id, "Delivered")}>
          <PackageCheck className="h-3.5 w-3.5" /> Onboard & deliver
        </Button>
        <Button size="sm" variant="ghost" className="mt-3" onClick={() => setTicketStatus(t.id, "Rejected")}>
          <XCircle className="h-3.5 w-3.5" /> Reject
        </Button>
      </div>
    </Card>
  );
}

function AllProjects() {
  return (
    <div className="space-y-4">
      {CUSTOMERS.map((c) => (
        <Card key={c.id} className="p-5">
          <SectionTitle hint={`${c.projects.length} projects · ${c.industry}`}>{c.name}</SectionTitle>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
            {c.projects.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3.5 flex flex-col">
                <div className="flex items-start gap-2">
                  <span className="h-8 w-8 shrink-0 rounded-md bg-info-bg text-info inline-flex items-center justify-center">
                    <Database className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-snug truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {p.sources.length} sources · {p.datapoints.length} datapoints · {p.frequency}
                    </div>
                  </div>
                  <Badge tone={p.status === "In sync" ? "success" : p.status === "Needs attention" ? "destructive" : "warning"}>{p.status}</Badge>
                </div>
                <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-[11.5px] text-muted-foreground">
                  <span>{p.accuracy}% accuracy · {p.coverage}% coverage</span>
                  <span className="tabular-nums font-medium text-foreground">{fmt(p.records)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
