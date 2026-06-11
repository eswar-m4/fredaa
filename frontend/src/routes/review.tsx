import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import { Check, X } from "lucide-react";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Review Queue – FreshData AI" }] }),
  component: Review,
});

const ITEMS = [
  { co: "Polaris Renewables Ltd", attr: "Registry Number", suggested: "08842713", conf: 0.92, source: "Companies House" },
  { co: "Northwind Logistics", attr: "Revenue", suggested: "$412M", conf: 0.71, source: "Annual Report 2024" },
  { co: "Helix Biopharma", attr: "CEO Email", suggested: "amelia.tan@helixbio.com", conf: 0.68, source: "LinkedIn + pattern" },
  { co: "Granite Capital Partners", attr: "LEI", suggested: "5493000F4ZO33MV32P92", conf: 0.97, source: "GLEIF" },
  { co: "Vermilion Foods", attr: "HQ Address", suggested: "1402 Carling Ave, Ottawa, ON", conf: 0.81, source: "Google Business" },
];

function Review() {
  return (
    <AppLayout>
      <PageHeader title="Review Queue" subtitle="Human-in-the-loop for low-confidence enrichment results." />
      <div className="px-7 pb-8">
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {ITEMS.map((it, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[13px]">{it.co}</span>
                    <Badge tone="info">{it.attr}</Badge>
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-1">
                    Suggested: <span className="font-mono text-foreground">{it.suggested}</span> · from {it.source}
                  </div>
                </div>
                <Badge tone={it.conf > 0.9 ? "success" : it.conf > 0.75 ? "warning" : "destructive"}>
                  {Math.round(it.conf * 100)}%
                </Badge>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline"><X className="h-3.5 w-3.5" /> Reject</Button>
                  <Button size="sm"><Check className="h-3.5 w-3.5" /> Approve</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
