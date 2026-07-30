import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, Select, Steps } from "@/components/ui-bits";
import { readJobsCache, writeJobsCache } from "@/lib/jobs-cache";
import { DATASETS, DATASET_CATEGORIES, type Dataset } from "@/data/datasets";
import { WORKFLOWS } from "@/data/workflows";
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
  head: () => ({ meta: [{ title: "By Dataset – Dataset Setup – FreshData AI" }] }),
  component: AnySite,
});

const STEPS = ["Pick Dataset", "Select Datapoints", "Schedule & Launch"];

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
        credentials: "include",
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
      setSeedHeaders(headers);
      setSeedRecords(normalizedRecords);
      setSeedRows(rowCount);
      setSeedColumnCount(columnCount);

      if (ds) {
        const previewText = JSON.stringify(previewRows[0] || {});
        const detected = detectRegionFromHeaders(previewText, headers);
        setDetectedRegion(detected);
        setPickedSources(defaultSources(ds, detected));
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

  function toExcelColumnName(index: number) {
    let n = index;
    let col = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      col = String.fromCharCode(65 + rem) + col;
      n = Math.floor((n - 1) / 26);
    }
    return col;
  }

  async function downloadInputTemplate() {
    if (!ds) return;

    if (!ds.inputTemplateColumns?.length) {
      downloadSample("csv", `${ds.name}-template`);
      return;
    }

    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FreshData AI";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Template", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const columns =
      ds.id === "ds-firmographic"
        ? Array.from(
            new Map(
              [...ds.inputAttributes, ...ds.outputAttributes.map((field) => ({
                ...field,
                role: "input" as const,
                required: false,
              }))].map((column) => [column.key, column]),
            ).values(),
          )
        : ds.inputTemplateColumns;
    const templateRows: Record<string, string>[] =
      ds.id === "ds-firmographic"
        ? [
            {
              company_name: "Acme Corp",
              domain: "acmecorp.com",
              website: "https://acmecorp.com",
              linkedin_url: "https://www.linkedin.com/company/acme-corp",
              country: "United States",
              hq_city: "San Francisco",
              hq_state: "California",
              industry: "Software",
              sub_industry: "B2B SaaS",
              ticker: "ACME",
              registry_number: "CA-2026-ACME-001",
            },
            {
              company_name: "Northstar Systems",
              domain: "northstarsystems.io",
              website: "https://northstarsystems.io",
              linkedin_url: "https://www.linkedin.com/company/northstar-systems",
              country: "United States",
              hq_city: "Austin",
              hq_state: "Texas",
              industry: "Information Technology",
              sub_industry: "Cloud Infrastructure",
              ticker: "NSTR",
              registry_number: "TX-2026-NS-204",
            },
            {
              company_name: "BluePeak Analytics",
              domain: "bluepeakanalytics.com",
              website: "https://bluepeakanalytics.com",
              linkedin_url: "https://www.linkedin.com/company/bluepeak-analytics",
              country: "United Kingdom",
              hq_city: "London",
              hq_state: "England",
              industry: "Data & Analytics",
              sub_industry: "Business Intelligence",
              ticker: "BPAK",
              registry_number: "UK-2026-BPA-778",
            },
            {
              company_name: "Vertex Health Labs",
              domain: "vertexhealthlabs.com",
              website: "https://vertexhealthlabs.com",
              linkedin_url: "https://www.linkedin.com/company/vertex-health-labs",
              country: "Canada",
              hq_city: "Toronto",
              hq_state: "Ontario",
              industry: "Healthcare",
              sub_industry: "Health Tech",
              ticker: "VHL",
              registry_number: "ON-2026-VHL-019",
            },
            {
              company_name: "Summit Retail Group",
              domain: "summitretailgroup.com",
              website: "https://summitretailgroup.com",
              linkedin_url: "https://www.linkedin.com/company/summit-retail-group",
              country: "Singapore",
              hq_city: "Singapore",
              hq_state: "Singapore",
              industry: "Retail",
              sub_industry: "Omnichannel Commerce",
              ticker: "SMRT",
              registry_number: "SG-2026-SRG-552",
            },
          ]
        : ds.id === "ds-contacts"
          ? [
              {
                full_name: "Jane Park",
                company_name: "Acme Corp",
                company_domain: "acmecorp.com",
                title: "Chief Marketing Officer",
                department: "Marketing",
                seniority: "C-level",
                email: "jane.park@acmecorp.com",
                phone: "+1 415 555 0101",
                linkedin_url: "https://www.linkedin.com/in/jane-park-acme",
                country: "United States",
                city: "San Francisco",
                state: "California",
              },
              {
                full_name: "Daniel Brooks",
                company_name: "Northstar Systems",
                company_domain: "northstarsystems.io",
                title: "VP Sales",
                department: "Sales",
                seniority: "VP",
                email: "daniel.brooks@northstarsystems.io",
                phone: "+1 512 555 0144",
                linkedin_url: "https://www.linkedin.com/in/daniel-brooks-northstar",
                country: "United States",
                city: "Austin",
                state: "Texas",
              },
              {
                full_name: "Priya Nair",
                company_name: "BluePeak Analytics",
                company_domain: "bluepeakanalytics.com",
                title: "Director of Operations",
                department: "Operations",
                seniority: "Director",
                email: "priya.nair@bluepeakanalytics.com",
                phone: "+44 20 5555 0188",
                linkedin_url: "https://www.linkedin.com/in/priya-nair-bluepeak",
                country: "United Kingdom",
                city: "London",
                state: "England",
              },
              {
                full_name: "Ethan Chen",
                company_name: "Vertex Health Labs",
                company_domain: "vertexhealthlabs.com",
                title: "Senior Product Manager",
                department: "Product",
                seniority: "Senior Manager",
                email: "ethan.chen@vertexhealthlabs.com",
                phone: "+1 416 555 0177",
                linkedin_url: "https://www.linkedin.com/in/ethan-chen-vertex",
                country: "Canada",
                city: "Toronto",
                state: "Ontario",
              },
              {
                full_name: "Sofia Tan",
                company_name: "Summit Retail Group",
                company_domain: "summitretailgroup.com",
                title: "Head of Finance",
                department: "Finance",
                seniority: "Head",
                email: "sofia.tan@summitretailgroup.com",
                phone: "+65 5555 0199",
                linkedin_url: "https://www.linkedin.com/in/sofia-tan-summit",
                country: "Singapore",
                city: "Singapore",
                state: "Singapore",
              },
            ]
          : [];

    worksheet.columns = columns.map((column) => ({
      key: column.key,
      width: Math.max(16, column.key.length + 4),
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.height = 22;

    columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
      const isRequired = !!column.required;
      cell.value = column.key;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD1D5DB" } },
        left: { style: "thin", color: { argb: "FFD1D5DB" } },
        bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        right: { style: "thin", color: { argb: "FFD1D5DB" } },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isRequired ? "FF1D4ED8" : "FFDBEAFE" },
      };
      cell.font = {
        name: "Aptos",
        size: 11,
        bold: isRequired,
        color: { argb: isRequired ? "FFFFFFFF" : "FF1E3A8A" },
      };
    });

    templateRows.forEach((rowData) => {
      const row = worksheet.addRow(columns.map((column) => rowData[column.key] ?? ""));
      row.height = 20;
      row.eachCell((cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
      });
    });

    worksheet.autoFilter = {
      from: "A1",
      to: `${toExcelColumnName(columns.length)}1`,
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ds.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-input-template.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${a.download}`);
  }

  async function handleLaunch(): Promise<boolean> {
    if (!ds) return false;

    const filters = JSON.stringify({
      datasetId: ds.id,
      workflowId: ds.workflowId,
      selectedOutputs,
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
      dataset_name: ds.name,
      seed_file: seedFile,
      scope: "By Dataset",
      filters,
      frequency,
      delivery,
      output_format: format,
      isCustomSource: false,
      mode: "By Dataset",
      status: "Running",
      created_at: new Date().toISOString(),
      input_data: seedRecords.length > 0 ? seedRecords : undefined,
    };

    writeJobsCache([...readJobsCache(), job]);

    try {
      const launchRequest = fetch(`${baseApiUrl}/api/v1/demo/jobs/launch`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: [job] }),
        keepalive: true,
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
        title="By Dataset — Dataset Setup"
        subtitle="Pick a dataset, choose your sources or upload your own data, then select your datapoints. A workflow runs behind the scenes."
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
            setSelectedOutputs={setSelectedOutputs}
            downloadSample={downloadSample}
            downloadInputTemplate={downloadInputTemplate}
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
  setSelectedOutputs: React.Dispatch<React.SetStateAction<string[]>>;
  downloadSample: (kind: "csv" | "json", name: string) => void;
  downloadInputTemplate: () => void | Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
  const { ds } = p;
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(true);
  const [configTab, setConfigTab] = useState<"upload" | "sources" | "attributes">("upload");
  const workflow = useMemo(
    () => WORKFLOWS.find((w) => w.id === ds.workflowId) || null,
    [ds],
  );
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

  const wiredCount = ds.sources.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="p-5 space-y-4">
        <button
          type="button"
          onClick={() => setOverviewOpen((s) => !s)}
          className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-4 py-3 text-left hover:bg-secondary transition"
        >
          <div>
            <div className="font-semibold text-[15px]">Overview</div>
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${overviewOpen ? "rotate-90" : ""}`} />
        </button>

        {overviewOpen && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[15px]">{ds.name}</h3>
                    <Badge tone="purple">{ds.category}</Badge>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-1">{ds.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Workflow</div>
                  <div className="text-[12px] font-semibold">{workflow?.name || "No matching workflow"}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-[12px]">
                <OverviewStat label="Datapoints" value={ds.outputAttributes.length.toLocaleString()} />
                <OverviewStat label="Sources" value={ds.sources.length.toLocaleString()} />
                <OverviewStat label="Coverage" value={ds.coverage ? `${ds.coverage}%` : "—"} />
                <OverviewStat label="Accuracy" value={ds.accuracy ? `${ds.accuracy}%` : "—"} />
              </div>

              {workflow ? (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                    <OverviewStat label="Workflow category" value={workflow.category} />
                    <OverviewStat label="Runtime" value={workflow.runtime} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <OverviewList title="Input Attributes" items={workflow.inputAttributes ?? workflow.inputs} tone="info" />
                    <OverviewList title="Output Attributes" items={workflow.outputAttributes ?? workflow.outputs ?? workflow.attributes} tone="success" />
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Pipeline preview</div>
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                      {workflow.steps.map((stepName, index) => (
                        <div key={stepName} className="flex items-center gap-1.5 shrink-0">
                          <div className="h-7 px-2.5 rounded-md bg-info-bg text-info text-[11px] font-medium inline-flex items-center">
                            {stepName}
                          </div>
                          {index < workflow.steps.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Sources ({workflow.sources.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {workflow.sources.map((source) => (
                        <Badge key={source} tone="info">{source}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-border bg-card px-3 py-3 text-[12px] text-muted-foreground">
                  No exact workflow is available in the repository for this dataset yet.
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <button
          type="button"
          onClick={() => setConfigureOpen((s) => !s)}
          className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-4 py-3 text-left hover:bg-secondary transition"
        >
          <div>
            <div className="font-semibold text-[15px]">Configure Data</div>
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${configureOpen ? "rotate-90" : ""}`} />
        </button>

        {configureOpen && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfigTab("upload");
                  p.setSourceMode("upload");
                }}
                className={`text-left p-4 rounded-lg border transition ${
                  configTab === "upload"
                    ? "border-primary bg-info-bg/40 ring-1 ring-primary/40"
                    : "border-border bg-card hover:bg-secondary/40"
                }`}
              >
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground mb-2" />
                <div className="font-semibold text-[14px]">1. Upload data set</div>
                <div className="text-[12px] text-muted-foreground">CSV / Excel — start here</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfigTab("sources");
                  p.setSourceMode("sources");
                }}
                className={`text-left p-4 rounded-lg border transition ${
                  configTab === "sources"
                    ? "border-primary bg-info-bg/40 ring-1 ring-primary/40"
                    : "border-border bg-card hover:bg-secondary/40"
                }`}
              >
                <Globe className="h-5 w-5 text-muted-foreground mb-2" />
                <div className="font-semibold text-[14px]">2. Wired Sources</div>
                <div className="text-[12px] text-muted-foreground">{wiredCount} sources auto-recommended</div>
              </button>

              <button
                type="button"
                onClick={() => setConfigTab("attributes")}
                className={`text-left p-4 rounded-lg border transition ${
                  configTab === "attributes"
                    ? "border-primary bg-info-bg/40 ring-1 ring-primary/40"
                    : "border-border bg-card hover:bg-secondary/40"
                }`}
              >
                <Sparkles className="h-5 w-5 text-muted-foreground mb-2" />
                <div className="font-semibold text-[14px]">3. Select data points</div>
                <div className="text-[12px] text-muted-foreground">{p.selectedOutputs.length} selected</div>
              </button>
            </div>

            {configTab === "upload" && (
              <Card className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-[15px]">Upload your dataset</h3>
                    <p className="text-[12px] text-muted-foreground">
                      Upload your dataset to get started.
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
                      : "Upload your dataset to get started."}
                  </div>
                  <button
                    type="button"
                    onClick={() => void p.downloadInputTemplate()}
                    className="mt-3 inline-flex items-center gap-1 text-[12px] text-info hover:underline"
                  >
                    <Download className="h-3 w-3" /> Download input template
                  </button>
                </div>
              </Card>
            )}

            {configTab === "sources" && (
              <Card className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-[15px]">Wired sources ({p.pickedSources.length} selected)</h3>
                    <p className="text-[12px] text-muted-foreground">
                      Grouped by source type. Company website is default for Firmographic / News. Expand a group to tweak.
                    </p>
                  </div>
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

            {configTab === "attributes" && (
              <Card className="p-5">
                <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-[15px]">3. Select data points</h3>
                    <p className="text-[12px] text-muted-foreground">
                      Choose which of the <strong>{ds.outputAttributes.length}</strong> standard attributes to refresh.
                      {p.seedHeaders.length > 0 && ` Uploaded template detected with ${p.seedHeaders.length} column${p.seedHeaders.length === 1 ? "" : "s"}.`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="info">{p.selectedOutputs.length} / {ds.outputAttributes.length} selected</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => p.selectedOutputs.length === ds.outputAttributes.length
                        ? p.setSelectedOutputs([])
                        : p.setSelectedOutputs(ds.outputAttributes.map((a) => a.key))}
                    >
                      {p.selectedOutputs.length === ds.outputAttributes.length ? "Clear" : "Select all"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {Object.entries(grouped).map(([group, attrs]) => (
                    <div key={group}>
                      <SectionLabel>{group} · {attrs.length}</SectionLabel>
                      <div className="rounded-md border border-border overflow-hidden">
                        <table className="w-full text-[12.5px]">
                          <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground">
                            <tr>
                              <th className="w-10 px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={attrs.every((a) => p.selectedOutputs.includes(a.key))}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const groupKeys = attrs.map((a) => a.key);
                                    if (checked) {
                                      p.setSelectedOutputs((prev) => Array.from(new Set([...prev, ...groupKeys])));
                                    } else {
                                      p.setSelectedOutputs((prev) => prev.filter((k) => !groupKeys.includes(k)));
                                    }
                                  }}
                                  className="accent-primary"
                                />
                              </th>
                              <th className="text-left px-3 py-2">System attribute</th>
                              <th className="text-left px-3 py-2 w-24">Type</th>
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
            )}
          </div>
        )}
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

function OverviewStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-card border border-border p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-[12px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function OverviewList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "info" | "success";
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{title}</div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-[12px] flex items-start gap-1.5">
            <Badge tone={tone} className="!py-0">{tone === "info" ? "in" : "out"}</Badge>
            <span>{item}</span>
          </li>
        ))}
      </ul>
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
            <option>One-time</option>
            <option>Hourly</option>
            <option>Daily</option>
            <option>Weekly</option>
            <option>Monthly</option>
            <option>On-demand</option>
            <option>Custom</option>
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
            <option>S3 bucket</option><option>Snowflake</option><option>Webhook</option><option>API pull</option><option>Export</option>
          </Select>
        </div>
        <div>
          <label className="text-[12px] text-muted-foreground">Format</label>
          <Select value={p.format} onChange={(e) => p.setFormat(e.target.value)}>
            <option>JSON</option><option>CSV</option><option>Parquet</option>
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
            void p.onLaunch();
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
