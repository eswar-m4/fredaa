// Persists real review progress per project so the Dashboard's "Review
// pending / in progress / completed" badge reflects what a user actually
// did in ReviewDialog, not a static seeded number that never changes no
// matter how many records get decided and submitted.
import { useSyncExternalStore } from "react";

export type ReviewProgress = { decided: number; total: number; updatedAt: string };

const KEY_PREFIX = "freda_review_progress_";
const listeners = new Set<() => void>();
let tick = 0;

function notify() {
  tick++;
  listeners.forEach((l) => l());
}

/** Called after a real Submit in ReviewDialog — `total` should be every
 *  record currently loaded for the project (not just the filtered/batched
 *  view), so a filter left applied at submit time can't falsely read as
 *  full coverage. */
export function recordReviewSubmission(projectId: string, decided: number, total: number) {
  if (typeof window === "undefined") return;
  try {
    const progress: ReviewProgress = { decided, total, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(`${KEY_PREFIX}${projectId}`, JSON.stringify(progress));
  } catch {
    // Storage full or unavailable — the submit still happened, it just won't persist.
  }
  notify();
}

export function getReviewProgress(projectId: string): ReviewProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${projectId}`);
    return raw ? (JSON.parse(raw) as ReviewProgress) : null;
  } catch {
    return null;
  }
}

/** A live run (or a fresh sample-file reload) can change what "every record"
 *  even means for a project, so a prior 100%-decided submission shouldn't
 *  keep reading as Completed against a different record set. Call this when
 *  that set changes (e.g. right after a live "Run" completes). */
export function clearReviewProgress(projectId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${KEY_PREFIX}${projectId}`);
  } catch {
    // ignore
  }
  notify();
}

/** Subscribe a component to re-render whenever any project's review
 *  progress changes — reviewStatusFor() itself stays a plain, synchronous
 *  localStorage read so it can be called from a .map() callback. */
export function useReviewStatusVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tick,
    () => 0,
  );
}
