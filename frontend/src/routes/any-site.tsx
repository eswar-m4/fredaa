import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, Select, Steps } from "@/components/ui-bits";
import { ATTRIBUTES, CATEGORY_ORDER, Attribute } from "@/data/attributes";
import { WORKFLOWS } from "@/data/workflows";
import { Sparkles, ArrowRight, Upload, Wand2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/any-site")({
  head: () => ({ meta: [{ title: "Open Web – FreshData AI" }] }),
  component: AnySite,
});

const STEPS = ["Import Data", "Select Attributes", "Field Mapping", "Workflows", "Schedule & Launch"];

// Pretend customer fields they uploaded:
const SAMPLE_CUSTOMER_FIELDS = [
  "cust_company",
  "trading_name",
  "industry_segment",
  "annual_rev_usd",
  "company_phone_main",
  "ceo_name",
  "ceo_email",
  "linkedin_page",
  "hq_country",
  "ein_number",
];

// Mock AI mapping heuristic
function aiSuggest(customer: string): { attr: Attribute | null; confidence: number } {
  const c = customer.toLowerCase();
  const candidates: { keys: string[]; key: string; conf: number }[] = [
    { keys: ["company", "trading", "trade"], key: "company_name", conf: 0.96 },
    { keys: ["legal"], key: "legal_name", conf: 0.94 },
    { keys: ["industry", "segment", "sector"], key: "industry", conf: 0.92 },
    { keys: ["revenue", "rev", "sales"], key: "revenue", conf: 0.95 },
    { keys: ["phone", "tel"], key: "contact_phone", conf: 0.9 },
    { keys: ["ceo", "name"], key: "contact_name", conf: 0.78 },
    { keys: ["email"], key: "contact_email", conf: 0.93 },
    { keys: ["linkedin"], key: "linkedin_url", conf: 0.97 },
    { keys: ["country"], key: "country", conf: 0.96 },
    { keys: ["ein", "tax"], key: "tax_id", conf: 0.95 },
  ];
  for (const cand of candidates) {
    if (cand.keys.some((k) => c.includes(k))) {
      const a = ATTRIBUTES.find((x) => x.key === cand.key) || null;
      return { attr: a, confidence: cand.conf };
    }
  }
  return { attr: null, confidence: 0 };
}

