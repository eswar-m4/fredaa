import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CatalogSearchList } from "@/components/catalog-search-list";
import { buttonVariants } from "@/components/ui/button";
import { loadCatalog } from "@/lib/catalog/load";
import { cn } from "@/lib/utils";

export default function AgentsPage() {
  const catalog = loadCatalog();
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">Agents playbook</p>
            <h1 className="font-heading text-3xl">Existing extraction agents</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {catalog.agents.length} agents from the catalog. Use Ask Freda if you do not already know the source.
            </p>
          </div>
          <Link href="/agents/new" className={cn(buttonVariants())}>
            Add new source
          </Link>
        </div>
        <CatalogSearchList agents={catalog.agents} />
      </div>
    </AppShell>
  );
}
