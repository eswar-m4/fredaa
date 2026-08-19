import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Bot, CalendarClock, Clock, Globe, Plus, Search, Trash2, ExternalLink, CheckCircle2, Ticket } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle, Select } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { estimate, fmt, type Project, type SourceRef } from "@/data/customers";
import { addTicket } from "@/lib/ticket-store";
import { ATTRIBUTES } from "@/data/attributes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbooks/agents")({
  head: () => ({
    meta: [
      { title: "Agents & sources — FreDA playbooks" },
      { name: "description", content: "Every source agent running in your workspace — add or retire sources, change the run schedule and track record counts." },
      { property: "og:title", content: "Agents & sources — FreDA playbooks" },
      { property: "og:description", content: "Manage the source agents behind each project: add, retire, reschedule." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentsPage,
});

const ATTRIBUTE_CHOICES = ATTRIBUTES.map((a) => a.label);

const NEUTRAL_ART = {
  border: "border-border",
  header: "bg-muted",
  headerText: "text-foreground",
  chip: "bg-muted text-muted-foreground",
  stripe: "bg-muted",
};
type Cadence = "Daily" | "Weekly" | "Monthly" | "Custom";

function AgentsPage() {
  const customer = useActiveCustomer();
  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState<string>(customer.projects[0]!.id);

  const project = customer.projects.find((p) => p.id === projectId) ?? customer.projects[0]!;

  const [extra, setExtra] = useState<Record<string, SourceRef[]>>({});
  const [removed, setRemoved] = useState<Record<string, string[]>>({});
  const [newSource, setNewSource] = useState("");
  const [sourceAttrs, setSourceAttrs] = useState<string[]>([]);
  const [cadence, setCadence] = useState<Record<string, Cadence>>({});
  const [customRule, setCustomRule] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  const currentCadence: Cadence = cadence[project.id] ?? project.frequency;
  const currentRule = customRule[project.id] ?? "Every 2 weeks · Tuesday 06:00 UTC";

  const sources = [...project.sources, ...(extra[project.id] ?? [])].filter((s) => !(removed[project.id] ?? []).includes(s.id));

  const agents = useMemo(
    () =>
      customer.projects
        .flatMap((p) => p.sources.map((s) => ({ ...s, project: p })))
        .filter((a) => !q.trim() || `${a.label} ${a.url} ${a.project.name}`.toLowerCase().includes(q.trim().toLowerCase())),
    [customer, q],
  );

  const est = estimate(1, sourceAttrs.length || project.datapoints.length, currentCadence === "Custom" ? "Weekly" : (currentCadence as Project["frequency"]));

  function raise(type: "Add source" | "Remove source" | "Schedule change", detail: string, days: number, srcs: string[], dps: string[]) {
    const ticket = addTicket({
      workspaceId: customer.id,
      workspaceName: customer.name,
      project: project.name,
      type,
      detail,
      raisedBy: `${customer.shortName.toLowerCase()} workspace user`,
      estimateDays: days,
      sources: srcs,
      datapoints: dps,
      frequency: currentCadence === "Custom" ? currentRule : currentCadence,
    });
    setNotice(`${ticket.id} raised — sent to your FreDA admin for approval.`);
  }

  function addSource() {
    const url = newSource.trim();
    if (!url || sourceAttrs.length === 0) return;
    const id = `${project.id}-new-${Date.now()}`;
    setExtra((e) => ({
      ...e,
      [project.id]: [...(e[project.id] ?? []), { id, label: url.replace(/^https?:\/\//, ""), url, status: "Pending approval", records: 0, addedOn: "Just now" }],
    }));
    raise("Add source", `Add source ${url.replace(/^https?:\/\//, "")} · ${sourceAttrs.length} attributes`, est.setupDays, [url], sourceAttrs);
    setNewSource("");
    setSourceAttrs([]);
  }

  function removeSource(id: string) {
    const label = sources.find((s) => s.id === id)?.label ?? id;
    setRemoved((r) => ({ ...r, [project.id]: [...(r[project.id] ?? []), id] }));
    raise("Remove source", `Retire source ${label}`, 2, [label], []);
  }

  function saveSchedule() {
    const label = currentCadence === "Custom" ? `Custom — ${currentRule}` : currentCadence;
    raise("Schedule change", `Run schedule for “${project.name}” set to ${label}`, 1, [], []);
  }

  return (
    <AppLayout>
      <PageHeader
        title="Agents & sources"
        subtitle={`${customer.name} · ${agents.length} source agents across ${customer.projects.length} projects — add, retire and reschedule from here`}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/playbooks">
              <Button size="sm" variant="outline">
                <ArrowLeft className="h-3.5 w-3.5" /> Playbooks
              </Button>
            </Link>
            <Link to="/requests">
              <Button size="sm" variant="outline">
                <Ticket className="h-3.5 w-3.5" /> Request tracker
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-7 pb-8 space-y-4">
        {notice && (
          <div className="rounded-lg border border-success/40 bg-success-bg px-4 py-2.5 text-[12.5px] text-success flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-4 items-stretch">
          {/* manage project sources */}
          <Card className="p-5 flex flex-col min-h-[460px]">
            <SectionTitle hint={`${sources.length} sources`}>Manage sources</SectionTitle>

            <Select className="mb-3" value={project.id} onChange={(e) => setProjectId(e.target.value)}>
              {customer.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.sources.length} sources · {p.datapoints.length} datapoints
                </option>
              ))}
            </Select>

            <div className="rounded-lg border border-border p-3 mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Input className="flex-1 min-w-0" placeholder="https://new-source.example.com" value={newSource} onChange={(e) => setNewSource(e.target.value)} />
                <Button size="sm" className="shrink-0" onClick={addSource} disabled={!newSource.trim() || sourceAttrs.length === 0}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <div className="mt-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Attributes to extract · {sourceAttrs.length}</span>
                  <button className="text-[11px] text-primary hover:underline" onClick={() => setSourceAttrs(sourceAttrs.length ? [] : project.datapoints.slice(0, 6))}>
                    {sourceAttrs.length ? "Clear" : "Use project defaults"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-[86px] overflow-y-auto pr-1">
                  {ATTRIBUTE_CHOICES.map((a) => {
                    const on = sourceAttrs.includes(a);
                    return (
                      <button
                        key={a}
                        onClick={() => setSourceAttrs((s) => (on ? s.filter((x) => x !== a) : [...s, a]))}
                        className={cn(
                          "h-7 px-2.5 rounded-md border text-[11.5px] font-medium transition",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
                        )}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto grid sm:grid-cols-2 gap-2 content-start pr-1">
              {sources.map((s) => (
                <div key={s.id} className={cn("rounded-lg border p-0 overflow-hidden flex flex-col", NEUTRAL_ART.border)}>
                  <div className={cn("flex items-center gap-2 px-3 py-2", NEUTRAL_ART.header)}>
                    <Globe className={cn("h-3.5 w-3.5 shrink-0", NEUTRAL_ART.headerText)} />
                    <span className={cn("text-[12.5px] font-semibold truncate", NEUTRAL_ART.headerText)}>{s.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider font-semibold bg-card border rounded px-1.5 py-0.5 whitespace-nowrap">{s.status}</span>
                  </div>
                  <div className="px-3 py-2 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-muted-foreground truncate">added {s.addedOn}</div>
                      <div className="text-[13px] font-semibold tabular-nums">{fmt(s.records)} <span className="text-[11px] font-normal text-muted-foreground">records</span></div>
                    </div>
                    <button
                      onClick={() => removeSource(s.id)}
                      title="Retire source"
                      className="h-8 w-8 shrink-0 rounded-md inline-flex items-center justify-center border border-border hover:bg-destructive/10 hover:text-destructive transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* schedule */}
          <Card className="p-5 flex flex-col min-h-[460px]">
            <SectionTitle hint={currentCadence === "Custom" ? "custom rule" : currentCadence.toLowerCase()}>Run schedule — {project.name}</SectionTitle>
            <p className="text-[12px] text-muted-foreground -mt-1 mb-3">
              Choose how often FreDA re-runs every agent on this project. Changes are logged as a request so your delivery lead can confirm the new window.
            </p>

            <div className="grid grid-cols-2 gap-2">
              {(["Daily", "Weekly", "Monthly", "Custom"] as Cadence[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCadence((s) => ({ ...s, [project.id]: c }))}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition",
                    currentCadence === c ? "border-primary bg-primary/8" : "border-border bg-card hover:bg-secondary/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <CalendarClock className={cn("h-4 w-4", currentCadence === c ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-[13px] font-semibold">{c}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {c === "Daily" ? "Every 24 hours, 02:00 UTC" : c === "Weekly" ? "Mondays 06:00 UTC" : c === "Monthly" ? "1st of the month" : "Your own cadence and window"}
                  </div>
                </button>
              ))}
            </div>

            {currentCadence === "Custom" && (
              <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Custom rule</div>
                <Input
                  placeholder="e.g. Every 2 weeks · Tuesday 06:00 UTC"
                  value={currentRule}
                  onChange={(e) => setCustomRule((s) => ({ ...s, [project.id]: e.target.value }))}
                />
              </div>
            )}

            <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-3 text-[11.5px] text-muted-foreground flex items-start gap-2">
              <Clock className="h-3.5 w-3.5 mt-[2px] shrink-0" />
              <span>
                Next run under this setting: <span className="font-medium text-foreground">{currentCadence === "Daily" ? "tomorrow 02:00 UTC" : currentCadence === "Weekly" ? "Monday 06:00 UTC" : currentCadence === "Monthly" ? "1st, 06:00 UTC" : currentRule}</span> ·
                {" "}{sources.length} agents · {fmt(project.records)} records in scope
              </span>
            </div>

            <div className="mt-auto pt-3">
              <Button size="sm" className="w-full justify-center" onClick={saveSchedule}>
                <CalendarClock className="h-3.5 w-3.5" /> Save schedule
              </Button>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[280px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search all agents…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="text-[11.5px] text-muted-foreground">{agents.length} websites onboarded</span>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {agents.map((a, i) => {
              const art = SOURCE_ART[i % SOURCE_ART.length]!;
              return (
                <div key={`${a.project.id}-${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition">
                  <span className={cn("h-1.5 w-8 shrink-0 rounded-full bg-gradient-to-r", art.gradient)} />
                  <span className={cn("h-8 w-8 shrink-0 rounded-md inline-flex items-center justify-center", art.chip)}>
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 w-[240px]">
                    <div className="text-[13px] font-semibold truncate">{a.label}</div>
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 truncate max-w-full">
                      <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{a.url}</span>
                    </a>
                  </div>
                  <div className="hidden md:block min-w-0 flex-1 text-[11.5px] text-muted-foreground truncate">
                    {a.project.name} · {cadence[a.project.id] ?? a.project.frequency} · {a.project.datapoints.length} datapoints
                  </div>
                  <span className="hidden sm:block text-[11.5px] text-muted-foreground whitespace-nowrap">added {a.addedOn}</span>
                  <span className="text-[12.5px] font-semibold tabular-nums whitespace-nowrap w-[110px] text-right">{fmt(a.records)} records</span>
                  <Badge tone={a.status === "Live" ? "success" : a.status === "Paused" ? "warning" : "info"}>{a.status}</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
