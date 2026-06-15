import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, Select, SectionTitle, Steps } from "@/components/ui-bits";
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
  scope: "full" | "partial" | "custom";
  partialCriteria: string;
  frequency: string;
};


type NewSite = {
  url: string;
  category: string;
  description: string;
  authRequired: boolean;
  analysis: { complexity: string; sla: string; pages: string; reason: string };
  scope: "full" | "partial" | "custom";
  partialCriteria: string;
  frequency: string;
};

type Selection = {
  items: SourceItem[];
  newSite?: NewSite;
  delivery: string;
  format: string;
};

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
      .slice(0, 120);
  }, [all, q, category, complexity, country]);

  const selectedIds = useMemo(() => new Set(sel.items.map((i) => i.bot.id)), [sel.items]);
  const hasSelection = sel.items.length > 0 || !!sel.newSite;

  function toggle(b: Bot) {
    setSel((s) => {
      const exists = s.items.some((x) => x.bot.id === b.id);
      if (exists) return { ...s, items: s.items.filter((x) => x.bot.id !== b.id) };
      return {
        ...s,
        items: [...s.items, { id: b.id, bot: b, scope: "full", partialCriteria: "", frequency: "Weekly" }],
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
          merged.push({ id: b.id, bot: b, scope: "full", partialCriteria: "", frequency: "Weekly" });
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
                    placeholder={`Search ${all.length} sources by name, URL, industry, country, data type…`}
                    className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
                  />
                </div>
                <Button variant="outline" onClick={() => setShowAdd(true)} className="h-10 shrink-0">
                  <PlusCircle className="h-4 w-4" /> Add new source
                </Button>
                <Select value={category} onChange={(e) => setCategory(e.target.value)} className="lg:w-52">
                  <option value="All">All categories</option>
                  {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Select value={country} onChange={(e) => setCountry(e.target.value)} className="lg:w-40">
                  <option value="All">Any country</option>
                  {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Select value={complexity} onChange={(e) => setComplexity(e.target.value)} className="lg:w-40">
                  <option value="All">Any complexity</option>
                  <option>Simple</option>
                  <option>Medium</option>
                  <option>Complex</option>
                </Select>
              </div>
            </Card>

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
                            <button onClick={(e) => { e.stopPropagation(); setPreviewBot(b); }} className="text-[11px] text-info hover:underline inline-flex items-center gap-1">
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
            Configure each source independently — full vs partial dump and refresh cadence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Apply to all:</span>
          <Select onChange={(e) => e.target.value && applyAll({ frequency: e.target.value })} value="" className="h-8 w-32 text-[12px]">
            <option value="">Frequency…</option>
            <option value="2 Minutes">2 Minutes</option>
            <option>Daily</option><option>Weekly</option><option>Monthly</option><option>Quarterly</option>
          </Select>
          <Select onChange={(e) => e.target.value && applyAll({ scope: e.target.value as "full" | "partial" | "custom" })} value="" className="h-8 w-32 text-[12px]">
            <option value="">Scope…</option>
            <option value="full">Full dump</option>
            <option value="partial">Partial dump</option>
            <option value="custom">Custom</option>
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
                      updateItem(i.id, { scope: e.target.value as "full" | "partial" | "custom", partialCriteria: "" });
                    }} className="h-8 text-[12px]">
                      <option value="full">Full dump</option>
                      <option value="partial">Partial dump</option>
                      <option value="custom">Custom</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {i.scope === "full" && (
                      <Input disabled value="—" className="h-8 text-[12px]" />
                    )}

                    {i.scope === "partial" && (
                      i.bot.name === "Keysight" ? (
                        <KeysightFilterSelector
                          filters={filters}
                          onChange={(key, val) => updateFilters(i.id, i.bot.name, key, val)}
                        />
                      ) : i.bot.name === "Webmd" ? (
                        <WebmdFilterSelector
                          filters={filters}
                          onChange={(key, val) => updateFilters(i.id, i.bot.name, key, val)}
                        />
                      ) : i.bot.name === "Investegate" ? (
                        <InvestegateFilterSelector
                          filters={filters}
                          onChange={(key, val) => updateFilters(i.id, i.bot.name, key, val)}
                        />
                      ) : i.bot.name === "TurkeyBrokers" ? (
                        <TurkeyBrokersFilterSelector
                          filters={filters}
                          onChange={(key, val) => updateFilters(i.id, i.bot.name, key, val)}
                        />
                      ) : (
                        <Input
                          value={i.partialCriteria}
                          onChange={(e) => updateItem(i.id, { partialCriteria: e.target.value })}
                          placeholder="/products/* or specific criteria"
                          className="h-8 text-[12px]"
                        />
                      )
                    )}

                    {i.scope === "custom" && (
                      <Input
                        value={i.partialCriteria}
                        onChange={(e) => updateItem(i.id, { partialCriteria: e.target.value })}
                        placeholder="e.g. Only pull California state records"
                        className="h-8 text-[12px]"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Select value={i.frequency} onChange={(e) => updateItem(i.id, { frequency: e.target.value })} className="h-8 text-[12px]">
                      <option value="2 Minutes">2 Minutes</option>
                      <option>Daily</option><option>Weekly</option><option>Monthly</option><option>Quarterly</option>
                    </Select>
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
                      setSel((s) => ({ ...s, newSite: { ...s.newSite!, scope: e.target.value as "full" | "partial" | "custom", partialCriteria: "" } }));
                    }}
                    className="h-8 text-[12px]"
                  >
                    <option value="full">Full dump</option>
                    <option value="partial">Partial dump</option>
                    <option value="custom">Custom</option>
                  </Select>
                </td>
                <td className="px-3 py-2 align-top">
                  {sel.newSite.scope === "full" && (
                    <Input disabled value="—" className="h-8 text-[12px]" />
                  )}

                  {sel.newSite.scope === "partial" && (
                    <Input
                      value={sel.newSite.partialCriteria}
                      onChange={(e) =>
                        setSel((s) => ({ ...s, newSite: { ...s.newSite!, partialCriteria: e.target.value } }))
                      }
                      placeholder="/path/*"
                      className="h-8 text-[12px]"
                    />
                  )}

                  {sel.newSite.scope === "custom" && (
                    <Input
                      value={sel.newSite.partialCriteria}
                      onChange={(e) =>
                        setSel((s) => ({ ...s, newSite: { ...s.newSite!, partialCriteria: e.target.value } }))
                      }
                      placeholder="e.g. Only pull pages matching certain keywords"
                      className="h-8 text-[12px]"
                    />
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <Select
                    value={sel.newSite.frequency}
                    onChange={(e) =>
                      setSel((s) => ({ ...s, newSite: { ...s.newSite!, frequency: e.target.value } }))
                    }
                    className="h-8 text-[12px]"
                  >
                    <option value="2 Minutes">2 Minutes</option>
                    <option>Daily</option><option>Weekly</option><option>Monthly</option><option>Quarterly</option>
                  </Select>
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
            <option>S3 bucket</option><option>Snowflake</option><option>Webhook</option><option>API pull</option>
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

  const handleLaunch = async () => {
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
          scope: i.scope === "full" ? "Full Dump" : i.scope === "partial" ? "Partial Dump" : "Custom",
          filters: formatFilters(i.partialCriteria),
          frequency: i.frequency,
          delivery: sel.delivery,
          output_format: sel.format,
          isCustomSource: false,
          mode: i.bot.type === "Registry" ? "Any-Site" : "Site-Specific"
        };
      });

      if (sel.newSite) {
        newJobs.push({
          id: `J-${Date.now() + 99}`,
          source: sel.newSite.url,
          scope: sel.newSite.scope === "full" ? "Full Dump" : sel.newSite.scope === "partial" ? "Partial Dump" : "Custom",
          filters: sel.newSite.partialCriteria || "—",
          frequency: sel.newSite.frequency,
          delivery: sel.delivery,
          output_format: sel.format,
          isCustomSource: true,
          mode: "Site-Specific",
          complexity: sel.newSite.analysis.complexity,
          estimated_onboarding_time: sel.newSite.analysis.sla
        });
      }

      await fetch(`${baseApiUrl}/api/v1/demo/jobs/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: newJobs })
      });
    } catch (err) {
      console.error("Failed to launch jobs:", err);
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
                    <div className="font-semibold text-foreground">Full Dump</div>
                  )}
                  {i.scope === "partial" && (
                    <div>
                      <div className="font-semibold text-foreground">Partial Dump</div>
                      <div className="text-[11px] text-muted-foreground">Criteria: {formatReviewCriteria(i.partialCriteria, i.bot.name)}</div>
                    </div>
                  )}
                  {i.scope === "custom" && (
                    <div>
                      <div className="font-semibold text-foreground">Custom</div>
                      <div className="text-[11px] text-muted-foreground">Criteria: "{(!i.partialCriteria || i.partialCriteria === "—" || i.partialCriteria === "- -") ? "Only products updated in last 30 days" : i.partialCriteria}"</div>
                    </div>
                  )}
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
                    <div className="font-semibold text-foreground">Full Dump</div>
                  )}
                  {sel.newSite.scope === "partial" && (
                    <div>
                      <div className="font-semibold text-foreground">Partial Dump</div>
                      <div className="text-[11px] text-muted-foreground">Criteria: {(!sel.newSite.partialCriteria || sel.newSite.partialCriteria === "—" || sel.newSite.partialCriteria === "- -") ? "All Pages" : sel.newSite.partialCriteria}</div>
                    </div>
                  )}
                  {sel.newSite.scope === "custom" && (
                    <div>
                      <div className="font-semibold text-foreground">Custom</div>
                      <div className="text-[11px] text-muted-foreground">Criteria: "{(!sel.newSite.partialCriteria || sel.newSite.partialCriteria === "—" || sel.newSite.partialCriteria === "- -") ? "Only products updated in last 30 days" : sel.newSite.partialCriteria}"</div>
                    </div>
                  )}
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
          onClick={async () => {
            await handleLaunch();
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

        const endpoint = isKeysight ? "keysight" : isWebMD ? "webmd" : "sec";
        const response = await fetch(`${baseApiUrl}/api/v1/demo/${endpoint}/sample`);
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
    "company_name", "ticker", "submission_time", "announcement_type", "category"
  ];

  const turkeyBrokersCols = [
    "PrimaryKey", "Address", "City"
  ];

  const mappedRows = useMemo(() => {
    return rows.map((r) => {
      if (isInvestegate) {
        return {
          company_name: r.entity_name,
          ticker: r.ticker,
          submission_time: r.filing_date,
          announcement_type: r.filing_type,
          category: r.sic_description,
        };
      }
      if (isTurkeyBrokers) {
        const extractCity = (addr?: string) => {
          if (!addr) return "";
          const parts = addr.split(",").map(p => p.trim());
          if (parts.length >= 3) {
            return parts[parts.length - 3];
          }
          return parts[0] || "";
        };
        return {
          PrimaryKey: r.entity_name || null,
          Address: r.business_address || null,
          City: extractCity(r.business_address) || null,
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

function AddSourceModal({
  onClose,
  onSubmit,
}: { onClose: () => void; onSubmit: (ns: NewSite) => void }) {
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
                <option>Registry & SEC</option><option>Stock Exchange</option><option>Government / Regulatory</option>
                <option>Retail & E-Commerce</option><option>Financial Services</option><option>News & Media</option><option>Other</option>
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
  { name: "Companies House UK", scope: "Partial — /company/*", freq: "Weekly", status: "Healthy", next: "Mon 09:00", kind: "existing" },
  { name: "wayfair.com/furniture/*", scope: "Partial dump", freq: "Daily", status: "Awaiting bot onboarding", next: "ETA 5 days", kind: "new" },
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
