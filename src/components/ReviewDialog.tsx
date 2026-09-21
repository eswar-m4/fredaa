import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdmvBar, Badge, Button, Donut, Input, Select } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, X, ChevronLeft, ChevronRight, RotateCcw, Layers, Send, ExternalLink, Download } from "lucide-react";
import { downloadCsv } from "@/lib/download";
import { reviewRecordsFor, xlsxRowsToReviewRecords, fmt, hrsAgo, type Project, type ReviewRecord, type ChangeType } from "@/data/customers";
import { isLiveCheckable, baselineReviewRecords } from "@/lib/monitoring-live-review";
import { recordReviewSubmission } from "@/lib/review-status";

type Decision = "approved" | "rejected";

const CHANGE_TYPES: ChangeType[] = ["Added", "Deleted", "Modified", "Verified"];

const toneFor = (t: ChangeType) =>
  t === "Added" ? "success" : t === "Deleted" ? "destructive" : t === "Modified" ? "warning" : "info";

const POOL = 6000;

/** Result of a real "Run" — when present, the dialog shows these records
 *  (live Old → New, tagged Added/Deleted/Modified/Verified) instead of the
 *  static sample-file records. */
export type LiveReviewData = {
  records: ReviewRecord[];
  checkedAt: string;
  aiConfigured: boolean;
  reachableCount: number;
  totalCount: number;
  fetchErrors: { entity: string; error: string }[];
  /** Which live-refresh profile produced this run ("webpage" | "registry").
   *  Stamped at save time and checked at load time so a run cached under a
   *  project id before that id's profile changed (e.g. a project reorder)
   *  is never mistaken for a real run of whatever now lives at that id. */
  profileKind?: string;
  /** Bumped whenever a change to the live-refresh code itself (not just
   *  which profile a project uses) would make an already-cached run stale
   *  or wrong in a way profileKind alone can't detect — e.g. a fix to how
   *  sourceUrl gets built. A cached run stamped with an older/missing
   *  version is discarded on load instead of being shown as if current. */
  cacheVersion?: number;
};

