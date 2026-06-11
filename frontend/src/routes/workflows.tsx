import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Card, PageHeader } from "@/components/ui-bits";
import { WORKFLOWS } from "@/data/workflows";
import { ChevronDown, Clock, Database, ArrowRight, ShieldCheck, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

export const Route = createFileRoute("/workflows")({
  head: () => ({ meta: [{ title: "Workflows – FreshData AI" }] }),
  component: Workflows,
});

function Workflows() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("All");

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

                  <div className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
                    <Stat icon={Database} label="Datapoints" value={wf.datapointsSummary} />
                    <Stat icon={Clock} label="Runtime" value={wf.runtime} />
                    <Stat
                      icon={ShieldCheck}
                      label="QC pass rate"
                      value={
                        <span className={wf.qcPercent >= 93 ? "text-success" : wf.qcPercent >= 88 ? "text-warning" : "text-destructive"}>
                          {wf.qcPercent}%
                        </span>
                      }
                    />
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border p-5 space-y-4 bg-secondary/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <IOBlock icon={ArrowDownToLine} title="Inputs" items={wf.inputs} tone="info" />
                      <IOBlock icon={ArrowUpFromLine} title="Outputs" items={wf.outputs} tone="success" />
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
                          Attributes ({wf.attributes.length})
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {wf.attributes.map((a) => (
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
                        <div className="px-3 py-1.5 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Workflow Studio preview
                        </div>
                        <img src={wf.screenshot} alt={`${wf.name} pipeline`} className="w-full h-auto block" />
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border bg-card p-3 text-[11px] text-muted-foreground text-center">
                        [ pipeline screenshot placeholder — wire up workflow studio render here ]
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
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
