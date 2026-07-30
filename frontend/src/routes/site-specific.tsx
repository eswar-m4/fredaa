import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, Select, SectionTitle, Steps } from "@/components/ui-bits";
import { readJobsCache, writeJobsCache } from "@/lib/jobs-cache";
import bots from "@/data/bots.json";
import {
  Search,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Clock,
  PlusCircle,
  ExternalLink,
  Eye,
  ShieldAlert,
  X,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/site-specific")({
  head: () => ({ meta: [{ title: "Ready-Made Datasets – FreshData AI" }] }),
  component: SiteSpecific,
});

// Dedicated service function where a real LLM filter parser can be integrated in the future.
export async function translateCustomPromptToFilters(prompt: string): Promise<string> {
  // TODO: Replace with real LLM backend/API call later
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const p = prompt.toLowerCase();
  if (p.includes("california") || p.includes("ca")) {
    return "[State = CA]";
  }
  if (p.includes("active")) {
    return "[Status = Active]";
  }
  if (p.includes("oscilloscope")) {
    return "[Category = Oscilloscopes]";
  }
  if (p.includes("keyword")) {
    return "[Keywords = Match]";
  }
  return "[AI Filter: Custom Logic Applied]";
}

type Bot = (typeof bots)["bots"][number];

const STEPS = ["Pick or Add Sources", "Scope & Schedule", "Review & Launch"];

type SourceItem = {
  id: number;
  bot: Bot;
  scope: "full" | "partial";
  partialCriteria: string;
  criteriaFiles?: File[];
  frequency: string;
};


type NewSite = {
  url: string;
  category: string;
  description: string;
  authRequired: boolean;
  analysis: { complexity: string; sla: string; pages: string; reason: string };
  scope: "full" | "partial";
  partialCriteria: string;
  criteriaFiles?: File[];
  frequency: string;
};

type Selection = {
  items: SourceItem[];
  newSite?: NewSite;
  delivery: string;
  format: string;
};

