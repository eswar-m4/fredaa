import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Cloud, Database, Link2, CheckCircle2, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle, Select } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { compact, fmt, hrsAgo } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/export")({
  head: () => ({
    meta: [
      { title: "Export & Sync — FreDA" },
      { name: "description", content: "Download approved FreDA datasets or keep S3, Snowflake and API destinations continuously in sync." },
      { property: "og:title", content: "Export & Sync — FreDA" },
      { property: "og:description", content: "Download approved FreDA datasets or keep S3, Snowflake and API destinations continuously in sync." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExportPage,
});

const DESTINATIONS = [
  { id: "s3", name: "Amazon S3", detail: "s3://freda-delivery/{customer}/", icon: Cloud, status: "Connected" },
  { id: "snowflake", name: "Snowflake", detail: "FREDA_DB.PUBLIC.{dataset}", icon: Database, status: "Connected" },
  { id: "api", name: "REST API pull", detail: "https://api.freda.io/v1/datasets", icon: Link2, status: "Connected" },
  { id: "sftp", name: "SFTP drop", detail: "sftp://delivery.freda.io/inbound", icon: Cloud, status: "Not configured" },
];

function ExportPage() {
  const customer = useActiveCustomer();
  const [selected, setSelected] = useState<string[]>(customer.projects.slice(0, 2).map((p) => p.id));
  const [mode, setMode] = useState<"download" | "sync">("download");
  const [format, setFormat] = useState("csv");
  const [scope, setScope] = useState("approved");
  const [dest, setDest] = useState("s3");
  const [done, setDone] = useState("");

  const rows = useMemo(
    () => customer.projects.filter((p) => selected.includes(p.id)).reduce((s, p) => s + p.records, 0),
    [selected, customer.id],
  );

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setDone("");
  }

  return (
    <AppLayout>
      <PageHeader
        title="Export & sync"
        subtitle={`${customer.name} · one place to download a snapshot or keep destinations continuously in sync`}
      />

      <div className="px-7 pb-8 grid xl:grid-cols-[1.4fr_1fr] gap-5 items-start">
        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Select datasets</h3>
            <p className="text-[12px] text-muted-foreground mt-1">{selected.length} selected · {fmt(rows)} records</p>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="px-5 py-2 font-semibold w-10"></th>
                <th className="px-3 py-2 font-semibold">Dataset</th>
                <th className="px-3 py-2 font-semibold">Records</th>
                <th className="px-3 py-2 font-semibold">Approved</th>
                <th className="px-5 py-2 font-semibold">Last delivery</th>
              </tr>
            </thead>
            <tbody>
              {customer.projects.map((p) => (
                <tr key={p.id} className={cn("border-b border-border/60 hover:bg-secondary/40", selected.includes(p.id) && "bg-info-bg/50")}>
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      suppressHydrationWarning
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{p.datapoints.length} datapoints · {p.frequency}</div>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{compact(p.records)}</td>
                  <td className="px-3 py-3 tabular-nums text-success">{compact(p.admv.verified)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{hrsAgo(p.lastRefreshHrs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="inline-flex rounded-md border border-border p-0.5 mb-4">
              {(["download", "sync"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setDone(""); }}
                  className={cn(
                    "px-3 h-8 rounded-[5px] text-[12.5px] font-medium capitalize transition",
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {m === "download" ? "One-time export" : "Continuous sync"}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <Field label="Scope">
                <Select value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="approved">Approved records only</option>
                  <option value="all">All records</option>
                  <option value="changes">Changes since last delivery</option>
                </Select>
              </Field>

              {mode === "download" ? (
                <Field label="Format">
                  <Select value={format} onChange={(e) => setFormat(e.target.value)}>
                    <option value="csv">CSV</option>
                    <option value="xlsx">Excel (.xlsx)</option>
                    <option value="json">JSON lines</option>
                    <option value="parquet">Parquet</option>
                  </Select>
                </Field>
              ) : (
                <>
                  <Field label="Destination">
                    <Select value={dest} onChange={(e) => setDest(e.target.value)}>
                      {DESTINATIONS.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Sync cadence">
                    <Select defaultValue="after-refresh">
                      <option value="after-refresh">After every refresh</option>
                      <option value="daily">Daily 06:00 UTC</option>
                      <option value="weekly">Weekly Monday</option>
                    </Select>
                  </Field>
                  <Field label="Notify on completion">
                    <Input defaultValue={`data-ops@${customer.id}.com`} />
                  </Field>
                </>
              )}
            </div>

            <Button
              className="w-full mt-4"
              disabled={selected.length === 0}
              onClick={() =>
                setDone(
                  mode === "download"
                    ? `Prepared ${fmt(rows)} records as ${format.toUpperCase()} — download link sent.`
                    : `Sync enabled to ${DESTINATIONS.find((d) => d.id === dest)?.name} for ${selected.length} datasets.`,
                )
              }
            >
              {mode === "download" ? <Download className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {mode === "download" ? "Generate export" : "Enable sync"}
            </Button>
            {done && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-success-bg text-success px-3 py-2 text-[12px]">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> {done}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle>Connected destinations</SectionTitle>
            <div className="space-y-2 mt-2">
              {DESTINATIONS.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="h-8 w-8 rounded-md bg-secondary inline-flex items-center justify-center text-muted-foreground">
                    <d.icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{d.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{d.detail}</div>
                  </div>
                  <Badge tone={d.status === "Connected" ? "success" : "neutral"}>{d.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}
