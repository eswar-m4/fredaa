// Persists when each project was last actually run ("Run now" in Monitor),
// so Last run / Next run reflect real runs instead of the static seeded
// lastRefreshHrs/nextRefreshHrs on the project, which never change.
import { useSyncExternalStore } from "react";

const KEY_PREFIX = "freda_last_run_";
const listeners = new Set<() => void>();
let tick = 0;

const CADENCE_HRS: Record<string, number> = { Hourly: 1, Daily: 24, Weekly: 168, Monthly: 720, Quarterly: 2160 };

export function recordProjectRun(projectId: string, at: Date = new Date()) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${projectId}`, at.toISOString());
  } catch {
    // Storage full or unavailable — the run still happened, it just won't persist.
  }
  tick++;
  listeners.forEach((l) => l());
}

export function getLastRunAt(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${KEY_PREFIX}${projectId}`);
  } catch {
    return null;
  }
}

export function clearProjectRun(projectId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${KEY_PREFIX}${projectId}`);
  } catch {
    // ignore
  }
  tick++;
  listeners.forEach((l) => l());
}

/** Last/next run in hours for a project — from its latest recorded run when
 *  there is one (or `fallbackRunAt`, e.g. a saved live check's checkedAt),
 *  otherwise the project's own seeded values. */
export function runTimesFor(
  p: { id: string; frequency: string; lastRefreshHrs: number; nextRefreshHrs: number },
  fallbackRunAt?: string | null,
): { lastHrs: number; nextHrs: number } {
  const runAt = getLastRunAt(p.id) ?? fallbackRunAt ?? null;
  const t = runAt ? Date.parse(runAt) : NaN;
  if (Number.isNaN(t)) return { lastHrs: p.lastRefreshHrs, nextHrs: p.nextRefreshHrs };
  const lastHrs = Math.max(0, (Date.now() - t) / 3_600_000);
  const gap = CADENCE_HRS[p.frequency] ?? 168;
  return { lastHrs, nextHrs: Math.max(0, gap - (lastHrs % gap)) };
}

/** Re-render whenever any project's recorded run changes. */
export function useLastRunVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tick,
    () => 0,
  );
}
