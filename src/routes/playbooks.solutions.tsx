import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Boxes, CheckCircle2, Clock, Database, Search, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { SOLUTION_GROUPS, solutionsFor, type PlaybookSolution } from "@/lib/playbook-solutions";
import { addTicket } from "@/lib/ticket-store";
import { estimate } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbooks/solutions")({
  head: () => ({
    meta: [
      { title: "Solutions — FreDA playbooks" },
      { name: "description", content: "19 packaged domain datasets you can request: core profiles, change monitoring, contact enrichment, pricing watch and compliance screening." },
      { property: "og:title", content: "Solutions — FreDA playbooks" },
      { property: "og:description", content: "19 packaged domain datasets you can request, each with sources, datapoints and refresh cadence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SolutionsPage,
});

function SolutionsPage() {
  const customer = useActiveCustomer();
  const all = solutionsFor(customer);
  const [group, setGroup] = useState<"All" | PlaybookSolution["group"]>("All");
  const [q, setQ] = useState("");
  const [requested, setRequested] = useState<Record<string, string>>({});

  const solutions = useMemo(
    () =>
      all.filter(
        (s) =>
          (group === "All" || s.group === group) &&
          (!q.trim() || `${s.name} ${s.blurb}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [all, group, q],
  );

  function request(s: PlaybookSolution) {
    const est = estimate(s.sources, s.datapoints, s.refresh);
    const ticket = addTicket({
      workspaceId: customer.id,
      workspaceName: customer.name,
      project: s.name,
      type: "New project",
      detail: `Solution request — ${s.name} · ${s.sources} sources · ${s.datapoints} datapoints · ${s.refresh}`,
      raisedBy: `${customer.shortName.toLowerCase()} workspace user`,
      estimateDays: est.setupDays,
      monthlyRecords: est.monthlyRecords,
      sources: [],
      datapoints: [],
    });
    setRequested((r) => ({ ...r, [s.id]: ticket.id }));
  }

  return (
    <AppLayout>
      <PageHeader
        title="Solutions"
        subtitle={`${customer.name} · ${all.length} packaged ${customer.industry.toLowerCase()} datasets sourced and kept fresh for you`}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/playbooks">
              <Button size="sm" variant="outline">
                <ArrowLeft className="h-3.5 w-3.5" /> Playbooks
              </Button>
            </Link>
            <Link to="/refresh">
              <Button size="sm" variant="outline">
                <Boxes className="h-3.5 w-3.5" /> Manage projects
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-7 pb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[280px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search solutions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {(["All", ...SOLUTION_GROUPS] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              className={cn(
                "h-8 px-3 rounded-md border text-[11.5px] font-medium transition",
                group === g ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {g}
            </button>
          ))}
          <span className="ml-auto text-[11.5px] text-muted-foreground">
            {solutions.length} of {all.length} solutions
          </span>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {solutions.map((s) => (
            <Card key={s.id} className="p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <span className="h-9 w-9 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                  <Boxes className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold leading-snug">{s.name}</div>
                  <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{s.blurb}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="info">
                  <span className="inline-flex items-center gap-1">
                    <Database className="h-3 w-3" /> {s.sources} sources
                  </span>
                </Badge>
                <Badge tone="neutral">{s.datapoints} datapoints</Badge>
                <Badge tone="purple">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {s.refresh}
                  </span>
                </Badge>
              </div>
              <div className="mt-auto pt-4">
                {requested[s.id] ? (
                  <div className="rounded-md border border-success/30 bg-success-bg px-3 py-2 text-[11.5px] text-success inline-flex items-center gap-1.5 w-full">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sent to admin as {requested[s.id]}
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full justify-center" onClick={() => request(s)}>
                    <Sparkles className="h-3.5 w-3.5" /> Request this solution
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
