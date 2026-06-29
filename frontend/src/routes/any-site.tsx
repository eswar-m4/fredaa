import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, Select, Steps } from "@/components/ui-bits";
import { DATASETS, DATASET_CATEGORIES, type Dataset } from "@/data/datasets";
import {
  ArrowRight,
  Upload,
  Sparkles,
  CheckCircle2,
  Search,
  FileSpreadsheet,
  Database,
  ChevronRight,
  Download,
  Globe,
} from "lucide-react";
import * as Icons from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/any-site")({
  head: () => ({ meta: [{ title: "By Dataset – Field Mapping – FreshData AI" }] }),
  component: AnySite,
});

const STEPS = ["Pick Dataset", "Pick Source & Map Fields", "Schedule & Launch"];

type Mapping = Record<string, string>; // system attr key -> user column

function AnySite() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const ds = useMemo(() => DATASETS.find((d) => d.id === datasetId) || null, [datasetId]);

  // Step 2 state
  const [sourceMode, setSourceMode] = useState<"upload" | "sources">("upload");
  const [pickedSources, setPickedSources] = useState<string[]>([]);
  const [seedFile, setSeedFile] = useState<string | null>(null);
  const [seedHeaders, setSeedHeaders] = useState<string[]>([]);
  const [seedRecords, setSeedRecords] = useState<Record<string, string>[]>([]);
  const [seedRows, setSeedRows] = useState<number>(0);
  const [seedColumnCount, setSeedColumnCount] = useState<number>(0);
  const [detectedRegion, setDetectedRegion] = useState<string>("Auto");
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});

  // Step 3
  const [frequency, setFrequency] = useState("Weekly");
  const [customCron, setCustomCron] = useState("0 6 * * 1");
  const [delivery, setDelivery] = useState("S3 bucket");
  const [format, setFormat] = useState("JSON");

  const filtered = DATASETS.filter((d) => {
    if (cat !== "All" && d.category !== cat) return false;
    if (q) {
      const s = q.toLowerCase();
      return (
        d.name.toLowerCase().includes(s) ||
        d.tagline.toLowerCase().includes(s) ||
        d.description.toLowerCase().includes(s) ||
        d.category.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const baseApiUrl = (() => {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port !== "8131"
    ) {
      return `http://${window.location.hostname}:8131`;
    }
    return "";
  })();

  function defaultSources(d: Dataset, region: string): string[] {
    // Always include "target / company website" type sources
    const targets = d.sources.filter((s) => /target|auto-derived/i.test(s.url) || /company website|target/i.test(s.name));
    const globals = d.sources.filter((s) => !s.region);
    let regional: typeof d.sources = [];
    if (region !== "Auto" && region !== "Global") {
      regional = d.sources.filter((s) => s.region === region);
    } else if (region === "Auto") {
      // Without detected region, prefer global + top wired
      regional = d.sources.filter((s) => s.region).slice(0, 3);
    }
    const picked = new Set<string>();
    [...targets, ...regional, ...globals].forEach((s) => picked.add(s.name));
    return Array.from(picked);
  }

  function pickDataset(d: Dataset) {
    setDatasetId(d.id);
    setSelectedOutputs(d.outputAttributes.map((o) => o.key));
    setPickedSources(defaultSources(d, "Auto"));
    setFrequency(d.refreshDefault);
    setMapping({});
    setSeedFile(null);
    setSeedHeaders([]);
    setSeedRecords([]);
    setSeedRows(0);
    setSeedColumnCount(0);
    setDetectedRegion("Auto");
    setSourceMode("upload");
    setStep(1);
  }

  function toggleOutput(k: string) {
    setSelectedOutputs((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  }
  function toggleSource(name: string) {
    setPickedSources((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  }

  function detectRegionFromHeaders(sampleText: string, headers: string[]): string {
    const sample = (sampleText.slice(0, 5000) + " " + headers.join(" ")).toLowerCase();
    if (/\bus\b|united states|usa|california|new york|texas|\bcorp\b|sec\.gov/.test(sample)) return "US";
    if (/\buk\b|united kingdom|england|london|companies house/.test(sample)) return "UK";
    if (/\bindia\b|\bin\b|mumbai|delhi|bangalore|mca|cin|bse|nse/.test(sample)) return "IN";
    if (/germany|deutsch|berlin|gmbh/.test(sample)) return "DE";
    if (/france|paris|sarl|sas/.test(sample)) return "FR";
    if (/australia|sydney|melbourne|asic/.test(sample)) return "AU";
    if (/singapore|acra|sgx/.test(sample)) return "SG";
    return "Global";
  }

  async function handleSeedFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSeedFile(f.name);
    try {
      const formData = new FormData();
      formData.append("file", f);

      const response = await fetch(`${baseApiUrl}/api/v1/workflows/parse-file`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`File parsing failed (${response.status})`);
      }

      const parsed = await response.json();
      const headers = Array.isArray(parsed.columns) ? parsed.columns.map((h: unknown) => String(h)) : [];
      const previewRows = Array.isArray(parsed.sample) ? parsed.sample : [];
      const records = Array.isArray(parsed.records) ? parsed.records : previewRows;
      const normalizedRecords = records.map((row: any) => {
        if (!row || typeof row !== "object") return {};
        return Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]),
        ) as Record<string, string>;
      });
      const rowCount = Number(parsed.row_count ?? 0) || 0;
      const columnCount = Number(parsed.column_count ?? headers.length) || headers.length;
      const previewText = JSON.stringify(previewRows[0] || {});

      setSeedHeaders(headers);
      setSeedRecords(normalizedRecords);
      setSeedRows(rowCount);
      setSeedColumnCount(columnCount);

      if (ds) {
        const detected = detectRegionFromHeaders(previewText, headers);
        setDetectedRegion(detected);
        setPickedSources(defaultSources(ds, detected));
        // Auto-map headers by exact/label match first, then ask the backend for unresolved headers only.
        const exactMappings: Mapping = {};
        ds.outputAttributes.forEach((a) => {
          const m = headers.find(
            (h) =>
              h.toLowerCase().replace(/[^a-z0-9]+/g, "") === a.key.replace(/_/g, "") ||
              h.toLowerCase() === a.label.toLowerCase(),
          );
          if (m) exactMappings[a.key] = m;
        });
        setMapping(exactMappings);

        const unresolvedHeaders = headers.filter((h) => !Object.values(exactMappings).includes(h));
        if (unresolvedHeaders.length > 0) {
          try {
            const mappingResponse = await fetch(`${baseApiUrl}/api/v1/workflows/field-mapping-suggestions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input_headers: unresolvedHeaders,
                superset_fields: ds.outputAttributes.map((a) => a.key),
              }),
            });

            if (mappingResponse.ok) {
              const suggestion = await mappingResponse.json();
              const mappings = Array.isArray(suggestion?.mappings) ? suggestion.mappings : [];
              setMapping((prev) => {
                const next = { ...prev };
                for (const row of mappings) {
                  if (!row || typeof row !== "object") continue;
                  const inputHeader = String((row as any).input_header || "").trim();
                  const mappedField = String((row as any).mapped_field || "").trim();
                  if (!inputHeader || !mappedField) continue;
                  if (next[mappedField]) continue;
                  if (!unresolvedHeaders.includes(inputHeader)) continue;
                  next[mappedField] = inputHeader;
                }
                return next;
              });
            }
          } catch (mappingErr) {
            console.warn("Backend field mapping suggestions failed:", mappingErr);
          }
        }
      }
    } catch (err) {
      console.error("Failed to parse uploaded file via backend:", err);
      toast.error("File parsing failed. Please try again.");
      setSeedHeaders([]);
      setSeedRecords([]);
      setSeedRows(0);
      setSeedColumnCount(0);
    }
  }

  function downloadSample(kind: "csv" | "json", name: string) {
    if (!ds) return;
    const cols = ds.outputAttributes.slice(0, 8).map((a) => a.key);
    const rows = Array.from({ length: 8 }).map((_, i) => {
      const obj: Record<string, any> = {};
      cols.forEach((c) => (obj[c] = (ds.sampleRow as any)[c] ?? `${c}_${i + 1}`));
      return obj;
    });
    const content =
      kind === "csv"
        ? [cols.join(","), ...rows.map((r) => cols.map((c) => r[c]).join(","))].join("\n")
        : JSON.stringify(rows, null, 2);
    const blob = new Blob([content], { type: kind === "csv" ? "text/csv" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.toLowerCase().replace(/\s+/g, "-")}-sample.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${a.download}`);
  }

  async function handleLaunch(): Promise<boolean> {
    if (!ds) return false;

    const filters = JSON.stringify({
      selectedOutputs,
      mapping,
      pickedSources,
      seedRows,
      frequency,
      customCron,
      delivery,
      format,
      sourceMode,
      detectedRegion,
      seedFile,
    });

    const job = {
      id: `J-${Date.now()}`,
      source: ds.name,
      scope: "Custom Dump",
      filters,
      frequency,
      delivery,
      output_format: format,
      isCustomSource: false,
      mode: "Any-Site",
      input_data: seedRecords.length > 0 ? seedRecords : undefined,
    };

    try {
      const launchRequest = fetch(`${baseApiUrl}/api/v1/demo/jobs/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: [job] }),
      });

      const response = await launchRequest;

      if (!response.ok) {
        toast.error("Launch failed. Backend rejected the request.");
        return false;
      }
      return true;
    } catch (err) {
      console.error("Failed to launch dataset job:", err);
      toast.error("Launch failed. Could not reach backend.");
      return false;
    }
  }

  return (
    <AppLayout>
      <PageHeader
        title="By Dataset — Field Mapping"
        subtitle="Pick a dataset, choose your sources or upload your own data, then map fields to our standard schema. A workflow runs behind the scenes."
        actions={
          <Link to="/site-specific">
            <Button variant="ghost" size="sm">← Switch to By Source</Button>
          </Link>
        }
      />

      <div className="px-7 pb-8 space-y-6">
        <Card className="p-4">
          <Steps steps={STEPS} current={step} />
        </Card>

        {step === 0 && (
          <>
            <Card className="p-4">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Search ${DATASETS.length} dataset schemas…`}
                    className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
                  />
                </div>
                <Select value={cat} onChange={(e) => setCat(e.target.value)} className="lg:w-56">
                  <option value="All">All categories</option>
                  {DATASET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((d) => {
                const Icon = (Icons as any)[d.icon] || Database;
                return (
                  <button
                    key={d.id}
                    onClick={() => pickDataset(d)}
                    className="text-left p-4 rounded-lg border border-border bg-card hover:bg-secondary/40 hover:border-primary/40 transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-md bg-info-bg text-info inline-flex items-center justify-center shrink-0">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-[14px] truncate">{d.name}</h3>
                          <Badge tone="purple">{d.category}</Badge>
                        </div>
                        <p className="text-[12px] text-muted-foreground mt-0.5">{d.tagline}</p>
                      </div>
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-3 line-clamp-2">{d.description}</p>
                    <div className="grid grid-cols-4 gap-1.5 mt-3 text-[11px]">
                      <Mini label="Data pts" value={d.outputAttributes.length} />
                      <Mini label="Sources" value={d.sources.length} />
                      <Mini label="Accuracy" value={d.accuracy ? `${d.accuracy}%` : "—"} />
                      <Mini label="Countries" value={d.countriesCovered ?? "—"} />
                    </div>
                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">{d.rowsAvailable}{d.coverage ? ` · ${d.coverage}% coverage` : ""}</span>
                      <span className="inline-flex items-center gap-1 text-[12px] text-info font-medium">
                        Configure <ChevronRight className="h-3 w-3" />
                      </span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <Card className="p-6 col-span-full text-center text-[13px] text-muted-foreground">
                  No datasets match your filters.
                </Card>
              )}
            </div>
          </>
        )}

        {step === 1 && ds && (
          <MapStep
            ds={ds}
            sourceMode={sourceMode}
            setSourceMode={setSourceMode}
            pickedSources={pickedSources}
            toggleSource={toggleSource}
            setPickedSources={setPickedSources}
            defaultSources={defaultSources}
            detectedRegion={detectedRegion}
            setDetectedRegion={setDetectedRegion}
            seedFile={seedFile}
            seedHeaders={seedHeaders}
            seedRows={seedRows}
            seedColumnCount={seedColumnCount}
            handleSeedFile={handleSeedFile}
            selectedOutputs={selectedOutputs}
            toggleOutput={toggleOutput}
            mapping={mapping}
            setMapping={setMapping}
            downloadSample={downloadSample}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && ds && (
          <LaunchStep
            ds={ds}
            selectedOutputs={selectedOutputs}
            pickedSources={pickedSources}
            seedFile={seedFile}
            seedRows={seedRows}
            frequency={frequency}
            setFrequency={setFrequency}
            customCron={customCron}
            setCustomCron={setCustomCron}
            delivery={delivery}
            setDelivery={setDelivery}
            format={format}
            setFormat={setFormat}
            onBack={() => setStep(1)}
            onLaunch={handleLaunch}
            navigateToMonitoring={() => navigate({ to: "/monitoring" })}
          />
        )}
      </div>
    </AppLayout>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded bg-secondary/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[12px] font-semibold">{value}</div>
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 ${className || ""}`}>
      {children}
    </div>
  );
}

/* ───────── Step 2: pick source + map fields ───────── */
function MapStep(p: {
  ds: Dataset;
  sourceMode: "upload" | "sources";
  setSourceMode: (m: "upload" | "sources") => void;
  pickedSources: string[];
  toggleSource: (n: string) => void;
  setPickedSources: (v: string[]) => void;
  defaultSources: (d: Dataset, region: string) => string[];
  detectedRegion: string;
  setDetectedRegion: (r: string) => void;
  seedFile: string | null;
  seedHeaders: string[];
  seedRows: number;
  seedColumnCount: number;
  handleSeedFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedOutputs: string[];
  toggleOutput: (k: string) => void;
  mapping: Mapping;
  setMapping: (m: Mapping) => void;
  downloadSample: (kind: "csv" | "json", name: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { ds } = p;
  const grouped = useMemo(() => {
    const g: Record<string, typeof ds.outputAttributes> = {};
    ds.outputAttributes.forEach((a) => {
      const k = a.group || "General";
      (g[k] ||= []).push(a);
    });
    return g;
  }, [ds]);

  // Categorize sources by kind (Company website, Registry, Stock exchange, Govt website, News & Media, Directory, Other)
  function categorizeSource(s: { name: string; url: string }): string {
    const blob = `${s.name} ${s.url}`.toLowerCase();
    if (/target|auto-derived|company website/.test(blob)) return "Company website (default)";
    if (/sec edgar|nse|bse|sgx|asx|hkex|nyse|nasdaq|stock exchange|bourse|borsa|euronext/.test(blob)) return "Stock exchange";
    if (/companies house|mca|acra|asic|opencorporates|registrar|registry|handelsregister|kbo|sirene|sayari/.test(blob)) return "Registry";
    if (/\.gov|gov\.|ftc|irs|cbp|state\.|ministry|municipal|census|gazette/.test(blob)) return "Govt website";
    if (/news|press|reuters|bloomberg|cnbc|techcrunch|prnewswire|media/.test(blob)) return "News & Media";
    if (/yelp|glassdoor|yellowpages|google business|crunchbase|linkedin|tripadvisor|directory|listing/.test(blob)) return "Directory";
    return "Other";
  }

  const CATEGORY_ORDER = ["Company website (default)", "Registry", "Stock exchange", "Govt website", "News & Media", "Directory", "Other"];

  const sourceGroups = useMemo(() => {
    const g: Record<string, typeof ds.sources> = {};
    ds.sources.forEach((s) => {
      const cat = categorizeSource(s);
      (g[cat] ||= []).push(s);
    });
    return CATEGORY_ORDER.filter((c) => g[c]?.length).map((c) => [c, g[c]] as const);
  }, [ds]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // Collapsed by default — user expands a group only if they want to tweak it.
    // "Company website (default)" stays open so the default source is visible.
    const init: Record<string, boolean> = {};
    CATEGORY_ORDER.forEach((c) => (init[c] = c === "Company website (default)"));
    return init;
  });

  function toggleGroup(name: string) {
    setOpenGroups((s) => ({ ...s, [name]: !s[name] }));
  }

  function selectGroup(arr: typeof ds.sources, on: boolean) {
    const names = arr.map((s) => s.name);
    const next = on
      ? Array.from(new Set([...p.pickedSources, ...names]))
      : p.pickedSources.filter((n) => !names.includes(n));
    p.setPickedSources(next);
  }

  function submitSources() {
    if (p.pickedSources.length === 0) {
      toast.error("Pick at least one source to continue");
      return;
    }
    toast.success(`${p.pickedSources.length} source${p.pickedSources.length === 1 ? "" : "s"} submitted`);
  }

  const wiredCount = ds.sources.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="font-semibold text-[16px]">{ds.name} — pick a source</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Use a wired source we already maintain, upload your own dataset, or just refresh existing rows. Workflow runs automatically.
            </p>
          </div>
          <Badge tone="info">{wiredCount} sources wired</Badge>
        </div>

        {/* Two mode-selector cards (like screenshot) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => p.setSourceMode("upload")}
            className={`text-left p-4 rounded-lg border transition ${
              p.sourceMode === "upload"
                ? "border-primary bg-info-bg/40 ring-1 ring-primary/40"
                : "border-border bg-card hover:bg-secondary/40"
            }`}
          >
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground mb-2" />
            <div className="font-semibold text-[14px]">1. Upload dataset</div>
            <div className="text-[12px] text-muted-foreground">CSV / Excel — start here</div>
          </button>
          <button
            type="button"
            onClick={() => p.setSourceMode("sources")}
            className={`text-left p-4 rounded-lg border transition ${
              p.sourceMode === "sources"
                ? "border-primary bg-info-bg/40 ring-1 ring-primary/40"
                : "border-border bg-card hover:bg-secondary/40"
            }`}
          >
            <Globe className="h-5 w-5 text-muted-foreground mb-2" />
            <div className="font-semibold text-[14px]">2. Wired sources</div>
            <div className="text-[12px] text-muted-foreground">{wiredCount} sources auto-recommended</div>
          </button>
        </div>
      </Card>

      {/* Active panel */}
      {p.sourceMode === "upload" ? (
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-[15px]">Upload your dataset</h3>
              <p className="text-[12px] text-muted-foreground">
                We'll auto-map columns to the standard schema and auto-recommend the right wired sources by geography.
              </p>
            </div>
            {p.seedFile && <Badge tone="success">{p.seedRows.toLocaleString()} rows</Badge>}
          </div>

          <div className="border border-dashed border-border rounded-md p-8 text-center">
            <Upload className="h-7 w-7 mx-auto text-muted-foreground mb-3" />
            <label className="inline-block">
              <input type="file" accept=".csv,.xlsx,text/csv" onChange={p.handleSeedFile} className="hidden" />
              <span className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium cursor-pointer">
                Choose CSV / Excel
              </span>
            </label>
            <div className="text-[12px] text-muted-foreground mt-3">
              {p.seedFile
                ? `${p.seedFile} · ${p.seedRows.toLocaleString()} rows · ${p.seedColumnCount || p.seedHeaders.length} columns`
                : "We'll auto-map columns to the standard schema and auto-recommend the right wired sources by geography."}
            </div>
            <button
              onClick={() => p.downloadSample("csv", `${p.ds.name}-template`)}
              className="mt-3 inline-flex items-center gap-1 text-[12px] text-info hover:underline"
            >
              <Download className="h-3 w-3" /> Download input template
            </button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-[15px]">Wired sources ({p.pickedSources.length} selected)</h3>
              <p className="text-[12px] text-muted-foreground">
                Grouped by source type. Company website is default for Firmographic / News. Expand a group to tweak — then Submit.
              </p>
            </div>
            <Button size="sm" onClick={submitSources}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Submit
            </Button>
          </div>

          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {sourceGroups.map(([groupName, arr]) => {
              const open = openGroups[groupName] ?? false;
              const onCount = arr.filter((s) => p.pickedSources.includes(s.name)).length;
              const allOn = onCount === arr.length;
              return (
                <div key={groupName} className="border border-border rounded-md overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupName)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-secondary/50 hover:bg-secondary text-left"
                  >
                    <div className="flex items-center gap-2">
                      <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
                      <span className="font-semibold text-[13px]">{groupName}</span>
                      <Badge tone="info">{onCount} / {arr.length}</Badge>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); selectGroup(arr, !allOn); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); selectGroup(arr, !allOn); } }}
                      className="text-[11px] text-info hover:underline cursor-pointer"
                    >
                      {allOn ? "Deselect all" : "Select all"}
                    </span>
                  </button>
                  {open && (
                    <div className="divide-y divide-border">
                      {arr.map((s) => {
                        const on = p.pickedSources.includes(s.name);
                        const isDefault = /target|auto-derived/i.test(s.url);
                        return (
                          <label
                            key={s.name}
                            className={`flex items-center gap-2 px-3 py-2 text-[12.5px] cursor-pointer ${on ? "bg-info-bg/30" : "hover:bg-secondary/60"}`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => p.toggleSource(s.name)}
                              className="accent-primary"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {s.name}
                                {isDefault && <Badge tone="success" className="ml-1.5">default</Badge>}
                              </div>
                              <div className="text-[10.5px] text-muted-foreground truncate">{s.url}</div>
                            </div>
                            <span className="text-[10.5px] text-muted-foreground font-mono shrink-0">{s.attributes} attrs</span>
                            <button
                              onClick={(e) => { e.preventDefault(); p.downloadSample("csv", s.name); }}
                              className="px-1.5 py-0.5 rounded border border-border text-[10.5px] inline-flex items-center gap-1 hover:bg-secondary shrink-0"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}




      {/* Field mapping / data point selection */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="font-semibold text-[15px]">3. Data points & field mapping</h3>
            <p className="text-[12px] text-muted-foreground">
              Choose which of the <strong>{ds.outputAttributes.length}</strong> standard attributes to refresh. {p.seedHeaders.length > 0 && "Map your columns to ours."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="info">{p.selectedOutputs.length} / {ds.outputAttributes.length} selected</Badge>
            <Button size="sm" variant="outline" onClick={() => p.selectedOutputs.length === ds.outputAttributes.length ? p.setMapping({}) : ds.outputAttributes.forEach((a) => !p.selectedOutputs.includes(a.key) && p.toggleOutput(a.key))}>
              {p.selectedOutputs.length === ds.outputAttributes.length ? "Clear" : "Select all"}
            </Button>
          </div>
        </div>

        {p.seedHeaders.length > 0 && (() => {
          const mappedCount = Object.values(p.mapping).filter(Boolean).length;
          const totalCols = p.seedHeaders.length;
          const unmappedCols = p.seedHeaders.filter((h) => !Object.values(p.mapping).includes(h));
          return (
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-md border border-success/40 bg-success-bg/60 p-3">
                <div className="text-[11px] uppercase tracking-wider text-success font-semibold">Mapped</div>
                <div className="text-[13px] font-semibold mt-0.5">{mappedCount} of {totalCols} uploaded columns matched</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{Object.values(p.mapping).filter(Boolean).slice(0, 8).join(", ") || "—"}</div>
              </div>
              <div className="rounded-md border border-warning/40 bg-warning-bg/60 p-3">
                <div className="text-[11px] uppercase tracking-wider text-warning font-semibold">Unmapped</div>
                <div className="text-[13px] font-semibold mt-0.5">{unmappedCols.length} column{unmappedCols.length === 1 ? "" : "s"} need attention</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{unmappedCols.slice(0, 8).join(", ") || "All your columns are mapped 🎉"}</div>
              </div>
            </div>
          );
        })()}


        <div className="space-y-4">
          {Object.entries(grouped).map(([group, attrs]) => (
            <div key={group}>
              <SectionLabel>{group} · {attrs.length}</SectionLabel>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2"></th>
                      <th className="text-left px-3 py-2">System attribute</th>
                      <th className="text-left px-3 py-2 w-24">Type</th>
                      {p.seedHeaders.length > 0 && <th className="text-left px-3 py-2 w-56">Your column</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {attrs.map((a) => {
                      const on = p.selectedOutputs.includes(a.key);
                      return (
                        <tr key={a.key} className={on ? "" : "opacity-50"}>
                          <td className="px-3 py-1.5">
                            <input type="checkbox" checked={on} onChange={() => p.toggleOutput(a.key)} className="accent-primary" />
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="font-medium">{a.label}</div>
                            <div className="text-[10.5px] text-muted-foreground font-mono">{a.key}</div>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.type}</td>
                          {p.seedHeaders.length > 0 && (
                            <td className="px-3 py-1.5">
                              <Select
                                value={p.mapping[a.key] || ""}
                                onChange={(e) => p.setMapping({ ...p.mapping, [a.key]: e.target.value })}
                                className="h-8 text-[12px]"
                              >
                                <option value="">— not mapped —</option>
                                {p.seedHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                              </Select>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={p.onBack}>Back</Button>
        <Button onClick={p.onNext} disabled={p.selectedOutputs.length === 0}>
          Next: Schedule & Launch <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ───────── Step 3: launch ───────── */
function LaunchStep(p: {
  ds: Dataset;
  selectedOutputs: string[];
  pickedSources: string[];
  seedFile: string | null;
  seedRows: number;
  frequency: string;
  setFrequency: (v: string) => void;
  customCron: string;
  setCustomCron: (v: string) => void;
  delivery: string;
  setDelivery: (v: string) => void;
  format: string;
  setFormat: (v: string) => void;
  onBack: () => void;
  onLaunch: () => Promise<boolean>;
  navigateToMonitoring: () => void;
}) {
  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <h3 className="font-semibold text-[15px]">Schedule & launch</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[13px]">
        <Summary label="Dataset" value={p.seedFile || p.ds.name} />
        <Summary label="Sources" value={p.pickedSources.length || "—"} />
        <Summary label="Seed rows" value={p.seedRows ? p.seedRows.toLocaleString() : "Refresh existing"} />
        <Summary label="Data points" value={`${p.selectedOutputs.length} / ${p.ds.outputAttributes.length}`} />
        <Summary label="Universe" value={p.ds.rowsAvailable} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-[12px] text-muted-foreground">Refresh frequency</label>
          <Select value={p.frequency} onChange={(e) => p.setFrequency(e.target.value)}>
            {p.ds.refreshOptions.map((o) => <option key={o}>{o}</option>)}
          </Select>
          {p.frequency === "Custom" && (
            <Input
              value={p.customCron}
              onChange={(e) => p.setCustomCron(e.target.value)}
              placeholder="cron e.g. 0 6 * * 1"
              className="mt-2 h-9 text-[12px] font-mono"
            />
          )}
        </div>
        <div>
          <label className="text-[12px] text-muted-foreground">Delivery</label>
          <Select value={p.delivery} onChange={(e) => p.setDelivery(e.target.value)}>
            <option>S3 bucket</option><option>Snowflake</option><option>Webhook</option><option>API pull</option>
          </Select>
        </div>
        <div>
          <label className="text-[12px] text-muted-foreground">Format</label>
          <Select value={p.format} onChange={(e) => p.setFormat(e.target.value)}>
            <option>JSON</option><option>CSV</option><option>Parquet</option><option>JSONL</option>
          </Select>
        </div>
      </div>

      <div className="p-3 bg-info-bg/40 rounded-md text-[12px] text-info-foreground flex items-start gap-2">
        <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          The <strong>{p.ds.name}</strong> workflow runs automatically on your schedule — no pipeline setup required.
          Selected sources: <strong>{p.pickedSources.join(", ") || "(refresh existing)"}</strong>.
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={p.onBack}>Back</Button>
        <Button
          onClick={() => {
            p.onLaunch();
            p.navigateToMonitoring();
          }}
        >
          <Upload className="h-4 w-4" /> Launch & open Jobs
        </Button>
      </div>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-secondary/60 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[14px] font-semibold mt-0.5 truncate">{value}</div>
    </div>
  );
}
