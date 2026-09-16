// Monitor's "Job automation status" table lists deterministically-seeded
// run history per project (jobsFor() in customers.ts) — there's no backend
// job queue to delete from, so "delete" here means "hide permanently for
// this browser", persisted the same way ticket-store.ts persists tickets.
// Job ids are stable across reloads (derived from a hash of the project id
// + slot, not randomly regenerated), so a deleted id stays hidden.
import { useSyncExternalStore } from "react";

const KEY = "freda_deleted_jobs_v1";
const listeners = new Set<() => void>();
let cache: string[] | null = null;
const EMPTY: string[] = [];

function read(): string[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as string[]) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function persist(next: string[]) {
  cache = next;
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export function useDeletedJobIds(): Set<string> {
  const ids = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMPTY,
  );
  return new Set(ids);
}

export function deleteJob(jobId: string) {
  const current = read();
  if (current.includes(jobId)) return;
  persist([...current, jobId]);
}

export function deleteJobs(jobIds: string[]) {
  const current = new Set(read());
  jobIds.forEach((id) => current.add(id));
  persist([...current]);
}

export function restoreAllJobs() {
  persist([]);
}
