// Storage-only half of the live-review cache, split out from
// monitoring-live-review.ts so custom-projects.ts can save a project's
// launch-time extraction as its first "live review" without creating an
// import cycle (custom-projects.ts -> monitoring-live-review.ts ->
// live-refresh-profiles.ts -> custom-projects.ts). Only saveLiveReview is
// needed for that, and it has no dependency on getLiveRefreshProfile, so it
// lives here with zero imports back into the profile/project modules.
// monitoring-live-review.ts re-exports everything here for its existing
// callers, so this split is invisible to the rest of the app.
import type { LiveReviewData } from "@/components/ReviewDialog";

export const LIVE_REVIEW_STORAGE_PREFIX = "freda_live_review_";

// Bump whenever a fix changes how live-refresh records are built in a way
// that would make an already-cached run look wrong — see cacheVersion on
// LiveReviewData.
export const LIVE_REVIEW_CACHE_VERSION = 6;

/** Persists the result of a live "Run" (or a project's real launch-time
 *  extraction) so other screens (Review, Dashboard, Monitor's status badge)
 *  can show the same data without re-running it. */
export function saveLiveReview(projectId: string, data: LiveReviewData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LIVE_REVIEW_STORAGE_PREFIX}${projectId}`, JSON.stringify({ ...data, cacheVersion: LIVE_REVIEW_CACHE_VERSION }));
  } catch {
    // Storage full or unavailable — the run still succeeded, just won't persist.
  }
}
