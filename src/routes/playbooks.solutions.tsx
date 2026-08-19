import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  Clock,
  Database,
  FileSpreadsheet,
  GraduationCap,
  Globe,
  Hotel,
  Landmark,
  Layers,
  Newspaper,
  Plane,
  Plus,
  Rocket,
  Scale,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  Store,
  Ticket,
  Trash2,
  Upload,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle, Select, Steps } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { addTicket } from "@/lib/ticket-store";
import { readIntakeFile, type IntakeResult } from "@/lib/ai-intake";
import { estimate, fmt, type Project } from "@/data/customers";
import { DATASETS, DATASET_CATEGORIES, type Dataset } from "@/data/datasets";
import { categoryArt } from "@/data/category-art";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbooks/solutions")({
  head: () => ({
    meta: [
      { title: "Solutions — Dataset Setup — FreDA" },
      { name: "description", content: "Pick a dataset, choose your wired sources or upload your own data, select datapoints, set a schedule and launch. A workflow runs behind the scenes." },
      { property: "og:title", content: "Solutions — Dataset Setup — FreDA" },
      { property: "og:description", content: "Configure, upload, wire sources, pick attributes, schedule and launch a dataset in one guided flow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SolutionsPage,
});

const ICONS: Record<string, typeof Boxes> = {
  Building2, Users, GraduationCap, ShoppingCart, Store, Car, Landmark, Plane, Hotel,
  Stethoscope, Scale, ShieldCheck, Newspaper, Globe, Layers, Boxes, UtensilsCrossed,
};

type SetupItem = {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  icon: string;
  refresh: string;
  rows: string;
  coverage?: number;
  accuracy?: number;
  sources: { name: string; url: string; kind?: string; attributes: number }[];
  attributes: { key: string; label: string; group?: string }[];
  origin: "Dataset" | "Industry solution";
};

function fromDataset(d: Dataset): SetupItem {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    tagline: d.tagline,
    description: d.description,
    icon: d.icon,
    refresh: d.refreshDefault,
    rows: d.rowsAvailable,
    ...(d.coverage !== undefined ? { coverage: d.coverage } : {}),
    ...(d.accuracy !== undefined ? { accuracy: d.accuracy } : {}),
    sources: d.sources.map((s) => ({ name: s.name, url: s.url, kind: s.kind ?? "Third-party", attributes: s.attributes })),
    attributes: d.outputAttributes.map((a) => ({ key: a.key, label: a.label, ...(a.group ? { group: a.group } : {}) })),
    origin: "Dataset",
  };
}


const WIZARD_STEPS = ["Configure", "Upload dataset", "Wired sources", "Attributes", "Schedule", "Launch"];
type Cadence = "Daily" | "Weekly" | "Monthly" | "Custom";

function SolutionsPage() {
  const customer = useActiveCustomer();
  const datasets = useMemo(() => DATASETS.map(fromDataset), []);
  const fit = useMemo(() => industryFit(customer.industry), [customer.industry]);
  const relevant = useMemo(() => fit.ids.map((id) => datasets.find((d) => d.id === id)).filter(Boolean) as SetupItem[], [datasets, fit]);

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [scope, setScope] = useState<"fit" | "all">("fit");
  const [active, setActive] = useState<SetupItem | null>(null);

  const pool = scope === "fit" ? relevant : datasets;
  const cats = DATASET_CATEGORIES as string[];

  const list = useMemo(
    () =>
      pool.filter(
        (d) => (cat === "All" || d.category === cat) && (!q.trim() || `${d.name} ${d.tagline} ${d.description}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [pool, cat, q],
  );


  if (active) return <DatasetSetup item={active} onBack={() => setActive(null)} />;

  return (
    <AppLayout>
      <PageHeader
        title="Solutions — Dataset Setup"
        subtitle="Pick a dataset, choose your sources or upload your own data, then select your datapoints. A workflow runs behind the scenes."
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
        <Card className="p-4">
          <Steps steps={WIZARD_STEPS} current={0} />
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <span className="h-8 px-3.5 inline-flex items-center rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium">
            Standard datasets · {datasets.length}
          </span>
          <div className="relative w-full max-w-[280px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search datasets…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="max-w-[180px]" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="All">All categories</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <span className="ml-auto text-[11.5px] text-muted-foreground">
            {list.length} of {pool.length}
          </span>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {list.map((d) => {
            const art = categoryArt(d.category);
            const Icon = ICONS[d.icon] ?? ICONS[art.icon] ?? Boxes;
            return (
              <button key={d.id} onClick={() => setActive(d)} className="text-left group">
                <Card className="h-full flex flex-col overflow-hidden transition group-hover:border-primary/50 group-hover:shadow-lg">
                  <div className={cn("bg-gradient-to-br p-4 text-white", art.gradient)}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="h-9 w-9 rounded-lg bg-white/20 inline-flex items-center justify-center">
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <span className="text-[10.5px] uppercase tracking-wider font-semibold bg-white/20 rounded px-2 py-0.5">{d.category}</span>
                    </div>
                    <div className="text-[14px] font-semibold mt-3 leading-snug">{d.name}</div>
                    <div className="text-[11.5px] text-white/85 mt-0.5">{d.tagline}</div>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3">{d.description}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">
                        <span className="inline-flex items-center gap-1">
                          <Database className="h-3 w-3" /> {d.sources.length} sources
                        </span>
                      </Badge>
                      <Badge tone="neutral">{d.attributes.length} datapoints</Badge>
                      <Badge tone="purple">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {d.refresh}
                        </span>
                      </Badge>
                    </div>
                    <div className="mt-auto pt-3 flex items-center justify-between text-[11.5px]">
                      <span className="text-muted-foreground">{d.rows}</span>
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        Configure <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}

/* ───────────────────────── setup wizard ───────────────────────── */

function DatasetSetup({ item, onBack }: { item: SetupItem; onBack: () => void }) {
  const customer = useActiveCustomer();
  const art = categoryArt(item.category);
  const Icon = ICONS[item.icon] ?? ICONS[art.icon] ?? Boxes;

  const [step, setStep] = useState(0);
  const [name, setName] = useState(`${item.name} — ${customer.shortName}`);
  const [owner, setOwner] = useState("");
  const [intake, setIntake] = useState<IntakeResult | null>(null);
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const [wired, setWired] = useState<string[]>(item.sources.slice(0, Math.min(4, item.sources.length)).map((s) => s.name));
  const [attrs, setAttrs] = useState<string[]>(item.attributes.slice(0, Math.min(12, item.attributes.length)).map((a) => a.key));
  const [cadence, setCadence] = useState<Cadence>((["Daily", "Weekly", "Monthly"].includes(item.refresh) ? item.refresh : "Weekly") as Cadence);
  const [customRule, setCustomRule] = useState("Every 2 weeks · Tuesday 06:00 UTC");
  const [ticketId, setTicketId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const sourceCount = wired.length + extraUrls.filter((u) => u.trim()).length;
  const est = estimate(Math.max(1, sourceCount), Math.max(1, attrs.length), cadence === "Custom" ? "Weekly" : (cadence as Project["frequency"]));
  const scheduleLabel = cadence === "Custom" ? `Custom — ${customRule}` : cadence;

  const groups = useMemo(() => {
    const m = new Map<string, typeof item.attributes>();
    item.attributes.forEach((a) => {
      const g = a.group ?? "Other";
      m.set(g, [...(m.get(g) ?? []), a]);
    });
    return [...m.entries()];
  }, [item]);

  async function readFile(file: File) {
    const text = await file.text();
    const r = readIntakeFile(file.name, text);
    setIntake(r);
    if (r.urls.length) setExtraUrls(r.urls);
  }

  function launch() {
    const t = addTicket({
      workspaceId: customer.id,
      workspaceName: customer.name,
      project: name,
      type: "New project",
      detail: `${item.origin} setup — ${item.name} · ${sourceCount} sources · ${attrs.length} datapoints · ${scheduleLabel}${intake ? ` · from ${intake.fileName}` : ""}`,
      raisedBy: owner.trim() || `${customer.shortName.toLowerCase()} workspace user`,
      estimateDays: est.setupDays,
      monthlyRecords: est.monthlyRecords,
      sources: [...wired, ...extraUrls.filter((u) => u.trim())],
      datapoints: item.attributes.filter((a) => attrs.includes(a.key)).map((a) => a.label),
      frequency: scheduleLabel,
      ...(intake ? { fileName: intake.fileName } : {}),
    });
    setTicketId(t.id);
    setStep(WIZARD_STEPS.length - 1);
  }

  return (
    <AppLayout>
      <PageHeader
        title={item.name}
        subtitle={`${item.origin} · ${item.category} · ${item.rows}`}
        actions={
          <Button size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> All datasets
          </Button>
        }
      />

      <div className="px-7 pb-8 space-y-4">
        <div className={cn("rounded-xl bg-gradient-to-br p-5 text-white", art.gradient)}>
          <div className="flex items-start gap-3">
            <span className="h-11 w-11 rounded-lg bg-white/20 inline-flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">{item.name}</div>
              <p className="text-[12.5px] text-white/85 mt-1 max-w-3xl leading-relaxed">{item.description}</p>
              <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
                <span className="rounded bg-white/20 px-2 py-0.5">{item.sources.length} wired sources</span>
                <span className="rounded bg-white/20 px-2 py-0.5">{item.attributes.length} attributes</span>
                <span className="rounded bg-white/20 px-2 py-0.5">Default {item.refresh}</span>
                {item.coverage !== undefined && <span className="rounded bg-white/20 px-2 py-0.5">{item.coverage}% coverage</span>}
                {item.accuracy !== undefined && <span className="rounded bg-white/20 px-2 py-0.5">{item.accuracy}% accuracy</span>}
              </div>
            </div>
          </div>
        </div>

        <Card className="p-4">
          <Steps steps={WIZARD_STEPS} current={step} />
        </Card>

        <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
          <Card className="p-5 min-h-[380px] flex flex-col">
            {step === 0 && (
              <div className="space-y-3">
                <SectionTitle hint="name it and assign an owner">Configure</SectionTitle>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <Label>Project name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label>Business owner</Label>
                    <Input placeholder="name@company.com" value={owner} onChange={(e) => setOwner(e.target.value)} />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-3.5 text-[12px] text-muted-foreground leading-relaxed">
                  A workflow runs behind the scenes: crawl → extract → normalise → validate → dedupe → publish. You only choose the sources, the datapoints and how often
                  it should run — FreDA admin builds and onboards the bots, then the data lands in your workspace for review and refresh.
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <SectionTitle hint="optional — bring your own entity list">Upload dataset</SectionTitle>
                <div onClick={() => fileRef.current?.click()} className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-6 text-center cursor-pointer hover:bg-primary/10 transition">
                  <Upload className="h-6 w-6 mx-auto text-primary" />
                  <div className="text-[13px] font-medium mt-2">Upload your source / entity list</div>
                  <div className="text-[11.5px] text-muted-foreground">CSV, TSV or TXT — FreDA AI reads the file, extracts source URLs and datapoint columns</div>
                  <input ref={fileRef} type="file" className="hidden" accept=".csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
                </div>
                {intake && (
                  <div className="rounded-lg border border-info/30 bg-info-bg px-3 py-2.5 text-[11.5px] text-info space-y-1">
                    <div className="font-medium inline-flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5" /> {intake.fileName} — {intake.confidence}% read confidence
                    </div>
                    {intake.notes.map((n) => (
                      <div key={n}>· {n}</div>
                    ))}
                  </div>
                )}
                <p className="text-[11.5px] text-muted-foreground">No file? Skip this step — FreDA runs the dataset against its own wired sources.</p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <SectionTitle hint={`${wired.length} of ${item.sources.length} selected`}>Wired sources</SectionTitle>
                <div className="grid md:grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
                  {item.sources.map((s) => {
                    const on = wired.includes(s.name);
                    return (
                      <button
                        key={s.name}
                        onClick={() => setWired((w) => (on ? w.filter((x) => x !== s.name) : [...w, s.name]))}
                        className={cn("rounded-lg border p-3 text-left transition", on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary")}
                      >
                        <div className="flex items-center gap-2">
                          <Globe className={cn("h-3.5 w-3.5 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                          <span className="text-[12.5px] font-medium truncate">{s.name}</span>
                          {on && <CheckCircle2 className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 truncate">{s.url}</div>
                        <div className="text-[10.5px] text-muted-foreground mt-1">
                          {s.kind} · {s.attributes} attributes
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div>
                  <Label>Your own source URLs · {extraUrls.length}</Label>
                  <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                    {extraUrls.map((u, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input placeholder="https://source.example.com" value={u} onChange={(e) => setExtraUrls(extraUrls.map((x, k) => (k === i ? e.target.value : x)))} />
                        <button onClick={() => setExtraUrls(extraUrls.filter((_, k) => k !== i))} className="h-9 w-9 shrink-0 rounded-md border border-border inline-flex items-center justify-center hover:bg-secondary">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setExtraUrls([...extraUrls, ""])}>
                    <Plus className="h-3.5 w-3.5" /> Add source URL
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionTitle hint={`${attrs.length} of ${item.attributes.length} selected`}>Attributes</SectionTitle>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAttrs(item.attributes.map((a) => a.key))}>
                      Select all
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAttrs([])}>
                      <X className="h-3.5 w-3.5" /> Clear
                    </Button>
                  </div>
                </div>
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {groups.map(([g, items]) => (
                    <div key={g}>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{g}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((a) => {
                          const on = attrs.includes(a.key);
                          return (
                            <button
                              key={a.key}
                              onClick={() => setAttrs((x) => (on ? x.filter((k) => k !== a.key) : [...x, a.key]))}
                              className={cn("h-7 px-2.5 rounded-md border text-[11.5px] font-medium transition", on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary")}
                            >
                              {a.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <SectionTitle hint="you control the cadence">Schedule</SectionTitle>
                <div className="grid md:grid-cols-4 gap-2">
                  {(["Daily", "Weekly", "Monthly", "Custom"] as Cadence[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCadence(c)}
                      className={cn("rounded-lg border p-3 text-left transition", cadence === c ? "border-primary bg-primary/5" : "border-border hover:bg-secondary")}
                    >
                      <CalendarClock className={cn("h-4 w-4", cadence === c ? "text-primary" : "text-muted-foreground")} />
                      <div className="text-[12.5px] font-medium mt-1.5">{c}</div>
                    </button>
                  ))}
                </div>
                {cadence === "Custom" && (
                  <div>
                    <Label>Custom cadence rule</Label>
                    <Input value={customRule} onChange={(e) => setCustomRule(e.target.value)} />
                  </div>
                )}
                <div className="rounded-lg border border-border bg-secondary/30 p-3.5 text-[12px] text-muted-foreground">
                  Runs start after admin approves and onboards the bots. You can change the cadence at any time from Agents.
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-3">
                <SectionTitle hint="hand-off to your FreDA admin">Launch</SectionTitle>
                {ticketId ? (
                  <div className="rounded-lg border border-success/40 bg-success-bg p-4 text-[12.5px] text-success space-y-1">
                    <div className="font-semibold inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" /> Submitted as {ticketId}
                    </div>
                    <div>Admin approves the request, builds and onboards the bots, then the dataset appears in your workspace to review and refresh.</div>
                    <Link to="/requests" className="inline-block pt-1 underline">
                      Track it in the request tracker
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Summary label="Project" value={name} />
                    <Summary label="Sources" value={`${sourceCount} selected`} />
                    <Summary label="Datapoints" value={`${attrs.length} attributes`} />
                    <Summary label="Schedule" value={scheduleLabel} />
                    {intake && <Summary label="Uploaded file" value={intake.fileName} />}
                    <Button className="w-full mt-2" onClick={launch} disabled={!name.trim() || attrs.length === 0}>
                      <Rocket className="h-4 w-4" /> Launch & send to admin
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto pt-5 flex items-center justify-between">
              <Button size="sm" variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              {step < WIZARD_STEPS.length - 1 ? (
                <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <span className="text-[11.5px] text-muted-foreground">Step {step + 1} of {WIZARD_STEPS.length}</span>
              )}
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Live estimate
            </div>
            <Est label="Setup" value={`${est.setupDays} days`} />
            <Est label="First run" value={`${est.firstRunHrs} hrs`} />
            <Est label="Records / mo" value={fmt(est.monthlyRecords)} />
            <div className="pt-1 space-y-1 text-[11.5px] text-muted-foreground">
              <div>{sourceCount} sources · {attrs.length} datapoints</div>
              <div>{scheduleLabel} refresh</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-[11px] text-muted-foreground leading-relaxed">
              Next steps: admin approves → bots built and onboarded → first run QA → dataset published to your workspace for review, monitoring and refresh.
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

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}
