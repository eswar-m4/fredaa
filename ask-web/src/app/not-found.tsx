import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <AppShell>
      <div className="mx-auto flex max-w-lg flex-col gap-3 px-4 py-16">
        <h1 className="font-heading text-3xl">That page is not in F.R.E.D.A.</h1>
        <p className="text-sm text-muted-foreground">
          Freda will not invent Agents or Solutions that are missing from the catalog.
        </p>
        <Link href="/" className={cn(buttonVariants(), "w-fit")}>
          Back to Ask Freda
        </Link>
      </div>
    </AppShell>
  );
}
