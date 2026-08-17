import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Trash2, CalendarClock, Sparkles, Send, Globe, FolderPlus, CheckCircle2, Clock, Info, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle, Select } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { estimate, fmt, requestsFor, type ChangeRequest, type Project, type SourceRef } from "@/data/customers";
import { statusTone } from "@/routes/index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/refresh")({
  head: () => ({
    meta: [
      { title: "Projects Refresh — FreDA" },
      {
        name: "description",
        content: "Create, manage and schedule extraction projects, add or remove sources, and get instant build estimates sent to your FreDA admin.",
      },
      { property: "og:title", content: "Projects Refresh — FreDA" },
      {
        property: "og:description",
        content: "Create, manage and schedule extraction projects, add or remove sources, and get instant build estimates sent to your FreDA admin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RefreshPage,
});

type Draft = { name: string; urls: string[]; datapoints: number; frequency: Project["frequency"] };

function RefreshPage() {
  const customer = useActiveCustomer();
  const [selectedId, setSelectedId] = useState(customer.projects[0]!.id);
  const project = customer.projects.find((p) => p.id === selectedId) ?? customer.projects[0]!;

  const [extra, setExtra] = useState<Record<string, SourceRef[]>>({});
  const [removed, setRemoved] = useState<Record<string, string[]>>({});
  const [newSource, setNewSource] = useState("");
  const [schedule, setSchedule] = useState<Record<string, Project["frequency"]>>({});
  const [notice, setNotice] = useState("");
  const [raised, setRaised] = useState<ChangeRequest[]>([]);

  const [draft, setDraft] = useState<Draft>({ name: "", urls: ["", "", ""], datapoints: 12, frequency: "Weekly" });
  const draftUrlCount = Math.max(1, draft.urls.filter((u) => u.trim()).length || draft.urls.length);
  const draftEstimate = estimate(draftUrlCount, draft.datapoints, draft.frequency);

  const seeded = useMemo(() => requestsFor(customer), [customer.id]);
  const requests = [...raised, ...seeded];

  const sources = [...project.sources, ...(extra[project.id] ?? [])].filter((s) => !(removed[project.id] ?? []).includes(s.id));
  const pendingSources = (extra[project.id] ?? []).length;
  const sourceEstimate = estimate(Math.max(1, pendingSources), project.datapoints.length, schedule[project.id] ?? project.frequency);

  function nextReqId() {
    return `REQ-${2400 + raised.length + 1}`;
  }

  function logRequest(type: ChangeRequest["type"], detail: string, estimateDays: number, projectName = project.name) {
    setRaised((r) => [
      {
        id: `REQ-${2400 + r.length + 1}`,
        project: projectName,
        type,
        detail,
        submitted: "Just now",
        status: "Estimating",
        estimateDays,
      },
      ...r,
    ]);
  }

  function addSource() {
    const url = newSource.trim();
    if (!url) return;
    const id = `${project.id}-new-${Date.now()}`;
    setExtra((e) => ({
      ...e,
      [project.id]: [
        ...(e[project.id] ?? []),
        { id, label: url.replace(/^https?:\/\//, ""), url, status: "Pending approval", records: 0, addedOn: "Just now" },
      ],
    }));
    logRequest("Add source", `Add source ${url.replace(/^https?:\/\//, "")}`, sourceEstimate.setupDays);
    setNewSource("");
    setNotice(`Source queued as ${nextReqId()} — estimate generated and sent to your FreDA admin for approval.`);
  }

  function removeSource(id: string) {
    const label = sources.find((s) => s.id === id)?.label ?? id;
    setRemoved((r) => ({ ...r, [project.id]: [...(r[project.id] ?? []), id] }));
    logRequest("Remove source", `Retire source ${label}`, 2);
    setNotice(`Removal request ${nextReqId()} raised — admin notified, data stays live until approved.`);
  }

  function submitProject() {
    if (!draft.name.trim()) return;
    logRequest(
      "New project",
      `New project “${draft.name}” · ${draftUrlCount} URLs · ${draft.datapoints} datapoints · ${draft.frequency}`,
      draftEstimate.setupDays,
      draft.name,
    );
    setNotice(
      `Project “${draft.name}” submitted as ${nextReqId()} — estimate: ${draftEstimate.setupDays} days setup, ~${fmt(draftEstimate.monthlyRecords)} records/month. Admin notified.`,
    );
    setDraft({ name: "", urls: ["", "", ""], datapoints: 12, frequency: "Weekly" });
  }

  function setUrl(i: number, v: string) {
    setDraft((d) => ({ ...d, urls: d.urls.map((u, k) => (k === i ? v : u)) }));
  }

  return (
    <AppLayout>
      <PageHeader
        title="Projects Refresh"
        subtitle={`${customer.name} · create, manage and schedule extraction projects · ${customer.projects.length} live`}
        actions={
          <Button size="sm" variant="outline" onClick={() => setNotice("Full re-extraction queued for all projects.")}>
            <CalendarClock className="h-3.5 w-3.5" /> Re-run everything
          </Button>
        }
      />

      <div className="px-7 pb-8 space-y-5">
        {notice && (
          <div className="rounded-lg border border-success/40 bg-success-bg px-4 py-2.5 text-[12.5px] text-success flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
          </div>
        )}

        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-5 items-start">
          {/* project list */}
          <Card className="overflow-hidden flex flex-col min-h-[420px] max-h-[560px]">
            <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Projects</h3>
              <p className="text-[12px] text-muted-foreground mt-1">Select a project to manage its sources and schedule.</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {customer.projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "w-full text-left px-5 py-3 border-b border-border/60 hover:bg-secondary/40 transition",
                    p.id === project.id && "bg-info-bg/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium flex-1 truncate">{p.name}</span>
                    <Badge tone={statusTone[p.status]} className="whitespace-nowrap">
                      {p.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {p.sources.length} sources · {p.datapoints.length} datapoints · {fmt(p.records)} records · {schedule[p.id] ?? p.frequency}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* manage selected project */}
          <Card className="p-5 flex flex-col min-h-[420px] max-h-[560px]">
            <SectionTitle hint={`${sources.length} sources`}>Manage — {project.name}</SectionTitle>

            <div className="flex items-center gap-2 mb-3">
              <Input
                className="flex-1 min-w-0"
                placeholder="https://new-source.example.com"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
              />
              <Button size="sm" className="shrink-0" onClick={addSource}>
                <Plus className="h-3.5 w-3.5" /> Add source
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="h-8 w-8 rounded-md bg-secondary text-muted-foreground inline-flex items-center justify-center shrink-0">
                    <Globe className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{s.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {s.url} · added {s.addedOn} · {fmt(s.records)} records
                    </div>
                  </div>
                  <Badge className="whitespace-nowrap" tone={s.status === "Live" ? "success" : s.status === "Paused" ? "warning" : "info"}>
                    {s.status}
                  </Badge>
                  <button
                    onClick={() => removeSource(s.id)}
                    title="Remove source"
                    className="h-8 w-8 shrink-0 rounded-md inline-flex items-center justify-center border border-border hover:bg-destructive/10 hover:text-destructive transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 pt-3 border-t border-border grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end shrink-0">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Run schedule</div>
                <Select
                  value={schedule[project.id] ?? project.frequency}
                  onChange={(e) => setSchedule((s) => ({ ...s, [project.id]: e.target.value as Project["frequency"] }))}
                >
                  <option value="Daily">Daily — every 24 hours</option>
                  <option value="Weekly">Weekly — Monday 06:00 UTC</option>
                  <option value="Monthly">Monthly — 1st of month</option>
                </Select>
              </div>
              <Button size="sm" onClick={() => setNotice(`Schedule for “${project.name}” updated to ${schedule[project.id] ?? project.frequency}.`)}>
                <CalendarClock className="h-3.5 w-3.5" /> Save schedule
              </Button>
            </div>

            {pendingSources > 0 && (
              <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 shrink-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Modification estimate
                  </span>
                  <span>Setup {sourceEstimate.setupDays}d</span>
                  <span>First run {sourceEstimate.firstRunHrs}h</span>
                  <span>+{fmt(sourceEstimate.monthlyRecords)} records/mo</span>
                  <span>{fmt(sourceEstimate.credits)} credits/mo</span>
                  <span className="text-muted-foreground">Confidence {sourceEstimate.confidence}%</span>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* new project */}
        <div className="grid xl:grid-cols-2 gap-5 items-stretch">
          <Card className="p-5 flex flex-col">
            <SectionTitle hint="estimate generated instantly">Create a new project</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              <div className="sm:col-span-2">
                <Label>Project name</Label>
                <Input placeholder="e.g. APAC Competitor Pricing" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>

              <div className="sm:col-span-2">
                <Label>Source URLs · {draft.urls.length}</Label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                    <button
                      key={n}
                      suppressHydrationWarning
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          urls: Array.from({ length: n }, (_, k) => d.urls[k] ?? ""),
                        }))
                      }
                      className={cn(
                        "h-8 w-9 rounded-md text-[12px] font-medium border transition",
                        draft.urls.length === n
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">

                  {draft.urls.map((u, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-5 tabular-nums shrink-0">{i + 1}.</span>
                      <Input
                        className="flex-1 min-w-0"
                        placeholder={`https://source-${i + 1}.example.com`}
                        value={u}
                        onChange={(e) => setUrl(i, e.target.value)}
                      />
                      <button
                        onClick={() => setDraft((d) => ({ ...d, urls: d.urls.length > 1 ? d.urls.filter((_, k) => k !== i) : d.urls }))}
                        title="Remove URL"
                        className="h-9 w-9 shrink-0 rounded-md inline-flex items-center justify-center border border-border hover:bg-destructive/10 hover:text-destructive transition"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setDraft((d) => ({ ...d, urls: [...d.urls, ""] }))}>
                  <Plus className="h-3.5 w-3.5" /> Add URL
                </Button>
              </div>

              <div>
                <Label>Datapoints per record · {draft.datapoints}</Label>
                <input
                  suppressHydrationWarning
                  type="range"
                  min={4}
                  max={40}
                  value={draft.datapoints}
                  onChange={(e) => setDraft({ ...draft, datapoints: Number(e.target.value) })}
                  className="w-full accent-[var(--primary)]"
                />
              </div>
              <div>
                <Label>Frequency</Label>
                <Select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as Project["frequency"] })}>
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                </Select>
              </div>
            </div>

            <div className="mt-auto pt-4">
              <div className="rounded-lg border border-border bg-secondary/40 p-4">


              <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Live estimate · {draftUrlCount} sources
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                <Est label="Setup" value={`${draftEstimate.setupDays} days`} />
                <Est label="First run" value={`${draftEstimate.firstRunHrs} hrs`} />
                <Est label="Records / mo" value={fmt(draftEstimate.monthlyRecords)} />
                <Est label="Credits / mo" value={fmt(draftEstimate.credits)} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Send className="h-3 w-3" /> Submitting notifies your FreDA admin and delivery lead automatically.
                </div>
                <Button size="sm" onClick={submitProject} disabled={!draft.name.trim()}>
                  <FolderPlus className="h-3.5 w-3.5" /> Submit for estimate
                </Button>
              </div>
              </div>
            </div>
          </Card>


          <Card className="p-5">
            <SectionTitle hint="add / remove / new build">Change requests</SectionTitle>
            <p className="text-[11.5px] text-muted-foreground -mt-1 mb-2 inline-flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 mt-[1px] shrink-0" />
              Every source you add, retire or modify is logged here with an auto-assigned REQ number (sequential per workspace) that your FreDA admin
              uses to approve and track the build.
            </p>
            <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
              {requests.map((r) => (
                <div key={r.id} className="rounded-lg border border-border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium flex-1 truncate">{r.detail}</span>
                    <Badge className="whitespace-nowrap" tone={r.type === "New project" ? "purple" : r.type === "Remove source" ? "destructive" : "info"}>
                      {r.type}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                    <span className="font-mono">{r.id}</span>
                    <span>· {r.project}</span>
                    <span>· submitted {r.submitted}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {r.estimateDays} day estimate
                    </span>
                    <Badge
                      className="ml-auto whitespace-nowrap"
                      tone={r.status === "Approved" ? "success" : r.status === "In build" ? "purple" : r.status === "Estimating" ? "info" : "warning"}
                    >
                      {r.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{children}</div>;
}

function Est({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
