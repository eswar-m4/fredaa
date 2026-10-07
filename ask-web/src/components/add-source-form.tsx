"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function AddSourceForm() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, sourceUrl: url, notes }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not submit");
      setJobId(payload.job.id as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit source");
    } finally {
      setLoading(false);
    }
  }

  if (jobId) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">{jobId} is Pending Onboarding.</p>
        <p className="mt-1 text-muted-foreground">The source was not added to the live catalog automatically.</p>
        <Link href="/monitoring" className={cn(buttonVariants({ className: "mt-3" }))}>
          Open Monitoring
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="text-sm">
        Source / Agent name
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        />
      </label>
      <label className="text-sm">
        Source URL (optional)
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        />
      </label>
      <label className="text-sm">
        Why this source is needed
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 bg-card" />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Submitting…" : "Submit for onboarding"}
      </Button>
    </form>
  );
}
