import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button, PageHeader } from "@/components/ui-bits";
import { AskFredaPanel } from "@/components/AskFredaPanel";
import { useActiveCustomer } from "@/lib/workspace";

export const Route = createFileRoute("/playbooks/ask")({
  head: () => ({
    meta: [
      { title: "Ask FreDA — domain assistant" },
      { name: "description", content: "Ask FreDA what changed in your data, which dataset to review first, how sources are performing and how to download records." },
      { property: "og:title", content: "Ask FreDA — domain assistant" },
      { property: "og:description", content: "Ask FreDA what changed in your data, which dataset to review first, how sources are performing and how to download records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AskPage,
});

function AskPage() {
  const customer = useActiveCustomer();

  return (
    <AppLayout>
      <PageHeader
        title="Ask FreDA"
        subtitle={`${customer.name} · guided assistant for ${customer.industry.toLowerCase()} data, reviews and sources`}
        actions={
          <Link to="/playbooks">
            <Button size="sm" variant="outline">
              <ArrowLeft className="h-3.5 w-3.5" /> Playbooks
            </Button>
          </Link>
        }
      />

      <div className="px-7 pb-8">
        <AskFredaPanel />
      </div>
    </AppLayout>
  );
}