function AnySite() {
  const [step, setStep] = useState(0);
  const [importMethod, setImportMethod] = useState<"csv" | "paste" | "api" | "sample">("sample");
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [customerFields, setCustomerFields] = useState<string[]>(SAMPLE_CUSTOMER_FIELDS);
  const [rowCount, setRowCount] = useState<number>(1248);
  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([
    "company_name", "industry", "revenue", "contact_email", "registry_number",
  ]);
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    SAMPLE_CUSTOMER_FIELDS.forEach((f) => {
      const s = aiSuggest(f);
      if (s.attr) m[f] = s.attr.key;
    });
    return m;
  });
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>(["wf-company-extraction", "wf-nap-discovery", "wf-registry-multi"]);
  const [frequency, setFrequency] = useState("Weekly");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const lines = text.split(/\r?\n/).filter(Boolean);
      const header = (lines[0] || "").split(",").map((h) => h.trim()).filter(Boolean);
      if (header.length) {
        setCustomerFields(header);
        const m: Record<string, string> = {};
        header.forEach((h) => {
          const s = aiSuggest(h);
          if (s.attr) m[h] = s.attr.key;
        });
        setMapping(m);
        setRowCount(Math.max(0, lines.length - 1));
      }
    };
    reader.readAsText(f);
  }

  function applyPasted() {
    const header = pasted.split(/\r?\n/)[0]?.split(/[,\t]/).map((h) => h.trim()).filter(Boolean) || [];
    if (!header.length) return;
    setCustomerFields(header);
    const m: Record<string, string> = {};
    header.forEach((h) => {
      const s = aiSuggest(h);
      if (s.attr) m[h] = s.attr.key;
    });
    setMapping(m);
    setRowCount(pasted.split(/\r?\n/).filter(Boolean).length - 1);
  }


  const grouped = useMemo(() => {
    const out: Record<string, Attribute[]> = {};
    for (const c of CATEGORY_ORDER) out[c] = [];
    for (const a of ATTRIBUTES) out[a.category].push(a);
    return out;
  }, []);

  function toggleAttr(key: string) {
    setSelectedAttrs((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
  }
  function toggleWf(id: string) {
    setSelectedWorkflows((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <AppLayout>
      <PageHeader
        title="Open Web Data Discovery"
        subtitle="Tell us what you need. AI maps your fields to our B2B golden superset and chains the right workflows."
        actions={
          <Link to="/site-specific">
            <Button variant="ghost" size="sm">
              ← Switch to Targeted Sources
            </Button>
          </Link>
        }
      />

      <div className="px-7 pb-8 space-y-6">
        <Card className="p-4">
          <Steps steps={STEPS} current={step} />
        </Card>

        {step === 0 && (
          <>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-[15px]">Import your data</h3>
                  <p className="text-[12px] text-muted-foreground">
                    Bring the records you want enriched. We read your column headers and use them to pre-build the field mapping.
                  </p>
                </div>
                {fileName && <Badge tone="success">{fileName}</Badge>}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {[
                  { id: "csv", label: "Upload CSV", icon: Upload },
                  { id: "paste", label: "Paste headers", icon: Wand2 },
                  { id: "api", label: "Connect API", icon: Sparkles },
                  { id: "sample", label: "Use sample dataset", icon: CheckCircle2 },
                ].map((m) => {
                  const on = importMethod === (m.id as any);
                  return (
                    <button
                      key={m.id}
                      onClick={() => setImportMethod(m.id as any)}
                      className={[
                        "p-3 rounded-lg border text-left transition",
                        on ? "border-primary bg-info-bg/40 ring-1 ring-primary/30" : "border-border bg-card hover:bg-secondary",
                      ].join(" ")}
                    >
                      <m.icon className="h-4 w-4 mb-1.5 text-muted-foreground" />
                      <div className="text-[12px] font-semibold">{m.label}</div>
                    </button>
                  );
                })}
              </div>

              {importMethod === "csv" && (
                <div className="border border-dashed border-border rounded-lg p-6 text-center">
                  <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                  <p className="text-[13px] mb-3">Drop a CSV here or click to browse</p>
                  <label className="inline-block">
                    <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
                    <span className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium cursor-pointer">
                      Choose file
                    </span>
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-2">First row should contain column headers</p>
                </div>
              )}

              {importMethod === "paste" && (
                <div className="space-y-2">
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={"cust_company,industry_segment,annual_rev_usd,ceo_email,linkedin_page\nAcme Inc,SaaS,12000000,jane@acme.com,..."}
                    className="w-full min-h-[140px] p-2.5 rounded-md border border-input bg-card text-[12px] font-mono outline-none focus:ring-2 focus:ring-ring/40"
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={applyPasted} disabled={!pasted.trim()}>
                      <Wand2 className="h-3.5 w-3.5" /> Parse headers
                    </Button>
                  </div>
                </div>
              )}

              {importMethod === "api" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] text-muted-foreground">Source system</label>
                    <Select defaultValue="Salesforce">
                      <option>Salesforce</option>
                      <option>HubSpot</option>
                      <option>Snowflake table</option>
                      <option>S3 / parquet</option>
                      <option>Custom REST</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground">Object / table</label>
                    <Input placeholder="Account" />
                  </div>
                  <div className="md:col-span-2 p-3 bg-info-bg rounded-md text-[12px] text-info">
                    We'll pull the schema and pre-fill the mapping step. Credentials are handled by your admin in Export & Sync.
                  </div>
                </div>
              )}

              {importMethod === "sample" && (
                <div className="p-3 bg-secondary/60 rounded-md text-[12px]">
                  Loaded a sample of {SAMPLE_CUSTOMER_FIELDS.length} typical B2B fields with {rowCount.toLocaleString()} rows so you can preview the rest of the flow without uploading data.
                </div>
              )}

              {customerFields.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Detected columns ({customerFields.length})
                    </div>
                    <div className="text-[12px] text-muted-foreground">{rowCount.toLocaleString()} rows</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {customerFields.map((f) => (
                      <span key={f} className="px-2 py-1 rounded-md bg-card border border-border text-[11px] font-mono">{f}</span>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <div className="flex justify-end">
              <Button onClick={() => setStep(1)} disabled={customerFields.length === 0}>
                Next: Select Attributes <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-[15px]">Pick from the B2B superset</h3>
                  <p className="text-[12px] text-muted-foreground">
                    Choose which attributes you want enriched on every row of your imported data.
                  </p>
                </div>
                <Badge tone="info">{selectedAttrs.length} selected</Badge>
              </div>
              <div className="space-y-4">
                {CATEGORY_ORDER.map((cat) => (
                  <div key={cat}>
                    <div className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{cat}</div>
                    <div className="flex flex-wrap gap-2">
                      {grouped[cat].map((a) => {
                        const on = selectedAttrs.includes(a.key);
                        return (
                          <button
                            key={a.key}
                            onClick={() => toggleAttr(a.key)}
                            title={a.description}
                            className={[
                              "px-2.5 py-1.5 rounded-md border text-[12px] transition",
                              on
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-card border-border hover:bg-secondary",
                            ].join(" ")}
                          >
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={() => setStep(2)} disabled={selectedAttrs.length === 0}>
                Next: Field Mapping <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-[15px]">Field Mapping</h3>
                  <p className="text-[12px] text-muted-foreground">
                    Your imported columns ↔ FreshData superset. AI suggests each match — override with the dropdown if needed.
                  </p>
                </div>
                <Button size="sm" onClick={() => {
                  const m: Record<string, string> = {};
                  customerFields.forEach((f) => {
                    const s = aiSuggest(f);
                    if (s.attr) m[f] = s.attr.key;
                  });
                  setMapping(m);
                }}>
                  <Wand2 className="h-3.5 w-3.5" /> Re-run AI mapping
                </Button>
              </div>

              <div className="grid grid-cols-12 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1.5 border-b border-border">
                <div className="col-span-4">Your column</div>
                <div className="col-span-1">→</div>
                <div className="col-span-5">FreshData attribute</div>
                <div className="col-span-2 text-right">AI confidence</div>
              </div>

              <div className="divide-y divide-border">
                {customerFields.map((cf) => {
                  const suggestion = aiSuggest(cf);
                  const current = mapping[cf] || "";
                  return (
                    <div key={cf} className="grid grid-cols-12 items-center gap-2 px-2 py-2">
                      <div className="col-span-4 font-mono text-[12px]">{cf}</div>
                      <div className="col-span-1 text-muted-foreground">→</div>
                      <div className="col-span-5">
                        <Select
                          value={current}
                          onChange={(e) => setMapping({ ...mapping, [cf]: e.target.value })}
                        >
                          <option value="">— unmapped —</option>
                          {CATEGORY_ORDER.map((cat) => (
                            <optgroup key={cat} label={cat}>
                              {ATTRIBUTES.filter((a) => a.category === cat).map((a) => (
                                <option key={a.key} value={a.key}>{a.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                      </div>
                      <div className="col-span-2 text-right">
                        {suggestion.attr ? (
                          <Badge tone={suggestion.confidence > 0.9 ? "success" : "warning"}>
                            {Math.round(suggestion.confidence * 100)}%
                          </Badge>
                        ) : (
                          <Badge tone="neutral">no match</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 p-3 bg-info-bg rounded-md text-[12px] text-info">
                <Sparkles className="h-3.5 w-3.5 inline mr-1" />
                Unmapped columns will be flagged for our AI expansion: it'll search for similar attributes across workflows or propose new ones.
              </div>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>
                Next: Workflows <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Card className="p-5">
              <h3 className="font-semibold text-[15px] mb-1">Pick the workflows to run</h3>
              <p className="text-[12px] text-muted-foreground mb-4">
                We pre-selected the workflows that cover your chosen attributes. You can add more from the library.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {WORKFLOWS.map((wf) => {
                  const on = selectedWorkflows.includes(wf.id);
                  return (
                    <button
                      key={wf.id}
                      onClick={() => toggleWf(wf.id)}
                      className={[
                        "text-left p-4 rounded-lg border transition",
                        on ? "border-primary bg-info-bg/40 ring-1 ring-primary/30" : "border-border bg-card hover:bg-secondary",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-[13px]">{wf.name}</div>
                        {on ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Badge tone="neutral">add</Badge>}
                      </div>
                      <Badge tone="purple" className="mt-1">{wf.category}</Badge>
                      <p className="text-[12px] text-muted-foreground mt-2">{wf.description}</p>
                      <div className="text-[11px] text-muted-foreground mt-2">
                        Steps: {wf.steps.slice(0, 4).join(" → ")}{wf.steps.length > 4 ? " → …" : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)} disabled={selectedWorkflows.length === 0}>
                Next: Schedule <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {step === 4 && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <h3 className="font-semibold text-[15px]">Confirm & launch</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
              <div>
                <div className="text-muted-foreground text-[12px]">Rows imported</div>
                <div className="font-semibold text-[18px]">{rowCount.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px]">Attributes</div>
                <div className="font-semibold text-[18px]">{selectedAttrs.length}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px]">Mapped cols</div>
                <div className="font-semibold text-[18px]">{Object.values(mapping).filter(Boolean).length} / {customerFields.length}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px]">Workflows</div>
                <div className="font-semibold text-[18px]">{selectedWorkflows.length}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
              <div>
                <label className="text-[12px] text-muted-foreground">Refresh frequency</label>
                <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                  <option value="2 Minutes">2 Minutes</option>
                  <option>Daily</option>
                  <option>Weekly</option>
                  <option>Monthly</option>
                  <option>Quarterly</option>
                </Select>
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground">Connector</label>
                <Select defaultValue="Snowflake">
                  <option>Snowflake</option>
                  <option>S3 bucket</option>
                  <option>Webhook</option>
                  <option>API pull</option>
                </Select>
              </div>
            </div>
            <div className="mt-5 flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
              <Link to="/monitoring">
                <Button>
                  <Upload className="h-4 w-4" /> Launch & monitor
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

