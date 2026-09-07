import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Inbox, Search, Shield, UserRound, Users as UsersIcon } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge, Card, Input, PageHeader, Select, StatCard } from "@/components/ui-bits";
import { listAccounts, type AccountSummary } from "@/lib/auth";
import { useTickets, type Ticket, type TicketStatus, type TicketType } from "@/lib/ticket-store";
import { cn } from "@/lib/utils";

// Real, local-only overview of everything the admin console tracks — every
// number here comes straight from ticket-store.ts / auth.ts (no mock data,
// no backend call). Read-first: work happens on the Ticket queue page, this
// is the "where do things stand right now" landing page.
export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Overview — FreDA admin" },
      { name: "description", content: "All customer requests and local accounts, at a glance." },
    ],
  }),
  component: AdminOverviewPage,
});

const STATUS_TONE: Record<TicketStatus, "info" | "warning" | "success" | "purple" | "destructive"> = {
  Estimating: "info",
  "Awaiting admin approval": "warning",
  Approved: "success",
  "In build": "purple",
  Delivered: "success",
  Rejected: "destructive",
};

const STATUSES: TicketStatus[] = ["Estimating", "Awaiting admin approval", "Approved", "In build", "Delivered", "Rejected"];
const TYPES: TicketType[] = ["New project", "Add source", "Remove source", "Datapoint change", "Schedule change"];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function AdminOverviewPage() {
  const tickets = useTickets();
  const accounts = useMemo(() => listAccounts(), []);

  const [tab, setTab] = useState<"requests" | "users">("requests");
  const [type, setType] = useState<"all" | TicketType>("all");
  const [status, setStatus] = useState<"all" | TicketStatus>("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);

  const filtered = useMemo(() => {
    const rows = tickets.filter(
      (t) =>
        (type === "all" || t.type === type) &&
        (status === "all" || t.status === status) &&
        (!unreviewedOnly || t.status === "Awaiting admin approval") &&
        (!from || t.createdAt.slice(0, 10) >= from) &&
        (!to || t.createdAt.slice(0, 10) <= to) &&
        (!q.trim() || `${t.id} ${t.detail} ${t.project} ${t.workspaceName} ${t.raisedBy}`.toLowerCase().includes(q.toLowerCase())),
    );
    return rows.sort((a, b) => (sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  }, [tickets, type, status, unreviewedOnly, from, to, q, sort]);

  const counts = {
    total: tickets.length,
    ...Object.fromEntries(STATUSES.map((s) => [s, tickets.filter((t) => t.status === s).length])),
  } as Record<"total" | TicketStatus, number>;

  return (
    <AdminLayout>
      <PageHeader title="Overview" subtitle="Everything the console tracks, at a glance — read-first, work happens on Ticket queue" />

      <div className="space-y-3.5">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["requests", "users"] as const).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={cn(
                "h-8 px-4 text-[11.5px] font-medium transition",
                tab === tb ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {tb === "requests" ? `All requests (${tickets.length})` : `Users directory (${accounts.length})`}
            </button>
          ))}
        </div>

        {tab === "requests" ? (
          <>
            <div className="grid sm:grid-cols-4 xl:grid-cols-7 gap-2.5">
              <StatCard label="Total requests" value={counts.total} tone="neutral" />
              {STATUSES.map((s) => (
                <StatCard key={s} label={s} value={counts[s]} tone={STATUS_TONE[s]} />
              ))}
            </div>

            <Card className="p-3">
              <div className="flex flex-wrap items-end gap-2.5">
                <div className="w-[170px]">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Request type</div>
                  <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                    <option value="all">All</option>
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-[190px]">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Status</div>
                  <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                    <option value="all">All</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Search</div>
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-8" placeholder="Source, user, job id, status" value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                </div>
                <div className="w-[145px]">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">From</div>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="w-[145px]">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">To</div>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <div className="w-[150px]">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Sort</div>
                  <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </Select>
                </div>
                <label className="flex items-center gap-1.5 h-9 text-[12px] text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={unreviewedOnly}
                    onChange={(e) => setUnreviewedOnly(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  Show only unreviewed
                </label>
              </div>
            </Card>

            <Card className="overflow-hidden">
              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
                  <Inbox className="h-5 w-5 mx-auto mb-2 opacity-60" />
                  No requests match these filters.
                </div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="px-4 py-2 font-semibold">Request</th>
                      <th className="px-3 py-2 font-semibold">Workspace</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold">Raised by</th>
                      <th className="px-3 py-2 font-semibold">Created</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t: Ticket) => (
                      <tr key={t.id} className="border-b border-border/60">
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[11px] text-muted-foreground">{t.id}</div>
                          <div className="font-medium leading-snug line-clamp-1">{t.detail}</div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {t.workspaceName} <span className="text-[11px]">· {t.project}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{t.type}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{t.raisedBy}</td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        ) : (
          <UsersDirectory accounts={accounts} />
        )}
      </div>
    </AdminLayout>
  );
}

function UsersDirectory({ accounts }: { accounts: AccountSummary[] }) {
  return (
    <Card className="overflow-hidden">
      {accounts.length === 0 ? (
        <div className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
          <UsersIcon className="h-5 w-5 mx-auto mb-2 opacity-60" />
          No local accounts yet.
        </div>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Username</th>
              <th className="px-4 py-2 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.username} className="border-b border-border/60">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-7 w-7 shrink-0 rounded-full bg-info-bg text-info inline-flex items-center justify-center">
                      {a.role === "admin" ? <Shield className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                    </span>
                    <span className="font-medium">{a.display_name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground font-mono text-[11.5px]">{a.username}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={a.role === "admin" ? "purple" : "info"}>{a.role}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
