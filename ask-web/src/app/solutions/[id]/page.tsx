import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSolutionById, sourcesForSolution } from "@/lib/catalog/load";
import { cn } from "@/lib/utils";

export default async function SolutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const solution = getSolutionById(id);
  if (!solution) notFound();
  const sources = sourcesForSolution(id);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <div>
          <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">Solution</p>
          <h1 className="font-heading text-3xl">{solution.name}</h1>
          <p className="mt-2 text-muted-foreground">{solution.tagline}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>{solution.category}</Badge>
            {solution.refreshCadence ? <Badge variant="outline">{solution.refreshCadence}</Badge> : null}
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>What this Solution covers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{solution.description}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <p><span className="text-muted-foreground">Records: </span>{solution.records || "—"}</p>
              <p><span className="text-muted-foreground">Coverage (this Solution): </span>{solution.coverage ? `${solution.coverage}%` : "—"}</p>
              <p><span className="text-muted-foreground">Accuracy (this Solution): </span>{solution.accuracy ? `${solution.accuracy}%` : "—"}</p>
              <p><span className="text-muted-foreground">Countries covered: </span>{solution.countriesCovered || "—"}</p>
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Refresh options: </span>
                {solution.refreshOptions.join(", ") || "—"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Output attributes ({solution.attributeCount || solution.attributes.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {solution.attributes.map((attribute) => (
              <Badge key={attribute} variant="secondary">
                {attribute}
              </Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sources in the catalog ({sources.length || solution.sourceCount})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {sources.length
              ? sources.map((source) => (
                  <div key={`${source.name}-${source.url}`} className="rounded-md border p-2">
                    <p className="font-medium">{source.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {source.kind || "Unspecified kind"}
                      {source.region ? ` · ${source.region}` : ""}
                      {source.url ? ` · ${source.url}` : ""}
                    </p>
                  </div>
                ))
              : solution.sourceNames.map((name) => <p key={name}>{name}</p>)}
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Link href="/solutions" className={cn(buttonVariants({ variant: "outline" }))}>
            All solutions
          </Link>
          <Link href="/" className={cn(buttonVariants())}>
            Ask Freda
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
