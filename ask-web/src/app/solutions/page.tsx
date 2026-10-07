import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadCatalog } from "@/lib/catalog/load";
import { cn } from "@/lib/utils";

export default function SolutionsPage() {
  const catalog = loadCatalog();
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <div>
          <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">Solutions playbook</p>
          <h1 className="font-heading text-3xl">Packaged data solutions</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {catalog.solutions.length} solutions across {catalog.solutionsByCategory.length} categories. Coverage and
            accuracy below are per Solution, not platform-wide.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {catalog.solutions.map((solution) => (
            <Card key={solution.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{solution.name}</CardTitle>
                  <Badge variant="secondary">{solution.category}</Badge>
                </div>
                <CardDescription>{solution.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground line-clamp-3">{solution.description}</p>
                <p className="text-xs text-muted-foreground">
                  {solution.coverage ? `${solution.coverage}% coverage for this Solution` : "Coverage not listed"}
                  {solution.refreshCadence ? ` · ${solution.refreshCadence}` : ""}
                  {solution.sourceCount ? ` · ${solution.sourceCount} sources` : ""}
                </p>
                <Link href={`/solutions/${solution.id}`} className={cn(buttonVariants({ size: "sm" }), "self-start")}>
                  Open solution
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
