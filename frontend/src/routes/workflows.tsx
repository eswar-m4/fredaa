import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Card, PageHeader } from "@/components/ui-bits";
import { WORKFLOWS } from "@/data/workflows";
import {
  ChevronDown,
  Clock,
  Database,
  ArrowRight,
  Target as TargetIcon,
  CheckCircle2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Maximize2,
  X,
} from "lucide-react";

export const Route = createFileRoute("/workflows")({
  head: () => ({ meta: [{ title: "Workflows – FreshData AI" }] }),
  component: Workflows,
});

function Workflows() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("All");
  const [zoomSrc, setZoomSrc] = useState<{ src: string; title: string } | null>(null);

  const cats = useMemo(() => ["All", ...Array.from(new Set(WORKFLOWS.map((w) => w.category)))], []);
  const list = WORKFLOWS.filter((w) => cat === "All" || w.category === cat);

  return (
    <AppLayout>
      <PageHeader
        title="Workflows"
        subtitle="Reusable pipelines of agents, classifiers, RAG, LLM and human-in-the-loop nodes. Click a card to expand."
      />
      <div className="px-7 pb-8 space-y-5">
        <Card className="p-3">
          <div className="flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={[
                  "px-3 py-1.5 rounded-full text-[12px] border transition",
                  cat === c ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-secondary",
                ].join(" ")}
              >
                {c}
              </button>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {list.map((wf) => {
            const open = openId === wf.id;
            return (
              <Card key={wf.id} className="overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : wf.id)}
                  className="w-full text-left p-5 hover:bg-secondary/40 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[15px]">{wf.name}</h3>
                        <Badge tone="purple">{wf.category}</Badge>
                      </div>
                      <p className="text-[12px] text-muted-foreground mt-1.5">{wf.description}</p>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
                  </div>

                  <div className="mt-4 grid grid-cols-4 gap-2 text-[12px]">
                    <Stat icon={Database} label="Datapoints" value={wf.datapointsSummary} />
                    <Stat icon={Clock} label="Runtime" value={wf.runtime} />
                    <Stat
                      icon={TargetIcon}
                      label="Data coverage"
                      value={
                        <span className={(wf.coveragePercent ?? wf.qcPercent) >= 93 ? "text-success" : (wf.coveragePercent ?? wf.qcPercent) >= 85 ? "text-warning" : "text-destructive"}>
                          {wf.coveragePercent ?? wf.qcPercent}%
                        </span>
                      }
                    />
                    <Stat
                      icon={CheckCircle2}
                      label="Accuracy rate"
                      value={
                        <span className={(wf.accuracyPercent ?? wf.qcPercent) >= 93 ? "text-success" : (wf.accuracyPercent ?? wf.qcPercent) >= 88 ? "text-warning" : "text-destructive"}>
                          {wf.accuracyPercent ?? wf.qcPercent}%
                        </span>
                      }
                    />
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border p-5 space-y-4 bg-secondary/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <IOBlock icon={ArrowDownToLine} title="Input Attributes" items={wf.inputAttributes ?? wf.inputs} tone="info" />
                      <IOBlock icon={ArrowUpFromLine} title="Output Attributes" items={wf.outputAttributes ?? wf.outputs ?? wf.attributes} tone="success" />
                    </div>

                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                        Pipeline preview
                      </div>
                      <div className="overflow-x-auto">
                        <div className="flex items-center gap-1.5 min-w-max">
                          {wf.steps.map((s, i) => (
                            <div key={s} className="flex items-center gap-1.5">
                              <div className="h-7 px-2.5 rounded-md bg-info-bg text-info text-[11px] font-medium inline-flex items-center">
                                {s}
                              </div>
                              {i < wf.steps.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px]">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                          Attributes ({wf.attributes ? wf.attributes.length : 0})
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(wf.attributes ?? []).map((a) => (
                            <Badge key={a} tone="neutral">{a}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                          Sources ({wf.sources.length})
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {wf.sources.map((s) => (
                            <Badge key={s} tone="info">{s}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    {wf.screenshot ? (
                      <div className="rounded-md border border-border bg-card overflow-hidden">
                        <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
                          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Workflow Studio preview
                          </span>
                          <button
                            onClick={() => setZoomSrc({ src: wf.screenshot!, title: wf.name })}
                            className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
                          >
                            <Maximize2 className="h-3 w-3" /> Expand
                          </button>
                        </div>
                        <button
                          onClick={() => setZoomSrc({ src: wf.screenshot!, title: wf.name })}
                          className="block w-full text-left"
                          aria-label="Expand workflow preview"
                        >
                          <img src={wf.screenshot} alt={`${wf.name} pipeline`} className="w-full h-auto block cursor-zoom-in" />
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border bg-card p-3 text-[11px] text-muted-foreground text-center">
                        [ pipeline screenshot placeholder ]
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {zoomSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setZoomSrc(null)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={() => setZoomSrc(null)}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-card text-foreground text-[12px] font-medium"
            >
              <X className="h-4 w-4" /> Close
            </button>
          </div>
          <div className="absolute top-4 left-4 text-white/90 text-[13px] font-semibold">
            {zoomSrc.title} — Workflow Studio preview
          </div>
          <img
            src={zoomSrc.src}
            alt={zoomSrc.title}
            className="max-w-[95vw] max-h-[88vh] object-contain rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </AppLayout>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-secondary/60 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-[12px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function IOBlock({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: typeof Clock;
  title: string;
  items: string[];
  tone: "info" | "success";
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it} className="text-[12px] flex items-start gap-1.5">
            <Badge tone={tone} className="!py-0">{tone === "info" ? "in" : "out"}</Badge>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
