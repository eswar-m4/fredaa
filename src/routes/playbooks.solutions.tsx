import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Boxes, CalendarClock, CheckCircle2, ChevronDown, Clock, Database, FolderPlus, Plus, Search, Sparkles, Trash2, Upload, X, Ticket } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, Select } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { SOLUTION_GROUPS, solutionsFor, type PlaybookSolution } from "@/lib/playbook-solutions";
import { addTicket } from "@/lib/ticket-store";
import { readIntakeFile, type IntakeResult } from "@/lib/ai-intake";
import { estimate, fmt, type Project } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbooks/solutions")({
  head: () => ({
    meta: [
      { title: "Solutions & new projects — FreDA playbooks" },
      { name: "description", content: "Request one of 19 packaged datasets or design a new project — upload your source list, pick datapoints and a schedule, get an instant estimate." },
      { property: "og:title", content: "Solutions & new projects — FreDA playbooks" },
      { property: "og:description", content: "Packaged datasets plus a guided new-project builder with instant estimates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SolutionsPage,
});

const SUGGESTED_FIELDS = ["Company name", "Website", "HQ country", "Employee count", "Revenue band", "Industry", "Contact email", "Price", "SKU", "Availability"];
type Cadence = "Daily" | "Weekly" | "Monthly" | "Custom";

function SolutionsPage() {
  const customer = useActiveCustomer();
  const all = solutionsFor(customer);
  const [group, setGroup] = useState<"All" | PlaybookSolution["group"]>("All");
  const [q, setQ] = useState("");
  const [requested, setRequested] = useState<Record<string, string>>({});

  // new project builder
  const [openBuilder, setOpenBuilder] = useState(false);
  const [name, setName] = useState("");
  const [urls, setUrls] = useState<string[]>([""]);
  const [fields, setFields] = useState<string[]>(["Company name", "Website", "HQ country"]);
  const [fieldDraft, setFieldDraft] = useState("");
  const [cadence, setCadence] = useState<Cadence>("Weekly");
  const [customRule, setCustomRule] = useState("Every 2 weeks · Tuesday 06:00 UTC");
  const [owner, setOwner] = useState("");
  const [intake, setIntake] = useState<IntakeResult | null>(null);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const solutions = useMemo(
    () => all.filter((s) => (group === "All" || s.group === group) && (!q.trim() || `${s.name} ${s.blurb}`.toLowerCase().includes(q.trim().toLowerCase()))),
    [all, group, q],
  );

  const urlCount = Math.max(1, urls.filter((u) => u.trim()).length);
  const est = estimate(urlCount, Math.max(1, fields.length), cadence === "Custom" ? "Weekly" : (cadence as Project["frequency"]));
  const scheduleLabel = cadence === "Custom" ? `Custom — ${customRule}` : cadence;

  function requestSolution(s: PlaybookSolution) {
    const e = estimate(s.sources, s.datapoints, s.refresh);
    const ticket = addTicket({
      workspaceId: customer.id,
      workspaceName: customer.name,
      project: s.name,
      type: "New project",
      detail: `Solution request — ${s.name} · ${s.sources} sources · ${s.datapoints} datapoints · ${s.refresh}`,
      raisedBy: `${customer.shortName.toLowerCase()} workspace user`,
      estimateDays: e.setupDays,
      monthlyRecords: e.monthlyRecords,
      sources: [],
      datapoints: [],
      frequency: s.refresh,
    });
    setRequested((r) => ({ ...r, [s.id]: ticket.id }));
  }

  async function readFile(file: File) {
    const text = await file.text();
    const result = readIntakeFile(file.name, text);
    setIntake(result);
    setOpenBuilder(true);
    if (!name.trim()) setName(result.suggestedName);
    if (result.urls.length) setUrls(result.urls);
    if (result.datapoints.length) setFields(result.datapoints);
    setNotice(`FreDA AI read “${file.name}” — ${result.urls.length} sources and ${result.datapoints.length} datapoints filled in. Review and submit.`);
  }

  function submitProject() {
    if (!name.trim()) return;
    const detail = `New project “${name}” · ${urlCount} sources · ${fields.length} datapoints · ${scheduleLabel}${intake ? ` · from ${intake.fileName}` : ""}`;
    const ticket = addTicket({
      workspaceId: customer.id,
      workspaceName: customer.name,
      project: name,
      type: "New project",
      detail,
      raisedBy: owner.trim() || `${customer.shortName.toLowerCase()} workspace user`,
      estimateDays: est.setupDays,
      monthlyRecords: est.monthlyRecords,
      sources: urls.filter((u) => u.trim()),
      datapoints: fields,
      frequency: scheduleLabel,
      ...(intake ? { fileName: intake.fileName } : {}),
    });
    setNotice(`Project “${name}” submitted as ${ticket.id} — ${est.setupDays} days setup, ~${fmt(est.monthlyRecords)} records/month. Admin notified.`);
    setName("");
    setUrls([""]);
    setFields(["Company name", "Website", "HQ country"]);
    setOwner("");
    setIntake(null);
  }

  return (
    <AppLayout>
      <PageHeader
        title="Solutions"
        subtitle={`${customer.name} · ${all.length} packaged ${customer.industry.toLowerCase()} datasets, or build a new project from your own source list`}
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

        {/* new project builder */}
        <section className={cn("rounded-xl border transition", openBuilder ? "border-primary/40 bg-secondary/20" : "border-border bg-card")}>
          <button onClick={() => setOpenBuilder((o) => !o)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
            <span className={cn("h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0", openBuilder ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
              <FolderPlus className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-tight">Create a new project</span>
              <span className="block text-[11.5px] text-muted-foreground truncate">Upload a source list or add URLs, pick datapoints and a run schedule — instant estimate to admin</span>
            </span>
            <Badge tone={openBuilder ? "info" : "neutral"}>{est.setupDays}d estimate</Badge>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", openBuilder && "rotate-180")} />
          </button>

          {openBuilder && (
            <div className="px-4 pb-4 grid lg:grid-cols-2 gap-4 items-stretch">
              <Card className="p-5 space-y-3">
                <div>
                  <Label>Project name</Label>
                  <Input placeholder="e.g. EMEA account refresh" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <div
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 text-center cursor-pointer hover:bg-primary/10 transition"
                >
                  <Upload className="h-5 w-5 mx-auto text-primary" />
                  <div className="text-[12.5px] font-medium mt-1.5">Upload your source / datapoint list</div>
                  <div className="text-[11px] text-muted-foreground">CSV, TSV or TXT — FreDA AI reads it and fills the form</div>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.tsv,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void readFile(f);
                    }}
                  />
                </div>

                {intake && (
                  <div className="rounded-lg border border-info/30 bg-info-bg px-3 py-2 text-[11.5px] text-info">
                    {intake.fileName} · {intake.urls.length} sources · {intake.datapoints.length} datapoints detected
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="mb-0">Source URLs · {urls.length}</Label>
                    <div className="flex items-center gap-1">
                      {[1, 3, 5, 10].map((n) => (
                        <button
                          key={n}
                          onClick={() => setUrls(Array.from({ length: n }, (_, i) => urls[i] ?? ""))}
                          className="h-6 px-2 rounded border border-border text-[11px] text-muted-foreground hover:bg-secondary"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                    {urls.map((u, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input placeholder="https://source.example.com" value={u} onChange={(e) => setUrls(urls.map((x, k) => (k === i ? e.target.value : x)))} />
                        {urls.length > 1 && (
                          <button
                            onClick={() => setUrls(urls.filter((_, k) => k !== i))}
                            className="h-9 w-9 shrink-0 rounded-md border border-border inline-flex items-center justify-center hover:bg-secondary"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setUrls([...urls, ""])}>
                    <Plus className="h-3.5 w-3.5" /> Add URL
                  </Button>
                </div>
              </Card>

              <Card className="p-5 flex flex-col space-y-3">
                <div>
                  <Label>Datapoints to extract · {fields.length}</Label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {fields.map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary/10 border border-primary/30 text-[11.5px] font-medium">
                        {f}
                        <button onClick={() => setFields(fields.filter((x) => x !== f))}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Add a datapoint…"
                      value={fieldDraft}
                      onChange={(e) => setFieldDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && fieldDraft.trim()) {
                          setFields((f) => (f.includes(fieldDraft.trim()) ? f : [...f, fieldDraft.trim()]));
                          setFieldDraft("");
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        if (!fieldDraft.trim()) return;
                        setFields((f) => (f.includes(fieldDraft.trim()) ? f : [...f, fieldDraft.trim()]));
                        setFieldDraft("");
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {SUGGESTED_FIELDS.filter((s) => !fields.includes(s)).slice(0, 6).map((s) => (
                      <button key={s} onClick={() => setFields([...fields, s])} className="h-6 px-2 rounded border border-border text-[11px] text-muted-foreground hover:bg-secondary">
                        + {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 text-info" /> Run schedule
                      </span>
                    </Label>
                    <Select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                      <option value="Daily">Daily</option>
                      <option value="Weekly">Weekly</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Custom">Custom</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Business owner</Label>
                    <Input placeholder="name@company.com" value={owner} onChange={(e) => setOwner(e.target.value)} />
                  </div>
                </div>

                {cadence === "Custom" && (
                  <div>
                    <Label>Custom cadence</Label>
                    <Input placeholder="Every 2 weeks · Tuesday 06:00 UTC" value={customRule} onChange={(e) => setCustomRule(e.target.value)} />
                  </div>
                )}

                <div className="mt-auto rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Live estimate
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <Est label="Setup" value={`${est.setupDays} days`} />
                    <Est label="First run" value={`${est.firstRunHrs} hrs`} />
                    <Est label="Records / mo" value={fmt(est.monthlyRecords)} />
                  </div>
                  <Button size="sm" className="w-full mt-3" onClick={submitProject} disabled={!name.trim()}>
                    <FolderPlus className="h-3.5 w-3.5" /> Submit for estimate
                  </Button>
                  <p className="text-[10.5px] text-muted-foreground mt-1.5 text-center">Raises a REQ ticket to your FreDA admin with sources, datapoints and schedule.</p>
                </div>
              </Card>
            </div>
          )}
        </section>

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
                  <Button size="sm" variant="outline" className="w-full justify-center" onClick={() => requestSolution(s)}>
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

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5", className)}>{children}</div>;
}

function Est({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
