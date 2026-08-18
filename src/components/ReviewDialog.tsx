import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdmvBar, Badge, Button, Donut, Input, Select } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { Check, X, ChevronLeft, ChevronRight, RotateCcw, Layers, Send, ExternalLink } from "lucide-react";
import { reviewRecordsFor, fmt, hrsAgo, type Project, type ReviewRecord, type ChangeType } from "@/data/customers";

type Decision = "approved" | "rejected";

const CHANGE_TYPES: ChangeType[] = ["Added", "Deleted", "Modified", "Verified"];

const toneFor = (t: ChangeType) =>
  t === "Added" ? "success" : t === "Deleted" ? "destructive" : t === "Modified" ? "warning" : "info";

const BATCH = 10;

export function ReviewDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const all = useMemo(() => (project ? reviewRecordsFor(project, 400) : []), [project?.id]);

  const [sampling, setSampling] = useState(2);
  const [admvFilter, setAdmvFilter] = useState<"all" | ChangeType>("all");
  const [minConf, setMinConf] = useState(0);
  const [datapoint, setDatapoint] = useState("all");
  const [query, setQuery] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [batchIdx, setBatchIdx] = useState(0);
  const [submitted, setSubmitted] = useState(0);

  const sampled = useMemo(() => all.slice(0, Math.max(1, Math.round((all.length * sampling) / 100))), [all, sampling]);

  const records = useMemo(
    () =>
      sampled.filter(
        (r) =>
          (admvFilter === "all" || r.changeType === admvFilter) &&
          r.confidence >= minConf &&
          (datapoint === "all" || r.datapoint === datapoint) &&
          (query.trim() === "" ||
            r.entity.toLowerCase().includes(query.toLowerCase()) ||
            r.newValue.toLowerCase().includes(query.toLowerCase())),
      ),
    [sampled, admvFilter, minConf, datapoint, query],
  );

  useEffect(() => setBatchIdx(0), [admvFilter, minConf, datapoint, query, sampling]);

  const decided = records.filter((r) => decisions[r.id]).length;
  const approved = records.filter((r) => decisions[r.id] === "approved").length;
  const rejected = decided - approved;
  const coverage = records.length ? (decided / records.length) * 100 : 0;
  const avgConf = records.length ? records.reduce((s, r) => s + r.confidence, 0) / records.length : 0;

  const admv = useMemo(() => {
    const c = { added: 0, deleted: 0, modified: 0, verified: 0 };
    for (const r of records) {
      if (r.changeType === "Added") c.added++;
      else if (r.changeType === "Deleted") c.deleted++;
      else if (r.changeType === "Modified") c.modified++;
      else c.verified++;
    }
    return c;
  }, [records]);

  const batchCount = Math.max(1, Math.ceil(records.length / BATCH));
  const clampedBatch = Math.min(batchIdx, batchCount - 1);
  const batchStart = clampedBatch * BATCH;
  const batch = records.slice(batchStart, batchStart + BATCH);
  const batchDecided = batch.filter((r) => decisions[r.id]).length;

  function decide(ids: string[], d: Decision) {
    setDecisions((prev) => {
      const next = { ...prev };
      ids.forEach((id) => (next[id] = d));
      return next;
    });
  }

  function approveBatchAndNext() {
    decide(batch.map((r) => r.id), "approved");
    setBatchIdx((b) => Math.min(batchCount - 1, b + 1));
  }

  function reset() {
    setDecisions({});
    setBatchIdx(0);
  }

  function submit() {
    setSubmitted(decided);
    setDecisions({});
    setBatchIdx(0);
  }

  if (!project) return null;
  const datapoints = Array.from(new Set(sampled.map((r) => r.datapoint)));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setSubmitted(0);
          reset();
        }
      }}
    >
      <DialogContent className="max-w-none w-[97vw] h-[94vh] p-0 gap-0 overflow-hidden flex flex-col sm:max-w-none">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-[17px]">Review workspace — {project.name}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-2 text-[12px] text-muted-foreground">
            <Badge tone="info">{project.source}</Badge>
            <Badge tone="neutral">{project.datapoints.length} datapoints</Badge>
            <Badge tone="warning">{fmt(project.pendingReview)} pending</Badge>
            <Badge tone="purple">sampling {sampling}%</Badge>
            <span>
              Coverage {project.coverage}% · Avg confidence {avgConf.toFixed(1)}%
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid lg:grid-cols-[250px_1fr]">
          {/* filters rail */}
          <aside className="border-r border-border bg-secondary/30 p-5 flex flex-col gap-5 overflow-y-auto">

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">ADMV filter</div>
              <Select value={admvFilter} onChange={(e) => setAdmvFilter(e.target.value as "all" | ChangeType)}>
                <option value="all">All changes</option>
                {CHANGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Filter by datapoint</div>
              <Select value={datapoint} onChange={(e) => setDatapoint(e.target.value)}>
                <option value="all">All datapoints</option>
                {datapoints.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                <span>Sampling</span>
                <span className="tabular-nums text-foreground">{sampling}%</span>
              </div>
              <input
                suppressHydrationWarning
                type="range"
                min={1}
                max={100}
                step={1}
                value={sampling}
                onChange={(e) => setSampling(Number(e.target.value))}
                className="w-full accent-[var(--primary)]"
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {sampling}% sample — reviewing {fmt(records.length)} of {fmt(all.length)} changed records.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                <span>Min. confidence</span>
                <span className="tabular-nums text-foreground">{minConf}%</span>
              </div>
              <input
                suppressHydrationWarning
                type="range"
                min={0}
                max={99}
                step={1}
                value={minConf}
                onChange={(e) => setMinConf(Number(e.target.value))}
                className="w-full accent-[var(--primary)]"
              />
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Search entity</div>
              <Input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            {/* review contour — left rail bottom */}
            <div className="mt-auto pt-4 rounded-lg border border-border bg-card p-3 flex items-center gap-3">
              <Donut value={coverage} label="reviewed" tone={coverage > 66 ? "success" : coverage > 33 ? "warning" : "primary"} />
              <div className="text-[11.5px] text-muted-foreground leading-relaxed">
                <div className="text-foreground font-semibold text-[13px]">Review contour</div>
                {decided} of {records.length} decided
                <br />
                <span className="text-success">{approved} approved</span> · <span className="text-destructive">{rejected} rejected</span>
              </div>
            </div>
          </aside>


          {/* batch queue */}
          <div className="flex flex-col min-h-0">
            <div className="px-6 py-3.5 border-b border-border bg-secondary/20 shrink-0 space-y-3">
              {/* group approval — top right */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Group approval</span>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {CHANGE_TYPES.map((t) => {
                    const ids = records.filter((r) => r.changeType === t).map((r) => r.id);
                    return (
                      <button
                        key={t}
                        disabled={ids.length === 0}
                        onClick={() => decide(ids, "approved")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 h-7 text-[11.5px] hover:bg-secondary disabled:opacity-40 transition"
                      >
                        <Check className="h-3 w-3" /> {t}
                        <span className="tabular-nums text-muted-foreground">{ids.length}</span>
                      </button>
                    );
                  })}


                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Batch {records.length ? clampedBatch + 1 : 0} of {records.length ? batchCount : 0} · {batch.length} records ·{" "}
                  {batchDecided} decided
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setBatchIdx((b) => Math.max(0, b - 1))} disabled={clampedBatch === 0}>
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev batch
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBatchIdx((b) => Math.min(batchCount - 1, b + 1))}
                    disabled={clampedBatch >= batchCount - 1}
                  >
                    Next batch <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" disabled={batch.length === 0} onClick={approveBatchAndNext}>
                    <Layers className="h-3.5 w-3.5" /> Approve batch &amp; next ({batch.length})
                  </Button>
                </div>
              </div>
              <AdmvBar a={admv} showLegend />
            </div>


            <div className="flex-1 min-h-0 overflow-y-auto">
              {batch.length === 0 ? (
                <div className="m-6 rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                  No records match the current filters.
                </div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-card border-b border-border z-10">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-6 py-2 font-semibold">Entity</th>
                      <th className="px-3 py-2 font-semibold">Datapoint</th>
                      <th className="px-3 py-2 font-semibold">Change</th>
                      <th className="px-3 py-2 font-semibold">Old → New</th>
                      <th className="px-3 py-2 font-semibold">Source</th>
                      <th className="px-3 py-2 font-semibold">Conf.</th>
                      <th className="px-3 py-2 font-semibold">Detected</th>
                      <th className="px-6 py-2 font-semibold text-right">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.map((r: ReviewRecord) => {
                      const d = decisions[r.id];
                      return (
                        <tr key={r.id} className="border-b border-border/60 hover:bg-secondary/40">
                          <td className="px-6 py-2 font-medium">{r.entity}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.datapoint}</td>
                          <td className="px-3 py-2">
                            <Badge tone={toneFor(r.changeType) as any}>{r.changeType}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground truncate max-w-[320px]">
                            {r.oldValue} → <span className="text-foreground">{r.newValue}</span>
                          </td>
                          <td className="px-3 py-2">
                            <a
                              href={r.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={r.sourceUrl}
                              className="inline-flex items-center gap-1 text-primary hover:underline max-w-[180px] truncate text-[11.5px]"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" /> {r.source}
                            </a>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{r.confidence}%</td>
                          <td className="px-3 py-2 text-[11.5px] text-muted-foreground whitespace-nowrap">{hrsAgo(r.detectedHrs)}</td>
                          <td className="px-6 py-2">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => decide([r.id], "approved")}
                                className={cn(
                                  "h-7 w-7 rounded-md inline-flex items-center justify-center border transition",
                                  d === "approved" ? "bg-success text-success-bg border-success" : "border-border hover:bg-secondary",
                                )}
                                title="Approve"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => decide([r.id], "rejected")}
                                className={cn(
                                  "h-7 w-7 rounded-md inline-flex items-center justify-center border transition",
                                  d === "rejected"
                                    ? "bg-destructive text-destructive-foreground border-destructive"
                                    : "border-border hover:bg-secondary",
                                )}
                                title="Reject"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </div>

        <div className="border-t border-border px-6 py-3 flex flex-wrap items-center gap-3 bg-card shrink-0">
          <div className="text-[12px] text-muted-foreground">
            <strong className="text-foreground">{decided}</strong> of {records.length} decided ·{" "}
            <span className="text-success">{approved} approved</span> · <span className="text-destructive">{rejected} rejected</span> ·{" "}
            review contour <strong className="text-foreground">{coverage.toFixed(0)}%</strong>
            {submitted > 0 && <span className="ml-2 text-success">✓ {submitted} decisions submitted</span>}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <Button variant="outline" size="sm" onClick={() => decide(records.map((r) => r.id), "approved")}>
              Bulk approve all ({records.length})
            </Button>
            <Button size="sm" disabled={decided === 0} onClick={submit}>
              <Send className="h-3.5 w-3.5" /> Submit {decided > 0 ? `${decided} ` : ""}decisions
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