function CustomCriteriaEditor({
  active,
  criteria,
  files,
  onToggle,
  onChange,
  onFilesChange,
  placeholder,
}: {
  active: boolean;
  criteria: string;
  files: File[];
  onToggle: () => void;
  onChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  placeholder: string;
}) {
  const removeFileAt = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="inline-block text-left w-full">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center h-8 px-3 text-[12px] bg-card hover:bg-secondary/20 rounded-md font-semibold text-foreground transition-colors border border-border"
      >
        <span>Configure</span>
        {files.length > 0 && (
          <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
            {files.length} file{files.length > 1 ? "s" : ""}
          </span>
        )}
      </button>

      {active && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-xl rounded-lg border border-border bg-card p-5 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[14px] font-semibold">Configure</div>
                </div>
                <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Scraping Instructions</div>
                <textarea
                  value={criteria}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={placeholder}
                  className="mt-1 w-full min-h-[72px] rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-secondary/30 text-[12px] font-medium text-foreground cursor-pointer hover:bg-secondary/50">
                  <input
                    type="file"
                    multiple
                    accept=".txt,.csv,.json"
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length > 0) {
                        onFilesChange([...files, ...picked]);
                      }
                      e.target.value = "";
                    }}
                  />
                  Upload file
                </label>
                <button type="button" onClick={onToggle} className="text-[12px] text-muted-foreground hover:text-foreground">
                  Done
                </button>
              </div>
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((file, index) => (
                    <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/30 px-2.5 py-1 text-[11px] text-foreground">
                      <span className="max-w-[220px] truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFileAt(index)}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function getEstimatedRecords(bot: Bot): string {
  if (bot.name.toLowerCase() === "keysight") return "25,000";
  if (bot.name.toLowerCase() === "webmd") return "1,500";
  if (bot.name.toLowerCase() === "investegate") return "1,200";
  if (bot.name.toLowerCase() === "turkeybrokers") return "350";

  const raw = (bot as any).estimated_records;
  if (raw && typeof raw === "number") {
    return raw.toLocaleString();
  }
  return "500";
}

function FrequencyWidget({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSubmenu, setShowSubmenu] = useState(value !== "One-time");

  const isRecurring = value !== "One-time";
  const displayLabel = value;

  return (
    <div className="relative inline-block text-left w-36">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className="inline-flex items-center justify-between h-8 w-full px-3 text-[12px] bg-card hover:bg-secondary/20 rounded-md font-semibold text-foreground transition-colors border border-border"
      >
        <span>{displayLabel}</span>
        <span className="text-[10px] text-muted-foreground/60">▼</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 mt-1 w-36 rounded-md shadow-lg bg-card border border-border z-50 py-1 flex flex-col">
            <button
              type="button"
              onClick={() => {
                onChange("One-time");
                setIsOpen(false);
                setShowSubmenu(false);
              }}
              className={[
                "flex items-center w-full px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-left text-foreground font-medium",
                value === "One-time" ? "text-primary font-semibold" : ""
              ].join(" ")}
            >
              One-time
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSubmenu(!showSubmenu)}
                className={[
                  "flex items-center justify-between w-full px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-left text-foreground font-medium",
                  isRecurring ? "bg-secondary/30 text-primary font-semibold" : ""
                ].join(" ")}
              >
                <span>Recurring</span>
                <span className="text-[10px] text-muted-foreground/60">&gt;</span>
              </button>

              {showSubmenu && (
                <div className="absolute left-full top-0 ml-1 w-32 rounded-md shadow-lg bg-card border border-border z-50 py-1 flex flex-col">
                  {["Hourly", "Daily", "Weekly", "Monthly", "On-demand", "Custom"].map((freq) => (
                    <button
                      key={freq}
                      type="button"
                      onClick={() => {
                        onChange(freq);
                        setIsOpen(false);
                      }}
                      className={[
                        "flex items-center w-full px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-left text-foreground font-medium",
                        value === freq ? "text-primary font-semibold" : ""
                      ].join(" ")}
                    >
                      {freq}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SiteSpecific() {
  const all = (bots as any).bots as Bot[];
  const cats = Object.keys((bots as any).categoryCounts).sort();

  const [step, setStep] = useState(0);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [complexity, setComplexity] = useState("All");
  const [country, setCountry] = useState("All");

  const [sel, setSel] = useState<Selection>({
    items: [],
    delivery: "S3 bucket",
    format: "JSON",
  });

  const [previewBot, setPreviewBot] = useState<Bot | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const countries = useMemo(() => {
    const s = new Set<string>();
    all.forEach((b) => s.add(b.country));
    return Array.from(s).sort();
  }, [all]);

  const filtered = useMemo(() => {
    return all
      .filter((b) => {
        if (category !== "All" && b.category !== category) return false;
        if (complexity !== "All" && b.complexity !== complexity) return false;
        if (country !== "All" && b.country !== country) return false;
        if (q) {
          const s = q.toLowerCase();
          return (
            b.name.toLowerCase().includes(s) ||
            b.url.toLowerCase().includes(s) ||
            b.industry.toLowerCase().includes(s) ||
            b.country.toLowerCase().includes(s) ||
            b.dataType.toLowerCase().includes(s)
          );
        }
        return true;
      })
      ;
  }, [all, q, category, complexity, country]);

  const selectedIds = useMemo(() => new Set(sel.items.map((i) => i.bot.id)), [sel.items]);
  const hasSelection = sel.items.length > 0 || !!sel.newSite;

  function toggle(b: Bot) {
    setSel((s) => {
      const exists = s.items.some((x) => x.bot.id === b.id);
      if (exists) return { ...s, items: s.items.filter((x) => x.bot.id !== b.id) };
      return {
        ...s,
        items: [...s.items, { id: b.id, bot: b, scope: "full", partialCriteria: "", criteriaFiles: [], frequency: "Weekly" }],
      };
    });
  }
  function toggleAllVisible() {
    setSel((s) => {
      const allOn = filtered.every((b) => selectedIds.has(b.id));
      if (allOn) return { ...s, items: s.items.filter((i) => !filtered.some((f) => f.id === i.bot.id)) };
      const merged = [...s.items];
      filtered.forEach((b) => {
        if (!selectedIds.has(b.id))
          merged.push({ id: b.id, bot: b, scope: "full", partialCriteria: "", criteriaFiles: [], frequency: "Weekly" });
      });
      return { ...s, items: merged };
    });
  }
  function clearSelection() {
    setSel((s) => ({ ...s, items: [], newSite: undefined }));
  }
  function updateItem(id: number, patch: Partial<SourceItem>) {
    setSel((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }
  function removeItem(id: number) {
    setSel((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
  }

  return (
    <AppLayout>
      <PageHeader
        title="Sources & Agents"
        subtitle={`Browse ${all.length} onboarded scraping agents. Pick one or many to schedule a refresh, or add a brand-new site.`}
        actions={step === 0 ? (
          <div className="relative flex items-center gap-3">
            <div className="relative flex items-center w-80">
              <Search className="h-4 w-4 absolute left-3 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sources by name, URL..."
                className="w-full h-10 pl-9 pr-12 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
              />
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                title="Advanced Search"
                className="absolute right-1 w-[38px] h-[38px] rounded-md flex items-center justify-center text-muted-foreground/60 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-cyan-400 dark:hover:bg-cyan-950/30 transition-colors cursor-pointer select-none"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-[26px] w-[26px]"
                >
                  <circle cx="10.5" cy="11.5" r="5.5" />
                  <line x1="14.5" y1="15.5" x2="20" y2="21" />
                  <circle cx="17" cy="6" r="3.5" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="15.5" y1="6" x2="18.5" y2="6" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="17" y1="4.5" x2="17" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
            
            <Button onClick={() => setShowAdd(true)} className="h-10 shrink-0">
              <PlusCircle className="h-4 w-4" /> Add new source
            </Button>

            {showAdvanced && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAdvanced(false)} />
                <div className="absolute right-0 top-12 z-50 w-72 p-4 bg-card border border-border rounded-lg shadow-xl space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Category</label>
                    <Select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
                      <option value="All">All categories</option>
                      {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Country</label>
                    <Select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1">
                      <option value="All">Any country</option>
                      {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : undefined}
      />

      <div className="px-7 pb-8 space-y-6">
        <Card className="p-4">
          <Steps steps={STEPS} current={step} />
        </Card>

        {step === 0 && (
          <>

            {hasSelection && (
              <Card className="p-4 border-primary/40 bg-info-bg/30">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">
                        {sel.items.length > 0 && <>{sel.items.length} source{sel.items.length > 1 ? "s" : ""} selected</>}
                        {sel.items.length > 0 && sel.newSite && " · "}
                        {sel.newSite && <>1 new source to onboard</>}
                      </div>
                      <div className="text-[12px] text-muted-foreground truncate max-w-[600px]">
                        {sel.items.slice(0, 4).map((i) => i.bot.name).join(", ")}
                        {sel.items.length > 4 && ` +${sel.items.length - 4} more`}
                        {sel.newSite && (sel.items.length ? " · " : "") + sel.newSite.url}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={clearSelection}>Clear</Button>
                    <Button onClick={() => setStep(1)}>Continue <ArrowRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <SectionTitle hint={`${filtered.length} of ${all.length} shown · ${sel.items.length} selected`}>Available sources</SectionTitle>
                <button onClick={toggleAllVisible} className="text-[12px] text-info hover:underline">
                  {filtered.length > 0 && filtered.every((b) => selectedIds.has(b.id)) ? "Deselect visible" : "Select all visible"}
                </button>
              </div>

              <div className="max-h-[640px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0">
                    <tr>
                      <th className="w-10 px-3 py-2.5"></th>
                      <th className="text-left px-3 py-2.5 font-semibold">Site</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Category</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Country</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Data Type</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Complexity</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Attrs</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((b) => {
                      const on = selectedIds.has(b.id);
                      return (
                        <tr key={b.id} onClick={() => toggle(b)} className={`cursor-pointer ${on ? "bg-info-bg/40" : "hover:bg-secondary/60"}`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={on} onChange={() => toggle(b)} onClick={(e) => e.stopPropagation()} className="accent-primary" />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{b.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate max-w-[280px]">{b.url}</div>
                          </td>
                          <td className="px-3 py-2"><Badge tone="info">{b.category}</Badge></td>
                          <td className="px-3 py-2 text-muted-foreground">{b.country}</td>
                          <td className="px-3 py-2 text-muted-foreground">{b.dataType}</td>
                          <td className="px-3 py-2">
                            <Badge tone={b.complexity === "Simple" ? "success" : b.complexity === "Medium" ? "warning" : "destructive"}>{b.complexity}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{b.datapoints}</td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={(e) => { e.stopPropagation(); setPreviewBot(b); }} className="text-[11px] text-info hover:underline inline-flex items-center gap-1 dark:text-muted-foreground dark:hover:text-[#22D3EE]">
                              <Eye className="h-3 w-3" /> Sample
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {step === 1 && hasSelection && (
          <ScopeScheduleStep
            sel={sel}
            setSel={setSel}
            updateItem={updateItem}
            removeItem={removeItem}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && hasSelection && (
          <ReviewStep sel={sel} onBack={() => setStep(1)} />
        )}
      </div>

      {previewBot && <SampleModal bot={previewBot} onClose={() => setPreviewBot(null)} />}
      {showAdd && (
        <AddSourceModal
          onClose={() => setShowAdd(false)}
          onSubmit={(ns) => {
            setSel((s) => ({ ...s, newSite: ns }));
            setShowAdd(false);
            setStep(1);
          }}
          existingBots={all}
        />
      )}
    </AppLayout>
  );
}

/* ---------- Scope & Schedule (per source) ---------- */

interface FilterConfig {
  label: string;
  key: string;
  options: string[];
}

const SOURCE_FILTER_SCHEMAS: Record<string, FilterConfig[]> = {
  "Keysight": [
    {
      label: "Category",
      key: "category",
      options: ["Oscilloscopes", "Signal Generators", "Spectrum Analyzers", "Power Supplies", "Probes"]
    },
    {
      label: "Product Family",
      key: "family",
      options: ["InfiniiVision Oscilloscopes", "Truevolt Digital Multimeters", "Trueform Waveform Generators"]
    },
    {
      label: "Region",
      key: "region",
      options: ["US / English", "CA / English", "GB / English", "DE / German"]
    },
    {
      label: "Availability",
      key: "availability",
      options: ["In Stock", "Out of Stock", "Discontinued"]
    },
    {
      label: "Price Range",
      key: "price",
      options: ["Under $1,000", "$1,000 - $5,000", "$5,000 - $20,000", "Above $20,000"]
    }
  ],
  "Webmd": [
    { label: "Specialty", key: "specialty", options: ["Cardiology", "Family Medicine", "Internal Medicine", "Nephrology", "Pediatrics", "Pulmonology"] },
    { label: "State", key: "state", options: ["CA", "FL", "MD", "NJ", "NY", "OH", "PA", "TX"] },
    { label: "City", key: "city", options: ["Pittsburgh", "Monroeville", "Largo", "Winter Park", "Johnstown", "New York", "Los Angeles", "Chicago"] },
    { label: "Hospital Affiliations", key: "hospital_affiliations", options: ["Upmc East", "Lifecare Hospitals Of Pittsburgh", "Morton Plant Hospital", "Florida Hospital For Women", "Saint Clares Denville Hospital"] },
    { label: "Languages Spoken", key: "languages_spoken", options: ["English", "Spanish", "French", "Arabic", "Polish", "Chinese", "German"] },
    { label: "Medical School", key: "medical_school", options: ["Lewis Katz School Of Medicine At Temple University", "Mysore Medical College And Research Institute", "Ohio State University College Of Medicine", "Maulana Azad Medical College"] },
    { label: "Accepting New Patients", key: "accepting_new_patients", options: ["Yes", "No"] },
    { label: "Medicare Accepted", key: "medicare_accepted", options: ["Yes", "No"] },
    { label: "Medicaid Accepted", key: "medicaid_accepted", options: ["Yes", "No"] }
  ],
  "Investegate": [
    { label: "Market", key: "market", options: ["Main Market", "AIM", "AQSE", "NYSE", "NASDAQ"] },
    { label: "Listing Category", key: "listing_category", options: ["Equity", "Debt", "Structured Products", "Funds", "Open Ended"] },
    { label: "FTSE Index", key: "ftse_index", options: ["FTSE 100", "FTSE 250", "FTSE AIM 100", "FTSE All-Share"] },
    { label: "FTSE Sector", key: "ftse_sector", options: ["Financial Services", "Technology", "Healthcare", "Energy", "Basic Materials", "Industrials"] },
    { label: "Event Name", key: "event_name", options: ["Acquisition", "Dividend Declaration", "Interim Results", "Final Results", "Director Shareholding"] },
    { label: "RNS", key: "rns", options: ["RNS Number Needed", "RNS Reach", "Regulatory Announcement"] },
    { label: "Published Date", key: "published_date", options: ["Last 7 days", "Last 30 days", "Custom Range"] }
  ],
  "TurkeyBrokers": [
    { label: "City", key: "city", options: ["Istanbul", "Ankara", "Izmir", "Bursa", "Antalya", "Adana", "Gaziantep"] }
  ]
};

function KeysightFilterSelector({
  filters,
  onChange,
}: {
  filters: Record<string, string[]>;
  onChange: (key: string, val: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const fields = SOURCE_FILTER_SCHEMAS["Keysight"] || [];
  const activeChips = fields.flatMap(f => {
    const val = filters[f.key] || [];
    return val.map(v => ({ key: f.key, label: f.label, val: v }));
  });

  return (
    <div className="space-y-2 max-w-lg">
      <div className="relative inline-block text-left">
        <button
          type="button"
          onClick={() => { setIsOpen(!isOpen); setActiveKey(null); }}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] bg-secondary hover:bg-secondary/80 rounded-md font-semibold text-foreground transition-colors border border-border"
        >
          <span>Configure Filters</span>
          <span className="text-[10px] text-muted-foreground/60">▼</span>
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setActiveKey(null); }} />
            <div className="absolute left-0 mt-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 flex flex-col">
              {fields.map((s) => {
                const isSelected = (filters[s.key] || []).length > 0;
                const isCurrentActive = activeKey === s.key;
                return (
                  <div key={s.key} className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveKey(isCurrentActive ? null : s.key)}
                      className={[
                        "flex items-center justify-between w-full px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-left text-foreground font-semibold",
                        isCurrentActive ? "bg-secondary/60" : ""
                      ].join(" ")}
                    >
                      <span>{s.label} {isSelected && `(${filters[s.key].length})`}</span>
                      <span className="text-[10px] text-muted-foreground/60">&gt;</span>
                    </button>

                    {isCurrentActive && (
                      <div className="absolute left-full top-0 ml-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 max-h-60 overflow-y-auto">
                        {s.options.map((opt) => {
                          const selectedVals = filters[s.key] || [];
                          const active = selectedVals.includes(opt);
                          return (
                            <label
                              key={opt}
                              className="flex items-center px-3 py-1.5 hover:bg-secondary/60 text-[12px] cursor-pointer text-foreground font-medium"
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => {
                                  const updated = active
                                    ? selectedVals.filter(x => x !== opt)
                                    : [...selectedVals, opt];
                                  onChange(s.key, updated);
                                }}
                                className="mr-2 accent-primary h-3.5 w-3.5 rounded border-gray-300"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border/40 mt-1.5">
          {activeChips.map((chip, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-info-bg/30 text-info text-[10px] border border-info/20 font-medium">
              {chip.label}: {chip.val}
              <button
                type="button"
                onClick={() => {
                  const currentVal = filters[chip.key] || [];
                  onChange(chip.key, currentVal.filter((x: string) => x !== chip.val));
                }}
                className="hover:text-foreground text-muted-foreground/60 transition ml-0.5 text-[11px] font-bold"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WebmdFilterSelector({
  filters,
  onChange,
}: {
  filters: Record<string, string[]>;
  onChange: (key: string, val: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const fields = SOURCE_FILTER_SCHEMAS["Webmd"] || [];
  const activeChips = fields.flatMap(f => {
    const val = filters[f.key] || [];
    return val.map(v => ({ key: f.key, label: f.label, val: v }));
  });

  return (
    <div className="space-y-2 max-w-lg">
      <div className="relative inline-block text-left">
        <button
          type="button"
          onClick={() => { setIsOpen(!isOpen); setActiveKey(null); }}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] bg-secondary hover:bg-secondary/80 rounded-md font-semibold text-foreground transition-colors border border-border"
        >
          <span>Configure Filters</span>
          <span className="text-[10px] text-muted-foreground/60">▼</span>
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setActiveKey(null); }} />
            <div className="absolute left-0 mt-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 flex flex-col">
              {fields.map((s) => {
                const isSelected = (filters[s.key] || []).length > 0;
                const isCurrentActive = activeKey === s.key;
                return (
                  <div key={s.key} className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveKey(isCurrentActive ? null : s.key)}
                      className={[
                        "flex items-center justify-between w-full px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-left text-foreground font-semibold",
                        isCurrentActive ? "bg-secondary/60" : ""
                      ].join(" ")}
                    >
                      <span>{s.label} {isSelected && `(${filters[s.key].length})`}</span>
                      <span className="text-[10px] text-muted-foreground/60">&gt;</span>
                    </button>

                    {isCurrentActive && (
                      <div className="absolute left-full top-0 ml-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 max-h-60 overflow-y-auto">
                        {s.options.map((opt) => {
                          const selectedVals = filters[s.key] || [];
                          const active = selectedVals.includes(opt);
                          return (
                            <label
                              key={opt}
                              className="flex items-center px-3 py-1.5 hover:bg-secondary/60 text-[12px] cursor-pointer text-foreground font-medium"
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => {
                                  const updated = active
                                    ? selectedVals.filter(x => x !== opt)
                                    : [...selectedVals, opt];
                                  onChange(s.key, updated);
                                }}
                                className="mr-2 accent-primary h-3.5 w-3.5 rounded border-gray-300"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border/40 mt-1.5">
          {activeChips.map((chip, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-info-bg/30 text-info text-[10px] border border-info/20 font-medium">
              {chip.label}: {chip.val}
              <button
                type="button"
                onClick={() => {
                  const currentVal = filters[chip.key] || [];
                  onChange(chip.key, currentVal.filter((x: string) => x !== chip.val));
                }}
                className="hover:text-foreground text-muted-foreground/60 transition ml-0.5 text-[11px] font-bold"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function InvestegateFilterSelector({
  filters,
  onChange,
}: {
  filters: Record<string, string[]>;
  onChange: (key: string, val: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const fields = SOURCE_FILTER_SCHEMAS["Investegate"] || [];
  const activeChips = fields.flatMap(f => {
    const val = filters[f.key] || [];
    return val.map(v => ({ key: f.key, label: f.label, val: v }));
  });

  return (
    <div className="space-y-2 max-w-lg">
      <div className="relative inline-block text-left">
        <button
          type="button"
          onClick={() => { setIsOpen(!isOpen); setActiveKey(null); }}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] bg-secondary hover:bg-secondary/80 rounded-md font-semibold text-foreground transition-colors border border-border"
        >
          <span>Configure Filters</span>
          <span className="text-[10px] text-muted-foreground/60">▼</span>
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setActiveKey(null); }} />
            <div className="absolute left-0 mt-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 flex flex-col">
              {fields.map((s) => {
                const isSelected = (filters[s.key] || []).length > 0;
                const isCurrentActive = activeKey === s.key;
                return (
                  <div key={s.key} className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveKey(isCurrentActive ? null : s.key)}
                      className={[
                        "flex items-center justify-between w-full px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-left text-foreground font-semibold",
                        isCurrentActive ? "bg-secondary/60" : ""
                      ].join(" ")}
                    >
                      <span>{s.label} {isSelected && `(${filters[s.key].length})`}</span>
                      <span className="text-[10px] text-muted-foreground/60">&gt;</span>
                    </button>

                    {isCurrentActive && (
                      <div className="absolute left-full top-0 ml-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 max-h-60 overflow-y-auto">
                        {s.options.map((opt) => {
                          const selectedVals = filters[s.key] || [];
                          const active = selectedVals.includes(opt);
                          return (
                            <label
                              key={opt}
                              className="flex items-center px-3 py-1.5 hover:bg-secondary/60 text-[12px] cursor-pointer text-foreground font-medium"
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => {
                                  const updated = active
                                    ? selectedVals.filter(x => x !== opt)
                                    : [...selectedVals, opt];
                                  onChange(s.key, updated);
                                }}
                                className="mr-2 accent-primary h-3.5 w-3.5 rounded border-gray-300"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border/40 mt-1.5">
          {activeChips.map((chip, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-info-bg/30 text-info text-[10px] border border-info/20 font-medium">
              {chip.label}: {chip.val}
              <button
                type="button"
                onClick={() => {
                  const currentVal = filters[chip.key] || [];
                  onChange(chip.key, currentVal.filter((x: string) => x !== chip.val));
                }}
                className="hover:text-foreground text-muted-foreground/60 transition ml-0.5 text-[11px] font-bold"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TurkeyBrokersFilterSelector({
  filters,
  onChange,
}: {
  filters: Record<string, string[]>;
  onChange: (key: string, val: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const fields = SOURCE_FILTER_SCHEMAS["TurkeyBrokers"] || [];
  const activeChips = fields.flatMap(f => {
    const val = filters[f.key] || [];
    return val.map(v => ({ key: f.key, label: f.label, val: v }));
  });

  return (
    <div className="space-y-2 max-w-lg">
      <div className="relative inline-block text-left">
        <button
          type="button"
          onClick={() => { setIsOpen(!isOpen); setActiveKey(null); }}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] bg-secondary hover:bg-secondary/80 rounded-md font-semibold text-foreground transition-colors border border-border"
        >
          <span>Configure Filters</span>
          <span className="text-[10px] text-muted-foreground/60">▼</span>
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setActiveKey(null); }} />
            <div className="absolute left-0 mt-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 flex flex-col">
              {fields.map((s) => {
                const isSelected = (filters[s.key] || []).length > 0;
                const isCurrentActive = activeKey === s.key;
                return (
                  <div key={s.key} className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveKey(isCurrentActive ? null : s.key)}
                      className={[
                        "flex items-center justify-between w-full px-3 py-1.5 hover:bg-secondary/60 text-[12px] text-left text-foreground font-semibold",
                        isCurrentActive ? "bg-secondary/60" : ""
                      ].join(" ")}
                    >
                      <span>{s.label} {isSelected && `(${filters[s.key].length})`}</span>
                      <span className="text-[10px] text-muted-foreground/60">&gt;</span>
                    </button>

                    {isCurrentActive && (
                      <div className="absolute left-full top-0 ml-1 w-56 rounded-md shadow-lg bg-card border border-border z-50 py-1 max-h-60 overflow-y-auto">
                        {s.options.map((opt) => {
                          const selectedVals = filters[s.key] || [];
                          const active = selectedVals.includes(opt);
                          return (
                            <label
                              key={opt}
                              className="flex items-center px-3 py-1.5 hover:bg-secondary/60 text-[12px] cursor-pointer text-foreground font-medium"
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => {
                                  const updated = active
                                    ? selectedVals.filter(x => x !== opt)
                                    : [...selectedVals, opt];
                                  onChange(s.key, updated);
                                }}
                                className="mr-2 accent-primary h-3.5 w-3.5 rounded border-gray-300"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border/40 mt-1.5">
          {activeChips.map((chip, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-info-bg/30 text-info text-[10px] border border-info/20 font-medium">
              {chip.label}: {chip.val}
              <button
                type="button"
                onClick={() => {
                  const currentVal = filters[chip.key] || [];
                  onChange(chip.key, currentVal.filter((x: string) => x !== chip.val));
                }}
                className="hover:text-foreground text-muted-foreground/60 transition ml-0.5 text-[11px] font-bold"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeScheduleStep({
  sel,
  setSel,
  updateItem,
  removeItem,
  onBack,
  onNext,
}: {
  sel: Selection;
  setSel: (u: (s: Selection) => Selection) => void;
  updateItem: (id: number, patch: Partial<SourceItem>) => void;
  removeItem: (id: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [activeConfigKey, setActiveConfigKey] = useState<string | null>(null);

  function applyAll(patch: Partial<SourceItem>) {
    setSel((s) => ({ ...s, items: s.items.map((i) => ({ ...i, ...patch })) }));
  }

  const getFilters = (criteria: string, botName: string) => {
    try {
      if (!criteria.trim() || !criteria.startsWith("{")) {
        return {};
      }
      const parsed = JSON.parse(criteria);
      const schema = SOURCE_FILTER_SCHEMAS[botName] || [];
      const result: Record<string, string[]> = {};
      schema.forEach(s => {
        const val = parsed[s.key];
        result[s.key] = Array.isArray(val) ? val : val ? [val] : [];
      });
      return result;
    } catch (e) {
      return {};
    }
  };

  const updateFilters = (id: number, botName: string, key: string, val: string[]) => {
    const item = sel.items.find(x => x.id === id);
    const current = getFilters(item?.partialCriteria || "", botName);
    const updated = { ...current, [key]: val };
    updateItem(id, { partialCriteria: JSON.stringify(updated) });
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-[15px]">Scope & schedule</h3>
          <p className="text-[12px] text-muted-foreground">
            Configure each source independently — full vs custom scrape and refresh cadence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Apply to all:</span>
          <Select onChange={(e) => e.target.value && applyAll({ frequency: e.target.value })} value="" className="h-8 w-32 text-[12px]">
            <option value="">Frequency…</option>
            <option value="One-time">One-time</option>
            <option value="Hourly">Recurring: Hourly</option>
            <option value="Daily">Recurring: Daily</option>
            <option value="Weekly">Recurring: Weekly</option>
            <option value="Monthly">Recurring: Monthly</option>
            <option value="On-demand">Recurring: On-demand</option>
            <option value="Custom">Recurring: Custom</option>
          </Select>
          <Select onChange={(e) => e.target.value && applyAll({ scope: e.target.value as "full" | "partial" })} value="" className="h-8 w-32 text-[12px]">
            <option value="">Scope…</option>
            <option value="full">Full Scrape</option>
            <option value="partial">Custom Scrape</option>
          </Select>
        </div>
      </div>

      <div className="rounded-md border border-border overflow-visible">
        <table className="w-full text-[13px]">
          <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold">Source</th>
              <th className="text-left px-3 py-2.5 font-semibold w-44">Scope</th>
              <th className="text-left px-3 py-2.5 font-semibold">Pattern / criteria</th>
              <th className="text-left px-3 py-2.5 font-semibold w-36">Frequency</th>
              <th className="w-10 px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sel.items.map((i) => {
              const filters = getFilters(i.partialCriteria, i.bot.name);
              const activeChips = Object.entries(filters).flatMap(([key, val]) => {
                const arr = Array.isArray(val) ? val : val ? [val] : [];
                return arr.map(v => ({ key, val: v }));
              });

              return (
                <tr key={i.id}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{i.bot.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate max-w-[220px]">{i.bot.url}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Select value={i.scope} onChange={(e) => {
                      const nextScope = e.target.value as "full" | "partial";
                      updateItem(i.id, {
                        scope: nextScope,
                        partialCriteria: nextScope === "full" ? "" : i.partialCriteria,
                        criteriaFiles: nextScope === "full" ? [] : i.criteriaFiles ?? [],
                      });
                      if (nextScope === "full") {
                        setActiveConfigKey((curr) => (curr === `item-${i.id}` ? null : curr));
                      }
                    }} className="h-8 text-[12px]">
                      <option value="full">Full Scrape</option>
                      <option value="partial">Custom Scrape</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {i.scope === "partial" && (
                      <CustomCriteriaEditor
                        active={activeConfigKey === `item-${i.id}`}
                        criteria={i.partialCriteria}
                        files={i.criteriaFiles ?? []}
                        onToggle={() => setActiveConfigKey((curr) => (curr === `item-${i.id}` ? null : `item-${i.id}`))}
                        onChange={(value) => updateItem(i.id, { partialCriteria: value })}
                        onFilesChange={(files) => updateItem(i.id, { criteriaFiles: files })}
                        placeholder="Provide conditions or criteria to scrape."
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <FrequencyWidget
                      value={i.frequency}
                      onChange={(val) => updateItem(i.id, { frequency: val })}
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <button onClick={() => removeItem(i.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {sel.newSite && (
              <tr className="bg-warning-bg/30">
                <td className="px-3 py-2 align-top">
                  <div className="font-medium flex items-center gap-2">
                    {sel.newSite.url} <Badge tone="warning">New</Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground">Onboarding Time: {sel.newSite.analysis.sla}</div>
                </td>
                <td className="px-3 py-2 align-top">
                  <Select
                    value={sel.newSite.scope}
                    onChange={(e) => {
                      const nextScope = e.target.value as "full" | "partial";
                      setSel((s) => ({
                        ...s,
                        newSite: {
                          ...s.newSite!,
                          scope: nextScope,
                          partialCriteria: nextScope === "full" ? "" : s.newSite?.partialCriteria || "",
                          criteriaFiles: nextScope === "full" ? [] : s.newSite?.criteriaFiles ?? [],
                        },
                      }));
                      if (nextScope === "full") {
                        setActiveConfigKey((curr) => (curr === "newSite" ? null : curr));
                      }
                    }}
                    className="h-8 text-[12px]"
                  >
                    <option value="full">Full Scrape</option>
                    <option value="partial">Custom Scrape</option>
                  </Select>
                </td>
                <td className="px-3 py-2 align-top">
                  {sel.newSite.scope === "partial" && (
                    <CustomCriteriaEditor
                      active={activeConfigKey === "newSite"}
                      criteria={sel.newSite.partialCriteria}
                      files={sel.newSite.criteriaFiles ?? []}
                      onToggle={() => setActiveConfigKey((curr) => (curr === "newSite" ? null : "newSite"))}
                      onChange={(value) =>
                        setSel((s) => ({ ...s, newSite: { ...s.newSite!, partialCriteria: value } }))
                      }
                      onFilesChange={(files) =>
                        setSel((s) => ({ ...s, newSite: { ...s.newSite!, criteriaFiles: files } }))
                      }
                      placeholder="Provide conditions or criteria to scrape."
                    />
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <FrequencyWidget
                    value={sel.newSite.frequency}
                    onChange={(val) =>
                      setSel((s) => ({ ...s, newSite: { ...s.newSite!, frequency: val } }))
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <button
                    onClick={() => setSel((s) => ({ ...s, newSite: undefined }))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
        <div>
          <label className="text-[12px] text-muted-foreground">Delivery (applies to all)</label>
          <Select value={sel.delivery} onChange={(e) => setSel((s) => ({ ...s, delivery: e.target.value }))}>
            <option>S3 bucket</option><option>Snowflake</option><option>Webhook</option><option>API pull</option><option>Export</option>
          </Select>
        </div>
        <div>
          <label className="text-[12px] text-muted-foreground">Format</label>
          <Select value={sel.format} onChange={(e) => setSel((s) => ({ ...s, format: e.target.value }))}>
            <option>JSON</option><option>CSV</option><option>Parquet</option>
          </Select>
        </div>
      </div>

      {sel.newSite && (
        <div className="p-3 bg-warning-bg rounded-md text-[12px] text-warning-foreground flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong>New source:</strong> Onboarding Time: <strong>{sel.newSite.analysis.sla}</strong> (complexity {sel.newSite.analysis.complexity}).
            The bot-onboarding team will build it before the first refresh runs.
          </div>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext}>Review <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

function ReviewStep({ sel, onBack }: { sel: Selection; onBack: () => void }) {
  const navigate = useNavigate();
  const total = sel.items.length + (sel.newSite ? 1 : 0);

  const formatReviewCriteria = (criteria: string, botName: string) => {
    try {
      if (!criteria.trim() || criteria === "—" || criteria === "- -") {
        return botName === "Keysight" ? "All Products" : "All Pages";
      }
      if (!criteria.startsWith("{")) {
        return criteria;
      }
      const parsed = JSON.parse(criteria);
      const entries = Object.entries(parsed).filter(([_, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return !!v;
      });
      if (entries.length === 0) {
        return botName === "Keysight" ? "All Products" : "All Pages";
      }
      return entries.map(([_, v]) => {
        if (Array.isArray(v)) {
          return v.join(", ");
        }
        return String(v);
      }).join(", ");
    } catch (e) {
      if (criteria === "—" || criteria === "- -") {
        return botName === "Keysight" ? "All Products" : "All Pages";
      }
      return criteria;
    }
  };

  const handleLaunch = async (): Promise<boolean> => {
    try {
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

      const formatFilters = (criteria: string) => {
        try {
          if (!criteria.trim() || !criteria.startsWith("{")) {
            return criteria || "—";
          }
          const parsed = JSON.parse(criteria);
          const entries = Object.entries(parsed).filter(([_, v]) => {
            if (Array.isArray(v)) return v.length > 0;
            return !!v;
          });
          if (entries.length === 0) return "—";
          return entries.map(([k, v]) => {
            if (Array.isArray(v)) {
              return `${k.toUpperCase()}=${v.join("|")}`;
            }
            return `${k.toUpperCase()}=${v}`;
          }).join(", ");
        } catch (e) {
          return criteria || "—";
        }
      };

      const newJobs: any[] = sel.items.map((i, index) => {
        return {
          id: `J-${Date.now() + index}`,
          source: i.bot.name,
          scope: i.scope === "full" ? "Full Scrape" : "Custom Scrape",
          filters: formatFilters(i.partialCriteria),
          frequency: i.frequency,
          delivery: sel.delivery,
          output_format: sel.format,
          isCustomSource: false,
          mode: i.bot.type === "Registry" ? "Any-Site" : "Site-Specific"
        };
      });

      const launchedAt = new Date().toISOString();
      newJobs.forEach((job) => {
        const isCustomScrape = job.status === "Pending Onboarding" || String(job.scope || "").toLowerCase().includes("custom");
        job.status = isCustomScrape ? "Pending Onboarding" : "Running";
        job.created_at = launchedAt;
      });

      if (sel.newSite) {
        newJobs.push({
          id: `J-${Date.now() + 99}`,
          source: sel.newSite.url,
          scope: sel.newSite.scope === "full" ? "Full Scrape" : "Custom Scrape",
          filters: sel.newSite.partialCriteria || "—",
          frequency: sel.newSite.frequency,
          delivery: sel.delivery,
          output_format: sel.format,
          isCustomSource: true,
          mode: "Site-Specific",
          status: "Pending Onboarding",
          created_at: launchedAt,
          complexity: sel.newSite.analysis.complexity,
          estimated_onboarding_time: sel.newSite.analysis.sla
        });
      }

      writeJobsCache([...readJobsCache(), ...newJobs]);

      const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs/launch`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: newJobs }),
        keepalive: true
      });

      if (!response.ok) {
        console.error("Failed to launch jobs: backend returned", response.status);
        return false;
      }

      return true;
    } catch (err) {
      console.error("Failed to launch jobs:", err);
      return false;
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <h3 className="font-semibold text-[15px]">Ready to launch</h3>
      </div>
      <div className="text-[12px] text-muted-foreground">
        Per-source schedules will be queued. Delivery <strong>{sel.delivery}</strong> · format <strong>{sel.format}</strong>.
      </div>
      <div className="rounded-md border border-border overflow-hidden">
        <div className="px-3 py-2 bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {total} source{total > 1 ? "s" : ""}
        </div>
        <table className="w-full text-[13px]">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Source</th>
              <th className="text-left px-3 py-2 font-semibold">Scope</th>
              <th className="text-left px-3 py-2 font-semibold">Estimated Records</th>
              <th className="text-left px-3 py-2 font-semibold">Frequency</th>
              <th className="text-left px-3 py-2 font-semibold">First run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border max-h-64 overflow-auto">
            {sel.items.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2 truncate max-w-[260px]">{i.bot.name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {i.scope === "full" && (
                    <div className="font-semibold text-foreground">Full Scrape</div>
                  )}
                  {i.scope === "partial" && (
                    <div>
                      <div className="font-semibold text-foreground">Custom Scrape</div>
                      <div className="text-[11px] text-muted-foreground">Criteria: {i.partialCriteria || "All Pages"}</div>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[12px] font-semibold text-muted-foreground">
                  {getEstimatedRecords(i.bot)}
                </td>
                <td className="px-3 py-2">{i.frequency}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-1" /> within 24h
                </td>
              </tr>
            ))}
            {sel.newSite && (
              <tr className="bg-warning-bg/30">
                <td className="px-3 py-2 truncate max-w-[260px]">
                  {sel.newSite.url} <Badge tone="warning">New</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {sel.newSite.scope === "full" && (
                    <div className="font-semibold text-foreground">Full Scrape</div>
                  )}
                  {sel.newSite.scope === "partial" && (
                    <div>
                      <div className="font-semibold text-foreground">Custom Scrape</div>
                      <div className="text-[11px] text-muted-foreground">Criteria: {sel.newSite.partialCriteria || "All Pages"}</div>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[12px] font-semibold text-muted-foreground">
                  Pending onboarding
                </td>
                <td className="px-3 py-2">{sel.newSite.frequency}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-1" /> {sel.newSite.analysis.sla}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button
          onClick={() => {
            void handleLaunch();
            navigate({ to: "/monitoring" });
          }}
        >
          Launch & open Jobs <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

/* ---------- Sample data modal ---------- */

function SampleModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const isKeysight = bot.name === "Keysight";
  const isWebMD = bot.name.toLowerCase() === "webmd";
  const isInvestegate = bot.id === 53;
  const isTurkeyBrokers = bot.id === 255;
  const isRealDataset = isKeysight || isWebMD || isInvestegate || isTurkeyBrokers;

  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(isRealDataset);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isRealDataset) {
      setRows(makeSampleRows(bot));
      setTotalCount(bot.datapoints * 50);
      setLoading(false);
      return;
    }

    let active = true;
    async function fetchSample() {
      setLoading(true);
      setError(null);
      try {
        let baseApiUrl = "";
        if (
          typeof window !== "undefined" &&
          (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
          window.location.port !== "8131"
        ) {
          baseApiUrl = `http://${window.location.hostname}:8131`;
        }

        const endpoint = isKeysight ? "keysight" : isWebMD ? "webmd" : (isTurkeyBrokers ? "turkeybrokers" : "sec");
        const response = await fetch(`${baseApiUrl}/api/v1/demo/${endpoint}/sample`, { credentials: "include" });
        if (!response.ok) {
          throw new Error(`Server returned status ${response.status}`);
        }
        const data = await response.json();
        if (active) {
          const fetchedRecords = data.records || [];
          const slicedRows = fetchedRecords.slice(0, 15);
          setRows(slicedRows);
          setTotalCount(data.records_scraped ?? fetchedRecords.length);
        }
      } catch (err: any) {
        console.error("Failed to load sample:", err);
        if (active) {
          setError(err.message || "Failed to load real records.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    fetchSample();
    return () => {
      active = false;
    };
  }, [bot, isKeysight, isWebMD, isInvestegate, isTurkeyBrokers, isRealDataset]);

  const webmdCols = [
    "Business_Name", "Address", "City", "State", "Zip",
    "Primary_Phone", "Fax_Phone", "Company_Website",
    "Accepting_New_Patients", "Medicare_Accepted", "Medicaid_Accepted",
    "Primary_Contact_Name", "Year_of_Graduation", "Medical_School",
    "Languages_Spoken", "Hospital_Affiliations", "Specialty", "Detail_Url"
  ];
  
  const investegateCols = [
    "Company_Name", "Company_Link", "Article_Link", "Disposition", "Comments", "Disposition_Details", "Article_Subject", "Market", "Listing_Category", "FTSE_index", "FTSE_Sector", "Published_Date", "KeywordsMapped", "Total_MatchKeyword", "Event_Name", "RNS", "Source"
  ];

  const turkeyBrokersCols = [
    "PrimaryKey", "Address", "City"
  ];

  const mappedRows = useMemo(() => {
    return rows.map((r) => {
      if (isInvestegate) {
        return {
          Company_Name: r.Company_Name,
          Company_Link: r.Company_Link,
          Article_Link: r.Article_Link,
          Disposition: r.Disposition,
          Comments: r.Comments,
          Disposition_Details: r.Disposition_Details,
          Article_Subject: r.Article_Subject,
          Market: r.Market,
          Listing_Category: r.Listing_Category,
          FTSE_index: r.FTSE_index,
          FTSE_Sector: r.FTSE_Sector,
          Published_Date: r.Published_Date,
          KeywordsMapped: r.KeywordsMapped,
          Total_MatchKeyword: r.Total_MatchKeyword,
          Event_Name: r.Event_Name,
          RNS: r.RNS,
          Source: r.Source
        };
      }
      if (isTurkeyBrokers) {
        return {
          PrimaryKey: r.PrimaryKey,
          Address: r.Address,
          City: r.City,
        };
      }
      return r;
    });
  }, [rows, isInvestegate, isTurkeyBrokers]);

  const cols = mappedRows.length > 0 
    ? Object.keys(mappedRows[0]) 
    : (isWebMD ? webmdCols : (isInvestegate ? investegateCols : (isTurkeyBrokers ? turkeyBrokersCols : [])));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold">{bot.name} — sample data</div>
            <div className="text-[11px] text-muted-foreground">{bot.url} · {bot.datapoints} attributes · {bot.dataType}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {loading && !isWebMD && !isInvestegate && !isTurkeyBrokers ? (
          <div className="overflow-auto flex-1 flex flex-col items-center justify-center p-8 space-y-3 bg-secondary/10">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent animate-infinite"></div>
            <div className="text-[12px] text-muted-foreground animate-pulse">
              Loading real Keysight dataset...
            </div>
          </div>
        ) : error ? (
          <div className="overflow-auto flex-1 flex items-center justify-center p-8">
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-[13px] text-destructive flex items-start gap-2 max-w-md">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Failed to load sample data</p>
                <p className="text-[12px] mt-1">{error}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-[12px]">
              <thead className="bg-secondary sticky top-0">
                <tr>
                  {cols.map((c) => (
                    <th key={c} style={{ whiteSpace: "nowrap" }} className="text-left px-3 py-2 font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappedRows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {cols.map((c) => (
                      <td key={c} style={{ whiteSpace: "nowrap" }} className="px-3 py-2">
                        {(r as any)[c] !== null && (r as any)[c] !== undefined ? String((r as any)[c]) : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">
            {isKeysight ? (
              "Showing 15 of 25000 records"
            ) : isInvestegate ? (
              "Showing 15 of 1500000 records"
            ) : isTurkeyBrokers ? (
              "Showing 15 of 500 records"
            ) : (bot as any).estimated_records !== undefined ? (
              `Showing ${rows.length} of ${(bot as any).estimated_records.toLocaleString()} records`
            ) : (
              `Showing 15 of ${bot.datapoints * 50}+ rows from last refresh`
            )}
          </div>
          <a href={bot.url} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">Open source <ExternalLink className="h-3.5 w-3.5" /></Button>
          </a>
        </div>
      </div>
    </div>
  );
}

function makeSampleRows(b: Bot) {
  const base: Record<string, any> = {};
  if (b.dataType.toLowerCase().includes("price")) {
    return Array.from({ length: 15 }).map((_, i) => ({
      sku: `${b.name.slice(0, 3).toUpperCase()}-${1000 + i}`,
      product: `${b.industry} item ${i + 1}`,
      price_usd: (49.99 + i * 7.5).toFixed(2),
      in_stock: i % 3 !== 0,
      country: b.country,
      scraped_at: "2026-06-08",
    }));
  }
  if (b.category.includes("Registry")) {
    return Array.from({ length: 15 }).map((_, i) => ({
      company_id: `${b.country}-${100000 + i}`,
      legal_name: `${b.name} Holdings ${i + 1}`,
      status: i % 4 === 0 ? "Dissolved" : "Active",
      incorporated: `20${10 + (i % 14)}-0${(i % 9) + 1}-15`,
      directors: 2 + (i % 5),
      country: b.country,
    }));
  }
  return Array.from({ length: 15 }).map((_, i) => ({
    record_id: i + 1,
    name: `${b.name} record ${i + 1}`,
    category: b.category,
    country: b.country,
    data_type: b.dataType,
    last_updated: "2026-06-08",
    ...base,
  }));
}

/* ---------- Add new source modal ---------- */

function extractDomain(urlStr: string) {
  let hostname = urlStr.trim();
  if (!/^https?:\/\//i.test(hostname)) {
    hostname = "https://" + hostname;
  }
  try {
    const parsed = new URL(hostname);
    return parsed.hostname.replace(/^www\./i, "");
  } catch (e) {
    return urlStr;
  }
}

function findExistingBotMatch(targetUrl: string, bots: Bot[]) {
  let targetHost = "";
  try {
    targetHost = new URL(targetUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    targetHost = extractDomain(targetUrl).replace(/^www\./i, "").toLowerCase();
  }
  if (!targetHost) return null;

  const targetTokens = targetHost.replace(/[^a-z0-9]/g, "");
  return (
    bots.find((bot) => {
      const botHost = extractDomain(String(bot.url || "")).replace(/^www\./i, "").toLowerCase();
      const botName = String(bot.name || "").trim().toLowerCase();
      const botTokens = botName.replace(/[^a-z0-9]/g, "");
      return botHost === targetHost || botHost.replace(/[^a-z0-9]/g, "") === targetTokens || botTokens === targetTokens;
    }) || null
  );
}

function AddSourceModal({
  onClose,
  onSubmit,
  existingBots,
}: { onClose: () => void; onSubmit: (ns: NewSite) => void; existingBots: Bot[] }) {
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("Registry & SEC");
  const [authRequired, setAuthRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState<null | {
    complexity: string;
    sla: string;
    pages: string;
    reason: string;
    recommended_scraper_type: string;
    estimated_development_effort: string;
    blockingLevel: string;
  }>(null);

  async function analyze() {
    setUrlError(null);
    if (!url || !desc) return;

    // URL validation
    const urlPattern = /^(https?:\/\/)?([\w\-]+\.)+[\w\-]{2,}(\/.*)?$/;
    if (!urlPattern.test(url.trim())) {
      setUrlError("Please enter a valid website URL or domain.");
      return;
    }

    setLoading(true);
    setError(null);
    setAnalyzed(null);

    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    const cleanName = extractDomain(targetUrl);
    const existingMatch = findExistingBotMatch(targetUrl, existingBots);
    if (existingMatch) {
      setUrlError(`${existingMatch.name || cleanName} already exists in Sources & Agents.`);
      setLoading(false);
      return;
    }

    try {
      let baseApiUrl = "";
      if (
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
        window.location.port !== "8131"
      ) {
        baseApiUrl = `http://${window.location.hostname}:8131`;
      }

      const response = await fetch(`${baseApiUrl}/api/v1/source-analysis/analyze`, {
        credentials: "include",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_name: cleanName,
          website_url: targetUrl,
          pages_to_scan: 10,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();

      const complexity = data.analysis_summary.complexity_level;
      const scraperType = data.analysis_summary.recommended_scraper_type;
      const effort = data.analysis_summary.estimated_development_effort;

      const sla = effort;

      // Estimated Volume derivation from complexity (records, not page count):
      let volume = "~10K - 100K records";
      if (complexity === "Easy" || complexity === "Simple") {
        volume = "~1K - 10K records";
      } else if (complexity === "Medium") {
        volume = "~10K - 100K records";
      } else if (complexity === "Hard") {
        volume = "~100K - 1M records";
      } else if (complexity === "Very Hard") {
        volume = "1M+ records";
      }

      const blockingLevel = data.site_characteristics.blocking_level || "Light";

      // Simplify the Why section:
      let reason = "";
      if (complexity === "Easy" || complexity === "Simple") {
        reason = "Publicly accessible site with minimal protection.";
      } else if (complexity === "Medium") {
        reason = "Dynamic content and moderate protection require additional setup.";
      } else if (complexity === "Hard") {
        reason = "Advanced anti-bot measures require specialized scraping infrastructure.";
      } else if (complexity === "Very Hard") {
        reason = "Strong authentication and platform protections significantly increase implementation effort.";
      }

      // Add a secondary business-oriented sentence if specific features are detected:
      let additional = [];
      if (data.site_characteristics.captcha_present) {
        additional.push("Requires CAPTCHA bypass integration.");
      }
      if (authRequired || data.site_characteristics.auth_required) {
        additional.push("Authentication / login flow setup is required.");
      }
      if (additional.length > 0) {
        reason += " " + additional.join(" ");
      }

      setAnalyzed({
        complexity,
        sla,
        pages: volume,
        reason,
        recommended_scraper_type: scraperType,
        estimated_development_effort: effort,
        blockingLevel,
      });
    } catch (err: any) {
      console.error("Analysis failed:", err);
      setError(err.message || "Failed to run AI analysis");
      setAnalyzed(null);
    } finally {
      setLoading(false);
    }
  }

  const handleUseSource = () => {
    if (!analyzed) return;

    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }
    const cleanName = extractDomain(targetUrl);

    const newRecord = {
      source_name: cleanName,
      website_url: targetUrl,
      category,
      complexity: analyzed.complexity,
      recommended_scraper_type: analyzed.recommended_scraper_type,
      estimated_development_effort: analyzed.estimated_development_effort,
      status: "Analysis Complete",
      created_at: new Date().toISOString(),
    };

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

    try {
      fetch(`${baseApiUrl}/api/v1/demo/jobs/create_pending`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRecord)
      }).catch(err => console.error("Failed to create pending job on backend:", err));
    } catch (err) {
      console.error("Failed to save source to backend", err);
    }

    onSubmit({
      url: targetUrl,
      category,
      description: desc,
      authRequired,
      analysis: {
        complexity: analyzed.complexity,
        sla: analyzed.sla,
        pages: analyzed.pages,
        reason: analyzed.reason,
      },
      scope: "full",
      partialCriteria: "",
      frequency: "Weekly",
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-info" />
            <div className="text-[14px] font-semibold">Add a new source</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-[12px] text-muted-foreground">Site URL <span className="text-muted-foreground">(full or partial pattern)</span></label>
              <Input 
                value={url} 
                onChange={(e) => { 
                  setUrl(e.target.value); 
                  setUrlError(null); 
                }} 
                placeholder="https://example.com  OR  example.com/products/*" 
              />
              {urlError && (
                <div className="text-destructive text-[11px] mt-1">
                  {urlError}
                </div>
              )}
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground">Category</label>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option>Business Directory</option>
                <option>Construction</option>
                <option>Energy & Utilities</option>
                <option>Government & Regulatory</option>
                <option>Healthcare</option>
                <option>Job Boards</option>
                <option>Other</option>
                <option>RFP & Tenders</option>
                <option>Real Estate</option>
                <option>Registry & SEC</option>
                <option>Retail & E-Commerce</option>
                <option>Social Media</option>
                <option>Store Locator</option>
                <option>Travel</option>
              </Select>
            </div>
            <label className="flex items-center gap-2 mt-6 text-[13px]">
              <input type="checkbox" checked={authRequired} onChange={(e) => setAuthRequired(e.target.checked)} className="accent-primary" />
              Requires login / authentication
            </label>
            <div className="md:col-span-2">
              <label className="text-[12px] text-muted-foreground">What data do you need? Any specific criteria?</label>
              <textarea
                value={desc} onChange={(e) => setDesc(e.target.value)}
                placeholder="e.g. Director names + filings from listings in California, refreshed weekly."
                className="w-full min-h-[100px] p-2.5 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>

          {!analyzed && !loading && (
            <div className="flex justify-end">
              <Button onClick={analyze} disabled={!url || !desc}><Sparkles className="h-4 w-4" /> Analyze with AI</Button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center p-6 space-y-3 bg-secondary/30 rounded-md">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent animate-infinite"></div>
              <div className="text-[12px] text-muted-foreground animate-pulse">
                Crawling site and running heuristics with AI...
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-[12px] text-destructive flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                Unable to analyze this website. The website could not be reached or does not exist. Please verify the URL and try again.
              </div>
            </div>
          )}

          {analyzed && (
            <div className="space-y-3">
              <div className="text-[11px] text-red-500 dark:text-red-400 font-medium">
                Onboarding timeline is indicative and subject to change.
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Complexity">
                  <Badge tone={analyzed.complexity === "Simple" || analyzed.complexity === "Easy" ? "success" : analyzed.complexity === "Medium" ? "warning" : "destructive"}>
                    {analyzed.complexity}
                  </Badge>
                </Stat>
                <Stat label="Estimated Onboarding Time">{analyzed.sla}</Stat>
                <Stat label="Estimated Volume">{analyzed.pages}</Stat>
                <Stat label="Blocking Level">
                  <Badge tone={
                    analyzed.blockingLevel === "Light" ? "success" :
                    analyzed.blockingLevel === "Moderate" ? "warning" :
                    "destructive"
                  }>
                    {analyzed.blockingLevel}
                  </Badge>
                </Stat>
              </div>
              <div className="p-3 bg-info-bg rounded-md text-[12px] text-info"><strong>Why:</strong> {analyzed.reason}</div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setAnalyzed(null)}>Re-analyze</Button>
                <Button onClick={handleUseSource}>
                  Use this source <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-secondary/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-[14px] font-semibold mt-1">{children}</div>
    </div>
  );
}

/* ---------- Jobs ---------- */

const MOCK_JOBS = [
  { name: "SEC EDGAR", scope: "Full dump", freq: "Daily", status: "Running", next: "in 4h", kind: "existing" },
  { name: "Companies House UK", scope: "Custom — /company/*", freq: "Weekly", status: "Healthy", next: "Mon 09:00", kind: "existing" },
  { name: "wayfair.com/furniture/*", scope: "Custom dump", freq: "Daily", status: "Awaiting bot onboarding", next: "ETA 5 days", kind: "new" },
  { name: "Bombay Stock Exchange", scope: "Full dump", freq: "Daily", status: "Healthy", next: "in 2h", kind: "existing" },
];

function JobsPanel() {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <SectionTitle hint="active refreshes & onboarding queue">Jobs</SectionTitle>
      </div>
      <div className="divide-y divide-border">
        {MOCK_JOBS.map((j) => (
          <div key={j.name} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[13px] truncate">{j.name}</span>
                {j.kind === "new" && <Badge tone="warning">New</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">{j.scope} · {j.freq}</div>
            </div>
            <Badge tone={j.status === "Awaiting bot onboarding" ? "warning" : j.status === "Running" ? "info" : "success"}>
              {j.status}
            </Badge>
            <div className="text-[11px] text-muted-foreground w-24 text-right">{j.next}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