export function ReviewDialog({
  project,
  open,
  onOpenChange,
  live,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pass the result of a live "Run" to show real fetched data instead of the sample file. */
  live?: LiveReviewData | null;
}) {
  // Live-refresh-enabled projects (NTM Monitoring/POI/Maintenance) must never
  // fall back to the synthetic sample-file/seeded generators below — those
  // fabricate a changeType label without any real before/after comparison
  // (the "plain" xlsx path literally reuses the same value for old and new),
  // which reads as a real but broken diff instead of "no run yet". When a
  // real on-file baseline exists (e.g. a self-service project's launch-time
  // extraction) but no "Run" has been cached yet, that real baseline is
  // shown instead — never fabricated, and never silently empty just
  // because a live-review cache entry hasn't been written yet.
  const all = useMemo(() => {
    if (!project) return [];
    if (live) return live.records;
    if (isLiveCheckable(project)) return baselineReviewRecords(project);
    if (project.sampleRows && project.sampleRows.length > 0) {
      return xlsxRowsToReviewRecords(project);
    }
    return reviewRecordsFor(project, Math.min(POOL, Math.max(1200, project.pendingReview)));
  }, [project?.id, live]);
  const noLiveRunYet = !live && !!project && isLiveCheckable(project) && all.length === 0;
  const [batchSize, setBatchSize] = useState(25);


  const [sampling, setSampling] = useState(2);
  const [admvFilter, setAdmvFilter] = useState<"all" | ChangeType>("all");
  const [minConf, setMinConf] = useState(0);
  const [datapoint, setDatapoint] = useState("all");
  const [query, setQuery] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [batchIdx, setBatchIdx] = useState(0);
  const [submitted, setSubmitted] = useState(0);
  const [completedFile, setCompletedFile] = useState<Array<Record<string, string | number>>>([]);

  // Live-check records carry the raw field key as `datapoint` (needed so
  // the output-template overlay in monitoring-live-review.ts can match it
  // back to project.columns) — project.datapoints holds the pretty label
  // for the same fields, in the same order, so this maps key -> label for
  // display only. columns/datapoints aren't always the same length (webpage
  // projects prefix Entity_Name/Source_URL onto columns) so this aligns
  // from the tail, where the tracked fields always live.
  const columnLabel = useMemo(() => {
    if (!project) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    const offset = project.columns.length - project.datapoints.length;
    if (offset >= 0) {
      project.datapoints.forEach((label, i) => {
        const col = project.columns[offset + i];
        if (col) map[col] = label;
      });
    }
    return map;
  }, [project]);
  const labelFor = (dp: string) => columnLabel[dp] ?? dp;

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

  const batchCount = Math.max(1, Math.ceil(records.length / batchSize));
  const clampedBatch = Math.min(batchIdx, batchCount - 1);
  const batchStart = clampedBatch * batchSize;
  const batch = records.slice(batchStart, batchStart + batchSize);

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
    setCompletedFile(
      records
        .filter((r) => decisions[r.id])
        .map((r) => ({
          entity: r.entity,
          datapoint: labelFor(r.datapoint),
          change: r.changeType,
          old_value: r.oldValue,
          new_value: r.newValue,
          confidence: r.confidence,
          source: r.sourceUrl,
          decision: decisions[r.id] === "approved" ? "Approved" : "Rejected",
        })),
    );
    setSubmitted(decided);
    // Persist against the sampled set (what "review contour %" below is
    // already measured against), not the full unsampled `all` — sampling is
    // a deliberate review-scope choice, so fully deciding everything in a
    // 2% sample and submitting should read as done, not stuck at "In
    // progress" until every one of the underlying (unsampled) records is
    // also decided. A secondary admv/confidence/search filter still counts
    // honestly: records it hides from `sampled`'s decided count stay
    // undecided, so submitting under a narrow filter won't misreport 100%.
    if (project) recordReviewSubmission(project.id, sampled.filter((r) => decisions[r.id]).length, sampled.length);
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
          setCompletedFile([]);
          reset();
        }
      }}
    >
      <DialogContent className="max-w-none w-[97vw] h-[94vh] p-0 gap-0 overflow-hidden flex flex-col sm:max-w-none">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-[17px]">
            {live ? "Live refresh results — " : "Review workspace — "}
            {project.name}
          </DialogTitle>
          {live ? (
            <div className="flex flex-wrap items-center gap-2 pt-2 text-[12px] text-muted-foreground">
              <Badge tone="success">
                {live.reachableCount}/{live.totalCount} sites reachable
              </Badge>
              <Badge tone="neutral">{live.records.length} fields checked</Badge>
              <span>checked {new Date(live.checkedAt).toLocaleTimeString()}</span>
              {!live.aiConfigured && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> OPENAI_API_KEY not set — showing reachability only, field
                  values were not re-extracted
                </span>
              )}
              {live.fetchErrors.length > 0 && (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" /> {live.fetchErrors.length} site(s) could not be fetched
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pt-2 text-[12px] text-muted-foreground">
              <Badge tone="info">{project.source}</Badge>
              <Badge tone="neutral">{project.datapoints.length} datapoints</Badge>
              <Badge tone="warning">{fmt(project.pendingReview)} pending</Badge>
              <Badge tone="purple">sampling {sampling}%</Badge>
              <span>
                Coverage {project.coverage}% · Avg confidence {avgConf.toFixed(1)}%
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 min-w-0 grid lg:grid-cols-[250px_1fr]">
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
                    {labelFor(d)}
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
          <div className="flex flex-col min-h-0 min-w-0">
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
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="font-semibold uppercase tracking-wider">
                    Batch {records.length ? clampedBatch + 1 : 0} of {records.length ? batchCount : 0}
                  </span>
                  <span>· {batch.length} records · {batchDecided} decided · {fmt(records.length)} in queue</span>
                  <span className="flex items-center gap-1">
                    <span className="uppercase tracking-wider text-[11px]">rows</span>
                    <select
                      value={batchSize}
                      onChange={(e) => {
                        setBatchSize(Number(e.target.value));
                        setBatchIdx(0);
                      }}
                      className="h-7 rounded-md border border-border bg-card px-1.5 text-[11.5px]"
                    >
                      {[10, 25, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="uppercase tracking-wider text-[11px]">jump</span>
                    <input
                      type="number"
                      min={1}
                      max={batchCount}
                      value={clampedBatch + 1}
                      onChange={(e) => setBatchIdx(Math.min(batchCount - 1, Math.max(0, Number(e.target.value) - 1)))}
                      className="h-7 w-16 rounded-md border border-border bg-card px-1.5 text-[11.5px] tabular-nums"
                    />
                  </span>
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


            <div className="flex-1 min-h-0 overflow-auto">
              {noLiveRunYet ? (
                <div className="m-6 rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                  <div className="text-foreground font-medium mb-1">No live run yet for {project.name}</div>
                  Go to the Monitoring tab and click <strong className="text-foreground">Run now</strong> to fetch
                  real data from every source URL — this dialog will then show the actual Old → New comparison.
                </div>
              ) : batch.length === 0 ? (
                <div className="m-6 rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                  No records match the current filters.
                </div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-card border-b border-border z-10">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-6 py-2 font-semibold">Record ID</th>
                      <th className="px-3 py-2 font-semibold">Entity</th>
                      <th className="px-3 py-2 font-semibold">Datapoint</th>
                      <th className="px-3 py-2 font-semibold">Change</th>
                      <th className="px-3 py-2 font-semibold">Old Value</th>
                      <th className="px-3 py-2 font-semibold">New Value</th>
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
                          <td className="px-6 py-2 w-[110px] max-w-[110px]">
                            <span title={r.id} className="block truncate font-mono text-[11px] text-muted-foreground">
                              {r.id}
                            </span>
                          </td>
                          <td className="px-3 py-2 w-[150px] max-w-[150px]">
                            <span title={r.entity} className="block truncate font-medium">
                              {r.entity}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{labelFor(r.datapoint)}</td>
                          <td className="px-3 py-2">
                            <Badge tone={toneFor(r.changeType) as any}>{r.changeType}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground truncate max-w-[140px]" title={r.oldValue}>
                            {r.oldValue}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11.5px] text-foreground truncate max-w-[140px]" title={r.newValue}>
                            {r.newValue}
                          </td>
                          <td className="px-3 py-2">
                            {r.sourceUrl ? (
                              <a
                                href={r.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={r.sourceUrl}
                                className="inline-flex items-center gap-1 text-primary hover:underline max-w-[150px] truncate text-[11.5px]"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" /> {r.source}
                              </a>
                            ) : (
                              // A blank href would resolve to this page itself, not an
                              // external source — show plain text instead of a fake link.
                              <span className="text-muted-foreground max-w-[150px] truncate text-[11.5px] block">{r.source}</span>
                            )}
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
            {submitted > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(`${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-reviewed.csv`, completedFile)
                }
              >
                <Download className="h-3.5 w-3.5" /> Download reviewed file
              </Button>
            )}
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
