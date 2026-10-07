"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import type { JobRecord } from "@/lib/freda/types";
import { cn } from "@/lib/utils";

function ticketDetails(job: JobRecord): { label: string; value: string }[] {
  const req = job.requirement || ({} as JobRecord["requirement"]);
  const extras = req.extras || {};
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value?: string | string[]) => {
    const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : value;
    if (text) rows.push({ label, value: text });
  };
  push("Request", req.objective);
  push("Entity", req.entityType);
  push("Market", req.geography || req.country || req.city);
  push("Fields", req.attributes);
  push("Frequency", req.frequency || req.recurring);
  push("Universe", extras.rankingHint || extras.volume);
  push("Coverage", extras.scope);
  push("Ranking", extras.rankingMethod);
  push("Sources", req.sources);
  for (const item of job.answers || []) {
    if (item.prompt && item.answer) push(item.prompt, item.answer);
  }
  return rows;
}

export default function MonitoringPage() {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to load");
        setJobs(payload.jobs as JobRecord[]);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load monitoring.");
        setJobs([]);
      });
  }, []);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <div>
          <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">Monitoring</p>
          <h1 className="font-heading text-3xl">Onboarding queue</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            New Ask Freda requirements appear here as Pending Onboarding. This slice does not replace the
            full admin build workflow.
          </p>
        </div>
        {jobs === null ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {jobs?.length === 0 && !error ? (
          <div className="rounded-xl border border-dashed bg-card px-4 py-10 text-center">
            <p className="font-medium">No jobs yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm a new requirement in Ask Freda to create a Job ID.
            </p>
            <Link href="/" className={cn(buttonVariants({ className: "mt-4" }))}>
              Ask Freda
            </Link>
          </div>
        ) : null}
        <ul className="space-y-3">
          {jobs?.map((job) => (
            <li key={job.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{job.id}</p>
                  <p className="text-sm">{job.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()} · {job.origin}
                  </p>
                </div>
                <Badge>{job.status}</Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{job.estimate?.timeline}</p>
              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                {ticketDetails(job).map((row) => (
                  <div key={row.label} className="min-w-0">
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">{row.label}</dt>
                    <dd className="mt-0.5 break-words">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
