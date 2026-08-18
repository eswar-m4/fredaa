import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Trash2, CalendarClock, Sparkles, Send, Globe, FolderPlus, CheckCircle2, Clock, Info, X, ChevronDown } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, SectionTitle, Select } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { estimate, fmt, requestsFor, type ChangeRequest, type Project, type SourceRef } from "@/data/customers";
import { statusTone } from "@/routes/index";
import { cn } from "@/lib/utils";
import { ATTRIBUTES } from "@/data/attributes";

const ATTRIBUTE_CHOICES: string[] = ATTRIBUTES.map((a) => a.label);


export const Route = createFileRoute("/refresh")({
  head: () => ({
    meta: [
      { title: "Projects — FreDA" },
      {
        name: "description",
        content: "Create, manage and schedule extraction projects, add or remove sources, and get instant build estimates sent to your FreDA admin.",
      },
      { property: "og:title", content: "Projects — FreDA" },
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

type Draft = {
  name: string;
  urls: string[];
  fields: string[];
  fieldDraft: string;
  frequency: Project["frequency"];
  owner: string;
  format: string;
  notes: string;
};

const SUGGESTED_FIELDS = ["Company name", "Website", "HQ country", "Employee count", "Revenue band", "Industry", "Contact email", "Price", "SKU", "Availability"];

const EMPTY_DRAFT: Draft = {
  name: "",
  urls: [""],
  fields: ["Company name", "Website", "HQ country"],
  fieldDraft: "",
  frequency: "Weekly",
  owner: "",
  format: "CSV",
  notes: "",
};

function RefreshPage() {
  const customer = useActiveCustomer();
  const [selectedId, setSelectedId] = useState(customer.projects[0]!.id);
  const project = customer.projects.find((p) => p.id === selectedId) ?? customer.projects[0]!;

  const [extra, setExtra] = useState<Record<string, SourceRef[]>>({});
  const [removed, setRemoved] = useState<Record<string, string[]>>({});
  const [newSource, setNewSource] = useState("");
  const [sourceAttrs, setSourceAttrs] = useState<string[]>([]);
  const [attrsBySource, setAttrsBySource] = useState<Record<string, string[]>>({});

  const [schedule, setSchedule] = useState<Record<string, Project["frequency"]>>({});
  const [notice, setNotice] = useState("");
  const [raised, setRaised] = useState<ChangeRequest[]>([]);

  const [open, setOpen] = useState({ projects: true, create: false, requests: false });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const draftDatapoints = Math.max(1, draft.fields.length);
  const draftUrlCount = Math.max(1, draft.urls.filter((u) => u.trim()).length || draft.urls.length);
  const draftEstimate = estimate(draftUrlCount, draftDatapoints, draft.frequency);

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
    if (!url || sourceAttrs.length === 0) return;
    const id = `${project.id}-new-${Date.now()}`;
    setExtra((e) => ({
      ...e,
      [project.id]: [
        ...(e[project.id] ?? []),
        { id, label: url.replace(/^https?:\/\//, ""), url, status: "Pending approval", records: 0, addedOn: "Just now" },
      ],
    }));
    setAttrsBySource((m) => ({ ...m, [id]: sourceAttrs }));
    logRequest(
      "Add source",
      `Add source ${url.replace(/^https?:\/\//, "")} · ${sourceAttrs.length} attributes (${sourceAttrs.slice(0, 3).join(", ")}${sourceAttrs.length > 3 ? "…" : ""})`,
      sourceEstimate.setupDays,
    );
    setNewSource("");
    setSourceAttrs([]);
    setNotice(`Source queued as ${nextReqId()} with ${sourceAttrs.length} data attributes — estimate sent to your FreDA admin for approval.`);
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
      `New project “${draft.name}” · ${draftUrlCount} URLs · ${draftDatapoints} datapoints · ${draft.frequency}`,
      draftEstimate.setupDays,
      draft.name,
    );
    setNotice(
      `Project “${draft.name}” submitted as ${nextReqId()} — estimate: ${draftEstimate.setupDays} days setup, ~${fmt(draftEstimate.monthlyRecords)} records/month. Admin notified.`,
    );
    setDraft(EMPTY_DRAFT);
  }

  function addField(v: string) {
    const f = v.trim();
    if (!f) return;
    setDraft((d) => (d.fields.includes(f) ? { ...d, fieldDraft: "" } : { ...d, fields: [...d.fields, f], fieldDraft: "" }));
  }

  function setUrl(i: number, v: string) {
    setDraft((d) => ({ ...d, urls: d.urls.map((u, k) => (k === i ? v : u)) }));
  }

  return (
    <AppLayout>
      <div className="px-7 pt-6 pb-4">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-r from-primary/12 via-purple-bg/50 to-transparent px-6 py-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="h-12 w-12 rounded-xl bg-primary text-primary-foreground inline-flex items-center justify-center shrink-0">
              <FolderPlus className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">Projects &amp; manage</div>
              <h1 className="text-[26px] leading-tight font-bold tracking-tight">{customer.name}</h1>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Create, manage and schedule extraction projects · {customer.projects.length} live projects
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge tone="info">{customer.projects.reduce((n, p) => n + p.sources.length, 0)} sources</Badge>
              <Badge tone="purple">{requests.length} open requests</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="px-7 pb-8 space-y-4">
        {notice && (
          <div className="rounded-lg border border-success/40 bg-success-bg px-4 py-2.5 text-[12.5px] text-success flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
          </div>
        )}

        <Panel
          id="projects"
          open={open.projects}
          onToggle={() => setOpen((o) => ({ ...o, projects: !o.projects }))}
          icon={<Globe className="h-4 w-4" />}
          title="Projects &amp; sources"
          subtitle="Select a project to manage sources, attributes and schedule"
          meta={`${customer.projects.length} projects`}
        >
          <div className="grid lg:grid-cols-2 gap-5 items-stretch">
            {/* project list */}
            <Card className="overflow-hidden flex flex-col h-[520px]">

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
          <Card className="p-5 flex flex-col h-[520px]">
            <SectionTitle hint={`${sources.length} sources`}>Manage — {project.name}</SectionTitle>

            <div className="rounded-lg border border-border p-3 mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1 min-w-0"
                  placeholder="https://new-source.example.com"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                />
                <Button size="sm" className="shrink-0" onClick={addSource} disabled={!newSource.trim() || sourceAttrs.length === 0}>
                  <Plus className="h-3.5 w-3.5" /> Add source
                </Button>
              </div>
              <div className="mt-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Data attributes to extract · {sourceAttrs.length}
                  </span>
                  <button
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => setSourceAttrs(sourceAttrs.length ? [] : project.datapoints.slice(0, 6))}
                  >
                    {sourceAttrs.length ? "Clear" : "Use project defaults"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-[92px] overflow-y-auto pr-1">
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
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      Attributes: {(attrsBySource[s.id] ?? project.datapoints).slice(0, 4).join(", ")}
                      {(attrsBySource[s.id] ?? project.datapoints).length > 4
                        ? ` +${(attrsBySource[s.id] ?? project.datapoints).length - 4}`
                        : ""}
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
        </Panel>

        {/* new project */}
        <Panel
          id="create"
          open={open.create}
          onToggle={() => setOpen((o) => ({ ...o, create: !o.create }))}
          icon={<FolderPlus className="h-4 w-4" />}
          title="Create a new project"
          subtitle="Instant estimate · admin notified on submit"
          meta={`${draftUrlCount} sources · ${draftDatapoints} datapoints`}
        >
          <Card className="overflow-hidden">

            <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-border bg-gradient-to-r from-primary/10 via-purple-bg/60 to-transparent">
              <span className="h-9 w-9 rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center shrink-0">
                <FolderPlus className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold leading-tight">Create a new project</h3>
                <p className="text-[11.5px] text-muted-foreground">Estimate generated instantly · admin notified on submit</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Badge tone="info">{draftUrlCount} sources</Badge>
                <Badge tone="purple">{draftDatapoints} datapoints</Badge>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-4 p-5">
              {/* col 1 — identity + sources */}
              <div className="space-y-3">
                <div>
                  <Label>
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" /> Project name
                    </span>
                  </Label>
                  <Input placeholder="e.g. APAC Competitor Pricing" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>

                <div className="rounded-lg border border-info/30 bg-info-bg/40 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-info">
                      <Globe className="h-3.5 w-3.5" /> Source URLs · {draft.urls.length}
                    </span>
                    <div className="flex gap-1">
                      {[1, 3, 5, 10].map((n) => (
                        <button
                          key={n}
                          suppressHydrationWarning
                          onClick={() => setDraft((d) => ({ ...d, urls: Array.from({ length: n }, (_, k) => d.urls[k] ?? "") }))}
                          className={cn(
                            "h-6 w-7 rounded-md text-[11px] font-semibold border transition",
                            draft.urls.length === n
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-muted-foreground hover:bg-secondary",
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
                    {draft.urls.map((u, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="h-6 w-6 shrink-0 rounded-md bg-card border border-border text-[10.5px] font-semibold tabular-nums inline-flex items-center justify-center text-muted-foreground">
                          {i + 1}
                        </span>
                        <Input
                          className="flex-1 min-w-0 h-8"
                          placeholder={`https://source-${i + 1}.example.com`}
                          value={u}
                          onChange={(e) => setUrl(i, e.target.value)}
                        />
                        <button
                          onClick={() => setDraft((d) => ({ ...d, urls: d.urls.length > 1 ? d.urls.filter((_, k) => k !== i) : d.urls }))}
                          title="Remove URL"
                          className="h-8 w-8 shrink-0 rounded-md inline-flex items-center justify-center border border-border bg-card hover:bg-destructive/10 hover:text-destructive transition"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setDraft((d) => ({ ...d, urls: [...d.urls, ""] }))}
                    className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add another URL
                  </button>
                </div>
              </div>

              {/* col 2 — datapoints */}
              <div className="rounded-lg border border-purple-token/30 bg-purple-bg/40 p-3 flex flex-col">
                <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-purple-token mb-2">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Datapoints to extract · {draftDatapoints}
                </span>
                <div className="flex items-center gap-1.5">
                  <Input
                    className="flex-1 min-w-0 h-8"
                    placeholder="e.g. Employee count"
                    value={draft.fieldDraft}
                    onChange={(e) => setDraft({ ...draft, fieldDraft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addField(draft.fieldDraft);
                      }
                    }}
                  />
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => addField(draft.fieldDraft)}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 max-h-[92px] overflow-y-auto pr-1">
                  {draft.fields.map((f) => (
                    <span key={f} className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-card pl-2.5 pr-1 h-7 text-[11.5px] font-medium">
                      {f}
                      <button
                        onClick={() => setDraft((d) => ({ ...d, fields: d.fields.filter((x) => x !== f) }))}
                        className="h-5 w-5 rounded inline-flex items-center justify-center hover:bg-destructive/10 hover:text-destructive transition"
                        title="Remove datapoint"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-auto pt-2 max-h-[76px] overflow-y-auto pr-1">
                  {SUGGESTED_FIELDS.filter((f) => !draft.fields.includes(f)).map((f) => (
                    <button
                      key={f}
                      onClick={() => addField(f)}
                      className="h-7 px-2.5 rounded-md border border-dashed border-border text-[11.5px] text-muted-foreground hover:bg-secondary transition"
                    >
                      + {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* col 3 — delivery + estimate */}
              <div className="space-y-3 flex flex-col">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 text-info" /> Frequency
                      </span>
                    </Label>
                    <Select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as Project["frequency"] })}>
                      <option value="Daily">Daily</option>
                      <option value="Weekly">Weekly</option>
                      <option value="Monthly">Monthly</option>
                    </Select>
                  </div>
                  <div>
                    <Label>
                      <span className="inline-flex items-center gap-1.5">
                        <Send className="h-3.5 w-3.5 text-success" /> Format
                      </span>
                    </Label>
                    <Select value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })}>
                      <option value="CSV">CSV drop</option>
                      <option value="JSON API">JSON API</option>
                      <option value="Snowflake">Snowflake share</option>
                      <option value="S3">S3 bucket</option>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Business owner</Label>
                    <Input placeholder="name@company.com" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input placeholder="Regions, QA rules…" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                  </div>
                </div>

                <div className="mt-auto rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Live estimate
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <Est label="Setup" value={`${draftEstimate.setupDays} days`} />
                    <Est label="First run" value={`${draftEstimate.firstRunHrs} hrs`} />
                    <Est label="Records / mo" value={fmt(draftEstimate.monthlyRecords)} />
                  </div>
                  <Button size="sm" className="w-full mt-3" onClick={submitProject} disabled={!draft.name.trim()}>
                    <FolderPlus className="h-3.5 w-3.5" /> Submit for estimate
                  </Button>
                  <p className="text-[10.5px] text-muted-foreground mt-1.5 text-center">Notifies your FreDA admin and delivery lead automatically.</p>
                </div>
              </div>
            </div>
          </Card>
        </Panel>

        <Panel
          id="requests"
          open={open.requests}
          onToggle={() => setOpen((o) => ({ ...o, requests: !o.requests }))}
          icon={<Clock className="h-4 w-4" />}
          title="Build request tracker"
          subtitle="Every add, retire or new build with its REQ number and status"
          meta={`${requests.length} requests`}
        >
          <Card className="p-5 flex flex-col">
            <SectionTitle hint="add / remove / new build">Requests raised</SectionTitle>

            <p className="text-[11.5px] text-muted-foreground -mt-1 mb-2 inline-flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 mt-[1px] shrink-0" />
              Every source you add, retire or modify is logged here with an auto-assigned REQ number (sequential per workspace) that your FreDA admin
              uses to approve and track the build.
            </p>
            <div className="grid md:grid-cols-2 gap-2 flex-1 min-h-0 max-h-[300px] overflow-y-auto pr-1 content-start">
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
        </Panel>

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

function Panel({
  open,
  onToggle,
  icon,
  title,
  subtitle,
  meta,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border transition", open ? "border-primary/40 bg-secondary/20" : "border-border bg-card")}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <span
          className={cn(
            "h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0 transition",
            open ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold leading-tight">{title}</span>
          <span className="block text-[11.5px] text-muted-foreground truncate">{subtitle}</span>
        </span>
        <Badge className="whitespace-nowrap" tone={open ? "info" : "neutral"}>
          {meta}
        </Badge>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
