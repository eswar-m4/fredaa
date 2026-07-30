import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Card, PageHeader, Select } from "@/components/ui-bits";
import { fetchBotCatalog, type BotCatalogEntry } from "@/lib/bot-catalog";
import { Search } from "lucide-react";

export const Route = createFileRoute("/library")({
  head: () => ({ meta: [{ title: "Agent Library – FreshData AI" }] }),
  component: Library,
});

function Library() {
  const [all, setAll] = useState<BotCatalogEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const cats = Object.keys(counts).sort();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [comp, setComp] = useState<string>("All");

  useEffect(() => {
    let active = true;
    fetchBotCatalog()
      .then((payload) => {
        if (!active) return;
        setAll(payload.bots || []);
        setCounts(payload.categoryCounts || {});
      })
      .catch(() => {
        if (!active) return;
        setAll([]);
        setCounts({});
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredBots = useMemo(() => {
    return all.filter((b) => {
      if (cat !== "All" && b.category !== cat) return false;
      if (comp !== "All" && b.complexity !== comp) return false;
      if (q) {
        const s = q.toLowerCase();
        return (
          String(b.name || "").toLowerCase().includes(s) ||
          String(b.url || "").toLowerCase().includes(s) ||
          String(b.industry || "").toLowerCase().includes(s)
        );
      }
      return true;
    }).slice(0, 100);
  }, [all, q, cat, comp]);

  return (
    <AppLayout>
      <PageHeader
        title="Agent Library"
        subtitle={`${all.length} onboarded scraping agents, categorized for quick reuse.`}
      />

      <div className="px-7 pb-8 space-y-6">
        <Card className="p-4">
          <div className="flex flex-wrap gap-2">
            <Pill active={cat === "All"} onClick={() => setCat("All")}>All · {all.length}</Pill>
            {cats.map((c) => (
              <Pill key={c} active={cat === c} onClick={() => setCat(c)}>
                {c} · {counts[c]}
              </Pill>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search agents…"
                className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-card text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <Select value={comp} onChange={(e) => setComp(e.target.value)} className="md:w-40">
              <option value="All">Any complexity</option>
              <option>Simple</option>
              <option>Medium</option>
              <option>Complex</option>
            </Select>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Site</th>
                <th className="text-left px-4 py-2.5 font-semibold">Category</th>
                <th className="text-left px-4 py-2.5 font-semibold">Country</th>
                <th className="text-left px-4 py-2.5 font-semibold">Data Type</th>
                <th className="text-left px-4 py-2.5 font-semibold">Complexity</th>
                <th className="text-right px-4 py-2.5 font-semibold">Attrs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredBots.map((b) => (
                <tr key={b.id} className="hover:bg-secondary/60">
                <td className="px-4 py-2.5">
                    <div className="font-medium">{b.name || "—"}</div>
                    <div className="text-[11px] text-muted-foreground truncate max-w-[300px]">{b.url || "—"}</div>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone="info">{b.category || "Uncategorized"}</Badge></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{b.country || "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{b.dataType || "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={b.complexity === "Simple" ? "success" : b.complexity === "Medium" ? "warning" : "destructive"}>
                      {b.complexity || "—"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{b.datapoints ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredBots.length === 100 && (
            <div className="text-center text-[11px] text-muted-foreground py-2 border-t border-border">
              Showing first 100 results — refine filters to narrow.
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

function Pill({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1.5 rounded-full text-[12px] border transition",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-secondary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
