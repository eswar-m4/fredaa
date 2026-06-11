import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui-bits";
import { Database, Cloud, Webhook, FileDown } from "lucide-react";
import bots from "@/data/bots.json";

export const Route = createFileRoute("/export")({
  head: () => ({ meta: [{ title: "Export & Sync – FreshData AI" }] }),
  component: ExportPage,
});

const CONN = [
  { name: "Snowflake – prod_warehouse", type: "Warehouse", status: "Connected", last: "Synced 14m ago", icon: Database },
  { name: "S3 – fresh-data-deliveries", type: "Object store", status: "Connected", last: "Synced 1h ago", icon: Cloud },
  { name: "Salesforce – Accounts", type: "CRM", status: "Connected", last: "Synced 2h ago", icon: Webhook },
  { name: "Webhook – ops.acme.com", type: "Webhook", status: "Paused", last: "Last 2d ago", icon: Webhook },
];

const FRIENDLY_NAME_MAP: Record<string, string> = {
  "webmd": "WebMD",
  "instagram": "Instagram",
  "99acres": "99Acres",
  "keysight": "Keysight",
  "turkeybrokers": "TurkeyBrokers",
  "linkedin": "LinkedIn",
  "github": "GitHub",
  "companieshouse": "Companies House (UK)",
  "mca": "MCA (India)",
  "crunchbase": "Crunchbase",
  "secedgar": "SEC EDGAR",
  "napdiscovery": "NAP Discovery",
};

function cleanSourceName(name: string) {
  if (!name) return "";
  let clean = name.trim();
  
  const dashIdxs = [" – ", " - "];
  for (const dash of dashIdxs) {
    const idx = clean.indexOf(dash);
    if (idx !== -1) {
      clean = clean.substring(0, idx).trim();
    }
  }

  if (/^https?:\/\//i.test(clean)) {
    try {
      const url = new URL(clean);
      return url.hostname.replace(/^www\./i, "");
    } catch (e) {
      // Ignore
    }
  }
  clean = clean.replace(/^https?:\/\/(www\.)?/i, "");
  clean = clean.replace(/^www\./i, "");
  const slashIdx = clean.indexOf("/");
  if (slashIdx !== -1) {
    clean = clean.substring(0, slashIdx);
  }
  return clean;
}

function getSourceDisplayName(source: string) {
  if (!source) return "";
  let clean = cleanSourceName(source);
  
  const dotIdx = clean.indexOf(".");
  let baseName = dotIdx !== -1 ? clean.substring(0, dotIdx) : clean;
  
  const lowerBase = baseName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (FRIENDLY_NAME_MAP[lowerBase]) {
    return FRIENDLY_NAME_MAP[lowerBase];
  }
  
  const catalogMatch = bots.bots.find(b => {
    const bNameClean = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return bNameClean === lowerBase || 
      lowerBase.includes(bNameClean) ||
      bNameClean.includes(lowerBase);
  });
  if (catalogMatch) {
    if (catalogMatch.name.toLowerCase() === "webmd") return "WebMD";
    return catalogMatch.name;
  }
  
  if (/^\d+[a-z]/i.test(baseName)) {
    const numPart = baseName.match(/^\d+/)?.[0] || "";
    const textPart = baseName.slice(numPart.length);
    return numPart + textPart.charAt(0).toUpperCase() + textPart.slice(1);
  }
  return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}

function ExportPage() {
  const [customJobs, setCustomJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");

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

  useEffect(() => {
    let active = true;
    async function fetchJobs() {
      try {
        const response = await fetch(`${baseApiUrl}/api/v1/demo/jobs`);
        if (response.ok) {
          const data = await response.json();
          if (active) {
            setCustomJobs(data);
          }
        }
      } catch (err) {
        console.error("Failed to fetch jobs from backend:", err);
      }
    }

    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [baseApiUrl]);

  const completedJobs = [...customJobs]
    .reverse()
    .map((j) => {
      const sourceName = j.source || j.source_name || j.website_url || "Unknown Source";
      return {
        id: j.id || `J-${Date.now()}`,
        source: sourceName,
        status: j.status === "Analysis Complete" ? "Pending Onboarding" : j.status,
        records: j.records !== undefined ? j.records : null,
      };
    })
    .filter((j) => j.status === "Completed");

  const handleExport = (format: string) => {
    if (!selectedJobId) return;
    window.open(`${baseApiUrl}/api/v1/export?run_id=${selectedJobId}&format=${format}`, "_blank");
  };

  return (
    <AppLayout>
      <PageHeader title="Export & Connector Sync" subtitle="Where freshly enriched records land." />
      <div className="px-7 pb-8 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CONN.map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.name} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-md bg-info-bg text-info inline-flex items-center justify-center">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-[13px]">{c.name}</div>
                      <Badge tone={c.status === "Connected" ? "success" : "warning"}>{c.status}</Badge>
                    </div>
                    <div className="text-[12px] text-muted-foreground">{c.type} · {c.last}</div>
                  </div>
                  <Button size="sm" variant="outline">Configure</Button>
                </div>
              </Card>
            );
          })}
        </div>
        <Card className="p-5">
          <h3 className="font-semibold text-[14px] mb-2">Ad-hoc export</h3>
          <p className="text-[12px] text-muted-foreground mb-3">Download the latest snapshot.</p>
          
          <div className="mb-4 max-w-md">
            <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">
              Select Completed Job / File
            </label>
            <Select value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)}>
              <option value="">-- Select a completed job --</option>
              {completedJobs.map((j) => {
                const sourceDisplayName = getSourceDisplayName(j.source);
                const rowCountStr = (j.records !== null && j.records !== undefined) ? ` — ${j.records.toLocaleString()} rows` : "";
                return (
                  <option key={j.id} value={j.id}>
                    {j.id} — {sourceDisplayName}{rowCountStr}
                  </option>
                );
              })}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!selectedJobId} onClick={() => handleExport("csv")}>
              <FileDown className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" disabled={!selectedJobId} onClick={() => handleExport("json")}>
              <FileDown className="h-4 w-4" /> JSON
            </Button>
            <Button variant="outline" disabled={!selectedJobId} onClick={() => handleExport("jsonl")}>
              <FileDown className="h-4 w-4" /> JSONL
            </Button>
            <Button variant="outline" disabled={!selectedJobId} onClick={() => handleExport("parquet")}>
              <FileDown className="h-4 w-4" /> Parquet
            </Button>
            <Button variant="outline" disabled={!selectedJobId} onClick={() => handleExport("xlsx")}>
              <FileDown className="h-4 w-4" /> XLSX
            </Button>
            <Button variant="outline" disabled={!selectedJobId} onClick={() => handleExport("xml")}>
              <FileDown className="h-4 w-4" /> XML
            </Button>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

