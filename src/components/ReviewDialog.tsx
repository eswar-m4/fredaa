import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, Button } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { Check, X, ChevronLeft, ChevronRight, ArrowRight, RotateCcw } from "lucide-react";
import { reviewRecordsFor, fmt, hrsAgo, type Project, type ReviewRecord } from "@/data/customers";

type Decision = "approved" | "rejected";

const toneFor = (t: ReviewRecord["changeType"]) =>
  t === "Added" ? "success" : t === "Deleted" ? "destructive" : t === "Modified" ? "warning" : "info";

export function ReviewDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const records = useMemo(() => (project ? reviewRecordsFor(project, 24) : []), [project?.id]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [cursor, setCursor] = useState(0);
  const [submitted, setSubmitted] = useState(0);

  const decided = Object.keys(decisions).length;
  const approved = Object.values(decisions).filter((d) => d === "approved").length;
  const rejected = decided - approved;

  function decide(id: string, d: Decision, advance = false) {
    setDecisions((prev) => ({ ...prev, [id]: d }));
    if (advance) setCursor((c) => Math.min(c + 1, records.length - 1));
  }

  function reset() {
    setDecisions({});
    setCursor(0);
  }

  function submit() {
    setSubmitted(decided);
    setDecisions({});
    setCursor(0);
  }

  if (!project) return null;
  const current = records[cursor];

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
      <DialogContent className="max-w-[1080px] w-[95vw] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="text-[16px]">Review changes — {project.name}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-2 text-[12px] text-muted-foreground">
            <Badge tone="info">{project.source}</Badge>
            <Badge tone="neutral">{project.datapoints.length} datapoints</Badge>
            <Badge tone="warning">{fmt(project.pendingReview)} pending</Badge>
            <span>Accuracy {project.accuracy}% · Coverage {project.coverage}%</span>
          </div>
        </DialogHeader>

        {/* record-by-record focus card */}
        <div className="px-6 py-4 bg-secondary/40 border-b border-border">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Record {cursor + 1} of {records.length}
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0}>
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor((c) => Math.min(records.length - 1, c + 1))}
                disabled={cursor === records.length - 1}
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {current && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[14px] font-semibold">{current.entity}</span>
                <Badge tone={toneFor(current.changeType) as any}>{current.changeType}</Badge>
                <Badge tone={current.confidence > 90 ? "success" : current.confidence > 80 ? "warning" : "destructive"}>
                  {current.confidence}% confidence
                </Badge>
                <span className="text-[11px] text-muted-foreground ml-auto">detected {hrsAgo(current.detectedHrs)}</span>
              </div>
              <div className="grid md:grid-cols-[220px_1fr_auto_1fr] items-center gap-3">
                <div className="text-[12px] text-muted-foreground">{current.datapoint}</div>
                <div className="rounded-md border border-border bg-secondary/60 px-3 py-2 text-[13px] font-mono line-through decoration-destructive/60">
                  {current.oldValue}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground hidden md:block" />
                <div className="rounded-md border border-success/40 bg-success-bg px-3 py-2 text-[13px] font-mono text-success">
                  {current.newValue}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <Button size="sm" onClick={() => decide(current.id, "approved", true)}>
                  <Check className="h-3.5 w-3.5" /> Approve &amp; next
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide(current.id, "rejected", true)}>
                  <X className="h-3.5 w-3.5" /> Reject &amp; next
                </Button>
                {decisions[current.id] && (
                  <span className="text-[12px] text-muted-foreground">
                    marked <strong className="text-foreground">{decisions[current.id]}</strong>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* full queue */}
        <div className="max-h-[38vh] overflow-y-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-2 font-semibold">Entity</th>
                <th className="px-3 py-2 font-semibold">Datapoint</th>
                <th className="px-3 py-2 font-semibold">Change</th>
                <th className="px-3 py-2 font-semibold">Old → New</th>
                <th className="px-3 py-2 font-semibold">Conf.</th>
                <th className="px-6 py-2 font-semibold text-right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => {
                const d = decisions[r.id];
                return (
                  <tr
                    key={r.id}
                    onClick={() => setCursor(i)}
                    className={cn(
                      "border-b border-border/60 cursor-pointer hover:bg-secondary/40",
                      i === cursor && "bg-info-bg/60",
                    )}
                  >
                    <td className="px-6 py-2 font-medium">{r.entity}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.datapoint}</td>
                    <td className="px-3 py-2">
                      <Badge tone={toneFor(r.changeType) as any}>{r.changeType}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground truncate max-w-[280px]">
                      {r.oldValue} → <span className="text-foreground">{r.newValue}</span>
                    </td>
                    <td className="px-3 py-2">{r.confidence}%</td>
                    <td className="px-6 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            decide(r.id, "approved");
                          }}
                          className={cn(
                            "h-7 w-7 rounded-md inline-flex items-center justify-center border transition",
                            d === "approved" ? "bg-success text-success-bg border-success" : "border-border hover:bg-secondary",
                          )}
                          title="Approve"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            decide(r.id, "rejected");
                          }}
                          className={cn(
                            "h-7 w-7 rounded-md inline-flex items-center justify-center border transition",
                            d === "rejected" ? "bg-destructive text-destructive-foreground border-destructive" : "border-border hover:bg-secondary",
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
        </div>

        <div className="border-t border-border px-6 py-3 flex flex-wrap items-center gap-3 bg-card">
          <div className="text-[12px] text-muted-foreground">
            <strong className="text-foreground">{decided}</strong> of {records.length} decided ·{" "}
            <span className="text-success">{approved} approved</span> · <span className="text-destructive">{rejected} rejected</span>
            {submitted > 0 && <span className="ml-2 text-success">✓ {submitted} decisions submitted</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDecisions(Object.fromEntries(records.map((r) => [r.id, "approved" as Decision])))}
            >
              Approve all
            </Button>
            <Button size="sm" disabled={decided === 0} onClick={submit}>
              Submit {decided > 0 ? `${decided} ` : ""}decisions
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
