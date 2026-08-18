import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, Button, Input, Select } from "@/components/ui-bits";
import { Paperclip, Plus, Trash2, Send, FileSpreadsheet, CheckCircle2, X } from "lucide-react";
import { useActiveCustomer } from "@/lib/workspace";
import { estimate } from "@/data/customers";

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const customer = useActiveCustomer();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [urls, setUrls] = useState<string[]>([""]);
  const [datapoints, setDatapoints] = useState("");
  const [frequency, setFrequency] = useState<"Daily" | "Weekly" | "Monthly">("Weekly");
  const [files, setFiles] = useState<string[]>([]);
  const [req, setReq] = useState("");

  const dpCount = Math.max(1, datapoints.split(",").filter((d) => d.trim()).length);
  const est = estimate(Math.max(1, urls.filter((u) => u.trim()).length), dpCount, frequency);

  function reset() {
    setName("");
    setUrls([""]);
    setDatapoints("");
    setFiles([]);
    setReq("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border bg-secondary/30">
          <DialogTitle className="text-[16px]">New project — {customer.name}</DialogTitle>
          <p className="text-[12px] text-muted-foreground pt-1">
            Add source URLs or attach a file with the entity list / datapoint spec. FreDA admin gets notified with the estimate.
          </p>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-5 grid md:grid-cols-2 gap-5">
          <div className="space-y-4">
            <Field label="Project name">
              <Input placeholder="e.g. EMEA account refresh" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <Field label={`Source URLs · ${urls.length}`}>
              <div className="space-y-2">
                {urls.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="https://source.example.com"
                      value={u}
                      onChange={(e) => setUrls(urls.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    {urls.length > 1 && (
                      <button
                        onClick={() => setUrls(urls.filter((_, j) => j !== i))}
                        className="h-9 w-9 shrink-0 rounded-md border border-border inline-flex items-center justify-center hover:bg-secondary"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setUrls([...urls, ""])}>
                  <Plus className="h-3.5 w-3.5" /> Add URL
                </Button>
              </div>
            </Field>

            <Field label="Required datapoints (comma separated)">
              <Input
                placeholder="Company name, Website, HQ city, Employee count"
                value={datapoints}
                onChange={(e) => setDatapoints(e.target.value)}
              />
            </Field>

            <Field label="Refresh frequency">
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                <option>Daily</option>
                <option>Weekly</option>
                <option>Monthly</option>
              </Select>
            </Field>
          </div>

          <div className="space-y-4">
            <Field label="Attach a file">
              <div
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-dashed border-border p-5 text-center cursor-pointer hover:bg-secondary/40 transition"
              >
                <Paperclip className="h-5 w-5 mx-auto text-primary" />
                <div className="text-[12.5px] font-medium mt-2">Add a file</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">CSV, XLSX or PDF — entity list, sample output or spec</div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? []).map((f) => f.name)])}
                />
              </div>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {files.map((f, i) => (
                    <li key={`${f}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate flex-1">{f}</span>
                      <button onClick={() => setFiles(files.filter((_, j) => j !== i))} title="Remove">
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>

            <div className="rounded-lg border border-border bg-secondary/30 p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Instant estimate</div>
              <div className="grid grid-cols-3 gap-3 mt-3 text-center">
                <Est label="Build" value={est.buildDays + "d"} />
                <Est label="Setup" value={est.setup} />
                <Est label="Records / run" value={est.recordsPerRun} />
              </div>
              <div className="text-[11px] text-muted-foreground mt-3">
                {dpCount} datapoints · {urls.filter((u) => u.trim()).length || 1} sources · {frequency.toLowerCase()} refresh
              </div>
            </div>

            {req && (
              <div className="rounded-lg border border-success/30 bg-success-bg px-4 py-3 text-[12.5px] flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>
                  Sent to FreDA admin as <Badge tone="success">{req}</Badge>
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border px-6 py-3 flex items-center gap-2 bg-card">
          <div className="text-[12px] text-muted-foreground">Admin is notified with sources, datapoints and attachments.</div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!name.trim()}
              onClick={() => setReq(`REQ-${String(1000 + Math.round(name.length * 7 + urls.length * 13))}`)}
            >
              <Send className="h-3.5 w-3.5" /> Submit project request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function Est({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums mt-0.5">{String(value)}</div>
    </div>
  );
}
