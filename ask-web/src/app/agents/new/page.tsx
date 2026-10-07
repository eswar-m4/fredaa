import { AppShell } from "@/components/app-shell";
import { AddSourceForm } from "@/components/add-source-form";

export default function AddSourcePage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
        <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">Agents → Add new source</p>
        <h1 className="font-heading text-3xl">Add a source that is not in the catalog</h1>
        <p className="text-sm text-muted-foreground">
          This does not invent an Agent. It opens a Pending Onboarding job so the Solutions team can
          review the source against the existing index.
        </p>
        <AddSourceForm />
      </div>
    </AppShell>
  );
}
