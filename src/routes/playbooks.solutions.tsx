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
  Gavel,
  GraduationCap,
  Globe,
  Hotel,
  Landmark,
  Layers,
  Leaf,
  Newspaper,
  Plane,
  Plus,
  RefreshCw,
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
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import { AppLayout, WorkspaceLoadingFallback } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle, Select, Steps } from "@/components/ui-bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActiveCustomer, useMounted } from "@/lib/workspace";
import { readIntakeFile, type IntakeResult } from "@/lib/ai-intake";
import { launchSelfServiceProject, launchDirectoryProject } from "@/lib/custom-projects";
import { estimate, fmt, type Project } from "@/data/customers";
import { DATASETS, DATASET_CATEGORIES, type Dataset } from "@/data/datasets";
import { categoryArt } from "@/data/category-art";
import { industryFit } from "@/lib/industry-datasets";
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
  Leaf, Gavel,
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
  screenshot?: string;
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
    ...(d.screenshot ? { screenshot: d.screenshot } : {}),
  };
}


const WIZARD_STEPS = ["Upload dataset", "Configure", "Wired sources", "Attributes", "Schedule", "Launch"];
type Cadence = "Daily" | "Weekly" | "Monthly" | "Custom";

function SolutionsPage() {
  const mounted = useMounted();
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


  if (!mounted) return <WorkspaceLoadingFallback />;

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
          <div className="inline-flex items-center rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setScope("fit")}
              className={cn("h-8 px-3.5 text-[11.5px] font-medium", scope === "fit" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
            >
              For {customer.industry} · {relevant.length}
            </button>
            <button
              onClick={() => setScope("all")}
              className={cn("h-8 px-3.5 text-[11.5px] font-medium border-l border-border", scope === "all" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
            >
              All datasets · {datasets.length}
            </button>
          </div>
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

        {scope === "fit" ? (
          <Card className="p-3.5 flex items-start gap-2.5">
            <span className="h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Shortlisted for {customer.name}.</span> {fit.why} Need something else? Switch to all datasets or ask FreDA to raise a build request.
            </p>
          </Card>
        ) : null}

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
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [name, setName] = useState(`${item.name} — ${customer.shortName}`);
  const [intake, setIntake] = useState<IntakeResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const [directoryMode, setDirectoryMode] = useState(false);
  const [wired, setWired] = useState<string[]>(item.sources.slice(0, Math.min(4, item.sources.length)).map((s) => s.name));
  const [attrs, setAttrs] = useState<string[]>(item.attributes.slice(0, Math.min(12, item.attributes.length)).map((a) => a.key));
  const [cadence, setCadence] = useState<Cadence>((["Daily", "Weekly", "Monthly"].includes(item.refresh) ? item.refresh : "Weekly") as Cadence);
  const [customRule, setCustomRule] = useState("Every 2 weeks · Tuesday 06:00 UTC");
  const [launchedProject, setLaunchedProject] = useState<Project | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchFetchErrors, setLaunchFetchErrors] = useState<{ entity: string; error: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const entityUrlCount = extraUrls.filter((u) => u.trim()).length;
  const sourceCount = wired.length + entityUrlCount;
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
    setReadError(null);
    try {
      const text = await file.text();
      const r = readIntakeFile(file.name, text);
      setIntake(r);
      if (r.urls.length) setExtraUrls(r.urls);
    } catch (err) {
      setReadError(
        `Couldn't read "${file.name}" as text — try a CSV, TSV or TXT export instead of a binary file (e.g. .xlsx or .docx).`,
      );
      console.error("Failed to read intake file:", err);
    }
  }

  async function launch() {
    // Catalog datasets are self-service: no admin ticket, no wait — this
    // provisions the project directly into the workspace right now, using
    // the customer's own uploaded/typed entity URLs and chosen attributes.
    // It re-checks live via the same generic AI webpage-read engine
    // NTM/ESG already use (see custom-projects.ts), not a bespoke script.
    // A genuinely new/custom request (not one of these datasets) still
    // goes through the ticket flow — that's Agents' "add source" and the
    // Dashboard's "+ New project", both unchanged.
    const dataset = DATASETS.find((d) => d.id === item.id);
    if (!dataset) return;
    const urls = extraUrls.filter((u) => u.trim());

    if (!directoryMode) {
      const project = launchSelfServiceProject({
        customerId: customer.id,
        projectName: name,
        dataset,
        entityUrls: urls,
        selectedAttributeKeys: attrs,
        selectedSourceNames: wired,
        cadence,
      });
      setLaunchedProject(project);
      setStep(WIZARD_STEPS.length - 1);
      return;
    }

    // Directory mode does the first real extraction now (a genuine fetch +
    // AI read of each directory page), so this can take a while — up to a
    // couple of minutes for a large real directory.
    setLaunching(true);
    setLaunchError(null);
    try {
      const { project, fetchErrors } = await launchDirectoryProject({
        customerId: customer.id,
        projectName: name,
        dataset,
        directoryUrls: urls,
        selectedAttributeKeys: attrs,
        cadence,
      });
      setLaunchedProject(project);
      setLaunchFetchErrors(fetchErrors);
      setStep(WIZARD_STEPS.length - 1);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
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
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[15px] font-semibold">{item.name}</div>
                {item.screenshot && (
                  <button
                    onClick={() => setWorkflowOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-2.5 py-0.5 text-[11px] font-medium transition"
                  >
                    <WorkflowIcon className="h-3 w-3" /> Click here to view the workflow
                  </button>
                )}
              </div>
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

        {item.screenshot && (
          <Dialog open={workflowOpen} onOpenChange={setWorkflowOpen}>
            <DialogContent className="max-w-none w-[90vw] h-[88vh] p-0 gap-0 overflow-hidden flex flex-col sm:max-w-none">
              <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
                <DialogTitle className="text-[16px]">{item.name} — Workflow</DialogTitle>
                <p className="text-[12px] text-muted-foreground mt-1">
                  What runs behind the scenes when this dataset is wired up and refreshed.
                </p>
              </DialogHeader>
              <div className="flex-1 min-h-0 overflow-auto bg-secondary/30 p-6 flex items-center justify-center">
                <img
                  src={item.screenshot}
                  alt={`${item.name} workflow diagram`}
                  className="max-w-full h-auto rounded-lg border border-border shadow-sm"
                />
              </div>
            </DialogContent>
          </Dialog>
        )}

        <Card className="p-4">
          <Steps steps={WIZARD_STEPS} current={step} />
        </Card>

        <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
          <Card className="p-5 min-h-[380px] flex flex-col">
            {step === 0 && (
              <div className="space-y-3">
                <SectionTitle hint="bring your own entity list">Upload dataset</SectionTitle>
                <div onClick={() => fileRef.current?.click()} className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-6 text-center cursor-pointer hover:bg-primary/10 transition">
                  <Upload className="h-6 w-6 mx-auto text-primary" />
                  <div className="text-[13px] font-medium mt-2">Upload your source / entity list</div>
                  <div className="text-[11.5px] text-muted-foreground">CSV, TSV or TXT — FreDA AI reads the file, extracts source URLs and datapoint columns</div>
                  <input ref={fileRef} type="file" className="hidden" accept=".csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
                </div>
                {readError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[11.5px] text-destructive">
                    {readError}
                  </div>
                )}
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
                <p className="text-[11.5px] text-muted-foreground">
                  No file? Add entity URLs manually on the next step instead — this is what Run actually re-checks, so at least one is needed for live data.
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <SectionTitle hint="name it">Configure</SectionTitle>
                <div>
                  <Label>Project name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-3.5 text-[12px] text-muted-foreground leading-relaxed">
                  A workflow runs behind the scenes: crawl → extract → normalise → validate → dedupe → publish. Pick your entity URLs, the datapoints and
                  how often it should run, then launch — the project appears in Monitor and Review immediately, no approval needed.
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <SectionTitle hint={`${wired.length} of ${item.sources.length} selected`}>Wired sources</SectionTitle>
                <div className="rounded-lg border border-border bg-secondary/30 p-3 text-[11.5px] text-muted-foreground leading-relaxed">
                  Each entity's own website is always checked as the default source. The other sources below (LinkedIn, Crunchbase, SEC EDGAR, etc.) aren't
                  independently fetched in this build — no API access to those platforms yet — but selecting the ones relevant to what you're tracking does
                  change which pages on the entity's <em>own</em> site get pulled in (e.g. selecting a Financials source steers it toward an Investors page).
                  Fields that genuinely only live on an external platform will stay blank until that source is wired in for real.
                </div>
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
                <button
                  onClick={() => setDirectoryMode((v) => !v)}
                  className={cn(
                    "w-full flex items-start gap-2.5 rounded-lg border p-3 text-left transition",
                    directoryMode ? "border-primary bg-primary/5" : "border-border hover:bg-secondary",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center",
                      directoryMode ? "bg-primary border-primary" : "border-border",
                    )}
                  >
                    {directoryMode && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                  </span>
                  <span>
                    <span className="block text-[12.5px] font-medium">These are directory / listing pages</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      Turn on when each URL below is a page that lists many companies or people (a business directory, a member list) — Run will pull out
                      every entity that page actually names, instead of treating each URL as one company. Takes longer (real extraction, not instant).
                    </span>
                  </span>
                </button>
                <div>
                  <Label>{directoryMode ? "Directory URLs" : "Your own entity URLs"} · {extraUrls.length}</Label>
                  <p className="text-[11px] text-muted-foreground -mt-1 mb-2">
                    {directoryMode
                      ? 'These are what "Run" actually re-scrapes live — every company/person each page names becomes its own row.'
                      : 'These are what "Run" actually re-checks live — one row per URL (e.g. each company\'s own website).'}
                  </p>
                  <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                    {extraUrls.map((u, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          placeholder={directoryMode ? "https://example.com/directory" : "https://source.example.com"}
                          value={u}
                          onChange={(e) => setExtraUrls(extraUrls.map((x, k) => (k === i ? e.target.value : x)))}
                        />
                        <button onClick={() => setExtraUrls(extraUrls.filter((_, k) => k !== i))} className="h-9 w-9 shrink-0 rounded-md border border-border inline-flex items-center justify-center hover:bg-secondary">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setExtraUrls([...extraUrls, ""])}>
                    <Plus className="h-3.5 w-3.5" /> Add {directoryMode ? "directory" : "source"} URL
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
                  This just sets the label shown in Monitor — nothing runs automatically on a timer yet, so click "Run now" there whenever you want fresh data. You can change the cadence at any time from Agents.
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-3">
                <SectionTitle hint="live in your workspace immediately, no approval needed">Launch</SectionTitle>
                {launching ? (
                  <div className="rounded-lg border border-border bg-secondary/30 p-4 text-[12.5px] text-muted-foreground flex items-center gap-2.5">
                    <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                    Extracting real data from {entityUrlCount} directory {entityUrlCount === 1 ? "page" : "pages"} — pulling out every company/person each
                    one names can take a minute or two for a large directory. Don&apos;t close this.
                  </div>
                ) : launchedProject ? (
                  <div className="rounded-lg border border-success/40 bg-success-bg p-4 text-[12.5px] text-success space-y-1">
                    <div className="font-semibold inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" /> {launchedProject.name} is live in your workspace
                    </div>
                    <div>
                      {directoryMode
                        ? launchedProject.records > 0
                          ? `Found ${fmt(launchedProject.records)} real ${launchedProject.records === 1 ? "entry" : "entries"} across your directory pages — already in Review, ready to approve.`
                          : "No entries were found on those pages — double-check the URLs actually list companies/people, or that they're reachable."
                        : launchedProject.records > 0
                          ? `Go to Monitor and click "Run now" to fetch real data for the ${launchedProject.records} ${launchedProject.records === 1 ? "entity" : "entities"} you added.`
                          : "No entity URLs were added, so there's nothing to run yet — open Agents on this project to add some, then Run from Monitor."}
                    </div>
                    {launchFetchErrors.length > 0 && (
                      <div className="pt-1 text-warning">
                        {launchFetchErrors.length} page(s) had an issue: {launchFetchErrors.map((f) => f.error).slice(0, 2).join("; ")}
                      </div>
                    )}
                    <div className="flex items-center gap-3 pt-1">
                      <Link to="/monitoring" className="inline-block underline">
                        Go to Monitor
                      </Link>
                      <Link to="/" className="inline-block underline">
                        Go to Dashboard
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Summary label="Project" value={name} />
                    <Summary label={directoryMode ? "Directory URLs" : "Entity URLs"} value={`${entityUrlCount} added`} />
                    <Summary label="Datapoints" value={`${attrs.length} attributes`} />
                    <Summary label="Schedule" value={scheduleLabel} />
                    {intake && <Summary label="Uploaded file" value={intake.fileName} />}
                    {entityUrlCount === 0 && (
                      <div className="rounded-lg border border-warning/40 bg-warning-bg px-3 py-2.5 text-[11.5px] text-warning">
                        Add at least one {directoryMode ? "directory" : "entity"} URL (Upload dataset, or type one in on the Wired sources step) — that's
                        what "Run" actually fetches. Without one, there's nothing to launch.
                      </div>
                    )}
                    {launchError && (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[11.5px] text-destructive">
                        Launch failed: {launchError}
                      </div>
                    )}
                    <Button className="w-full mt-2" onClick={() => void launch()} disabled={!name.trim() || attrs.length === 0 || entityUrlCount === 0}>
                      <Rocket className="h-4 w-4" /> Launch now
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto pt-5 flex items-center justify-between">
              <Button size="sm" variant="outline" disabled={step === 0 || launching} onClick={() => setStep((s) => Math.max(0, s - 1))}>
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
              Next steps: launch → project appears in Monitor right away → click "Run now" to fetch real data → review and download from there. No admin approval in this flow.
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
