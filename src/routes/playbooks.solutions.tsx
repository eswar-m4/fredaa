import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Boxes, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, PageHeader } from "@/components/ui-bits";
import { useActiveCustomer } from "@/lib/workspace";
import { solutionsFor } from "@/lib/playbook-solutions";

export const Route = createFileRoute("/playbooks/solutions")({
  head: () => ({
    meta: [
      { title: "Solutions — FreDA playbooks" },
      { name: "description", content: "Packaged domain datasets you can request: core profiles, change monitoring, contact enrichment and pricing watch." },
      { property: "og:title", content: "Solutions — FreDA playbooks" },
      { property: "og:description", content: "Packaged domain datasets you can request: core profiles, change monitoring, contact enrichment and pricing watch." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SolutionsPage,
});

function SolutionsPage() {
  const customer = useActiveCustomer();
  const solutions = solutionsFor(customer);

  return (
    <AppLayout>
      <PageHeader
        title="Solutions"
        subtitle={`${customer.name} · packaged ${customer.industry.toLowerCase()} datasets sourced and kept fresh for you`}
        actions={
          <Link to="/playbooks">
            <Button size="sm" variant="outline">
              <ArrowLeft className="h-3.5 w-3.5" /> Playbooks
            </Button>
          </Link>
        }
      />

      <div className="px-7 pb-8">
        <div className="grid md:grid-cols-2 gap-4 items-stretch">
          {solutions.map((s) => (
            <Card key={s.name} className="p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <span className="h-9 w-9 shrink-0 rounded-md bg-purple-bg text-purple-token inline-flex items-center justify-center">
                  <Boxes className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">{s.name}</div>
                  <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{s.blurb}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="info">{s.sources} sources</Badge>
                <Badge tone="neutral">{s.datapoints} datapoints</Badge>
                <Badge tone="success">{customer.industry}</Badge>
              </div>
              <div className="mt-auto pt-4">
                <Link to="/refresh">
                  <Button size="sm" variant="outline" className="w-full justify-center">
                    <Sparkles className="h-3.5 w-3.5" /> Request this solution <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
