import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentById, loadCatalog } from "@/lib/catalog/load";
import { cn } from "@/lib/utils";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = getAgentById(id);
  if (!agent) notFound();
  const variants = loadCatalog().agents.filter((item) => item.name === agent.name);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <div>
          <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">Agent</p>
          <h1 className="font-heading text-3xl">{agent.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{agent.category || "Uncategorized"}</Badge>
            {agent.country ? <Badge variant="secondary">{agent.country}</Badge> : null}
            {agent.complexity ? <Badge variant="outline">{agent.complexity}</Badge> : null}
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Catalog metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">Project: </span>{agent.project || "—"}</p>
            <p><span className="text-muted-foreground">Type: </span>{agent.type || "—"}</p>
            <p><span className="text-muted-foreground">Industry: </span>{agent.industry || "—"}</p>
            <p><span className="text-muted-foreground">Data type: </span>{agent.dataType || "—"}</p>
            <p><span className="text-muted-foreground">Datapoints: </span>{agent.datapoints || "—"}</p>
            <p><span className="text-muted-foreground">Estimated records: </span>{agent.estimatedRecords || "—"}</p>
            <p className="sm:col-span-2"><span className="text-muted-foreground">Description: </span>{agent.description || "—"}</p>
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Source: </span>
              {agent.sourceUrl ? (
                <a className="underline" href={agent.sourceUrl} target="_blank" rel="noreferrer">
                  {agent.sourceUrl}
                </a>
              ) : "—"}
            </p>
          </CardContent>
        </Card>
        {variants.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Other catalog rows with this name</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {variants.map((item) => (
                <p key={`${item.id}-${item.project}`}>
                  Agent {item.id} · {item.project || "No project"} · {item.dataType || item.description}
                </p>
              ))}
            </CardContent>
          </Card>
        ) : null}
        <div className="flex gap-2">
          <Link href="/agents" className={cn(buttonVariants({ variant: "outline" }))}>
            All agents
          </Link>
          <Link href="/" className={cn(buttonVariants())}>
            Ask Freda
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
