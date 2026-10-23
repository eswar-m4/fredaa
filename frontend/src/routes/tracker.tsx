import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Clock, Info, MessageSquare, RefreshCw, Search, Ticket } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tracker")({
  head: () => ({
    meta: [
      { title: "Request tracker — Freda" },
      { name: "description", content: "Every request raised through Ask Freda, with its status and the admin team's notes." },
    ],
  }),
  component: TrackerPage,
});

type TrackedRequest = {
  id: string;
  title: string;
  request?: string | null;
  status: string;
  admin_note?: string | null;
  attributes: string[];
  sources: string[];
  volume?: string | null;
  timeline?: string | null;
  cadence?: string | null;
  raised_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const TONE: Record<string, "info" | "warning" | "success" | "purple" | "destructive" | "neutral"> = {
  "Solution Requested": "warning",
  "Under Review": "info",
  "Pending Approval": "warning",
  Approved: "success",
  "Pending Onboarding": "purple",
  "Onboarding Completed": "success",
  Completed: "success",
  Rejected: "destructive",
  "Needs Clarification": "warning",
  "Unsupported Request": "destructive",
};

const OPEN_STATUSES = new Set(["Solution Requested", "Under Review", "Pending Approval", "Needs Clarification"]);

function formatDate(value?: string | null) {
  if (!value) return "—";
  const ts = Date.parse(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function TrackerPage() {
  const [requests, setRequests] = useState<TrackedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/demo/my-requests", { timeoutMs: 15000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setError("Could not load your requests. Please try again.");
      console.error("Failed to load requests:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const statuses = useMemo(() => Array.from(new Set(requests.map((r) => r.status))), [requests]);
  const rows = useMemo(
    () =>
      requests.filter(
        (r) =>
          (status === "all" || r.status === status) &&
          (!q.trim() || `${r.id} ${r.title} ${r.request ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [requests, q, status],
  );
  const openCount = requests.filter((r) => OPEN_STATUSES.has(r.status)).length;

  return (
    <AppLayout>
      <PageHeader
        title="Request tracker"
        subtitle={`${requests.length} request${requests.length === 1 ? "" : "s"} raised through Ask Freda · ${openCount} waiting on the admin team`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </Button>
            <Link to="/discover">
              <Button size="sm">
                <MessageSquare className="h-3.5 w-3.5" /> Ask Freda
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-7 pb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[300px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search requests…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {["all", ...statuses].map((s) => (
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
          <SectionTitle hint="raised through Ask Freda">Your requests</SectionTitle>
          <p className="text-[11.5px] text-muted-foreground -mt-1 mb-3 inline-flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-[1px] shrink-0" />
            Each requirement you submit in Ask Freda gets a request ID. The admin team reviews, approves and onboards it against that ID — the status here
            updates as they work it.
          </p>

          {error ? (
            <div className="rounded-lg border border-destructive/40 p-6 text-center text-[13px] text-destructive">{error}</div>
          ) : loading && requests.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-muted-foreground">Loading requests…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
              {requests.length === 0 ? "No requests yet. Describe what you need in Ask Freda and submit it to see it here." : "No requests match the current filters."}
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-3 items-stretch">
              {rows.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3.5 flex flex-col">
                  <div className="flex items-start gap-2">
                    <span className="h-8 w-8 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                      <Ticket className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-snug">{r.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono">{r.id}</span>
                        {r.raised_by && <span>· {r.raised_by}</span>}
                        <span>· submitted {formatDate(r.created_at)}</span>
                        {r.cadence && <span>· {r.cadence}</span>}
                        {r.timeline && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {r.timeline}
                          </span>
                        )}
                      </div>
                      {(r.attributes.length > 0 || r.sources.length > 0) && (
                        <div className="text-[11px] text-muted-foreground mt-1.5">
                          {r.attributes.length > 0 && <span>{r.attributes.length} datapoints</span>}
                          {r.attributes.length > 0 && r.sources.length > 0 && <span> · </span>}
                          {r.sources.length > 0 && <span>{r.sources.slice(0, 3).join(", ")}{r.sources.length > 3 ? ` +${r.sources.length - 3}` : ""}</span>}
                        </div>
                      )}
                      {r.admin_note && (
                        <div className="text-[11.5px] text-foreground mt-1.5 rounded-md bg-secondary/50 px-2 py-1">Admin: {r.admin_note}</div>
                      )}
                    </div>
                    <Badge tone={TONE[r.status] ?? "neutral"} className="whitespace-nowrap">
                      {r.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
