import { getStoredSession } from "@/lib/auth";

type JobCacheState = {
  jobs: any[];
  deletedJobIds: Set<string>;
};

const JOBS_CACHE_STORAGE_KEY = "freda.jobs.cache.v2";
const DELETED_JOBS_STORAGE_KEY = "freda.jobs.deleted.v2";
const LEGACY_JOBS_CACHE_STORAGE_KEY = "freda.jobs.cache.v1";
const LEGACY_DELETED_JOBS_STORAGE_KEY = "freda.jobs.deleted.v1";
const LEGACY_REMOVED_JOB_IDS = new Set([
  "J-1785087847406",
  "J-1785087845727",
  "J-1785087831696",
  "J-1785087827404",
  "J-1784915269447",
]);
const JOBS_CACHE_UPDATED_EVENT = "freda-jobs-cache-updated";

const cachedJobsByOwner = new Map<string, any[]>();
const deletedJobIdsByOwner = new Map<string, Set<string>>();

function getOwnerKey() {
  const session = getStoredSession();
  const username = String(session?.username || "").trim().toLowerCase();
  return username || "__anonymous__";
}

function scopedStorageKey(baseKey: string, ownerKey: string) {
  return `${baseKey}:${ownerKey}`;
}

function loadJson<T>(storageKey: string, fallback: T): T {
  if (typeof window === "undefined" || !window.localStorage) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function persistJson(storageKey: string, value: unknown) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage failures; the in-memory cache still works for the session.
  }
}

function loadPersistedJobsCache(ownerKey: string) {
  const scoped = loadJson<any[]>(scopedStorageKey(JOBS_CACHE_STORAGE_KEY, ownerKey), []);
  if (Array.isArray(scoped) && scoped.length > 0) {
    return scoped;
  }

  if (ownerKey === "user") {
    const legacy = loadJson<any[]>(LEGACY_JOBS_CACHE_STORAGE_KEY, []);
    if (Array.isArray(legacy) && legacy.length > 0) {
      persistJson(scopedStorageKey(JOBS_CACHE_STORAGE_KEY, ownerKey), legacy);
      return legacy;
    }
  }

  return [];
}

function loadPersistedDeletedJobIds(ownerKey: string) {
  const scoped = loadJson<string[]>(scopedStorageKey(DELETED_JOBS_STORAGE_KEY, ownerKey), []);
  if (Array.isArray(scoped) && scoped.length > 0) {
    return new Set(scoped.map((id) => String(id)).filter(Boolean));
  }

  if (ownerKey === "user") {
    const legacy = loadJson<string[]>(LEGACY_DELETED_JOBS_STORAGE_KEY, []);
    if (Array.isArray(legacy) && legacy.length > 0) {
      const next = new Set(legacy.map((id) => String(id)).filter(Boolean));
      persistJson(scopedStorageKey(DELETED_JOBS_STORAGE_KEY, ownerKey), [...next]);
      return next;
    }
  }

  return new Set<string>();
}

function getState(ownerKey: string): JobCacheState {
  let jobs = cachedJobsByOwner.get(ownerKey);
  if (!jobs) {
    jobs = loadPersistedJobsCache(ownerKey);
    cachedJobsByOwner.set(ownerKey, jobs);
  }

  let deletedJobIds = deletedJobIdsByOwner.get(ownerKey);
  if (!deletedJobIds) {
    deletedJobIds = loadPersistedDeletedJobIds(ownerKey);
    deletedJobIdsByOwner.set(ownerKey, deletedJobIds);
  }

  LEGACY_REMOVED_JOB_IDS.forEach((id) => deletedJobIds.add(id));
  return { jobs, deletedJobIds };
}

function persistState(ownerKey: string, state: JobCacheState) {
  persistJson(scopedStorageKey(JOBS_CACHE_STORAGE_KEY, ownerKey), state.jobs);
  persistJson(scopedStorageKey(DELETED_JOBS_STORAGE_KEY, ownerKey), [...state.deletedJobIds]);
}

function filterDeletedJobs(jobs: any[], deletedIds: Set<string>) {
  return jobs.filter((job) => {
    const key = job && job.id !== undefined && job.id !== null ? String(job.id) : "";
    return !key || (!deletedIds.has(key) && !LEGACY_REMOVED_JOB_IDS.has(key));
  });
}

export function readJobsCache() {
  const ownerKey = getOwnerKey();
  const state = getState(ownerKey);
  state.jobs = filterDeletedJobs(state.jobs, state.deletedJobIds);
  cachedJobsByOwner.set(ownerKey, state.jobs);
  persistState(ownerKey, state);
  return state.jobs;
}

export function writeJobsCache(jobs: any[]) {
  const ownerKey = getOwnerKey();
  const state = getState(ownerKey);

  if (!Array.isArray(jobs)) {
    state.jobs = [];
    cachedJobsByOwner.set(ownerKey, state.jobs);
    persistState(ownerKey, state);
    return state.jobs;
  }

  const uniqueJobs: any[] = [];
  const seenIds = new Set<string>();
  const latestById = new Map<string, any>();

  for (const job of jobs) {
    const key = job && job.id !== undefined && job.id !== null ? String(job.id) : "";
    if (!key) {
      uniqueJobs.push(job);
      continue;
    }
    if (!seenIds.has(key)) {
      seenIds.add(key);
    }
    latestById.set(key, job);
  }
  seenIds.forEach((id) => {
    const job = latestById.get(id);
    if (job !== undefined) {
      uniqueJobs.push(job);
    }
  });

  const previousById = new Map<string, any>();
  state.jobs.forEach((job) => {
    if (job && job.id !== undefined && job.id !== null) {
      previousById.set(String(job.id), job);
    }
  });

  state.jobs = filterDeletedJobs(uniqueJobs, state.deletedJobIds).map((job) => {
    const key = job && job.id !== undefined && job.id !== null ? String(job.id) : "";
    const previous = key ? previousById.get(key) : null;
    if (!previous) {
      return job;
    }

    const merged = { ...previous, ...job };
    if (merged.review_summary === undefined && previous.review_summary !== undefined) {
      merged.review_summary = previous.review_summary;
    }
    if (merged.review_summary_updated_at === undefined && previous.review_summary_updated_at !== undefined) {
      merged.review_summary_updated_at = previous.review_summary_updated_at;
    }
    if (merged.approved_count === undefined && previous.approved_count !== undefined) {
      merged.approved_count = previous.approved_count;
    }
    if (merged.rejected_count === undefined && previous.rejected_count !== undefined) {
      merged.rejected_count = previous.rejected_count;
    }
    if (merged.is_urgent === undefined && previous.is_urgent !== undefined) {
      merged.is_urgent = previous.is_urgent;
    }
    if (merged.isUrgent === undefined && merged.is_urgent !== undefined) {
      merged.isUrgent = Boolean(merged.is_urgent);
    }
    return merged;
  });

  cachedJobsByOwner.set(ownerKey, state.jobs);
  persistState(ownerKey, state);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(JOBS_CACHE_UPDATED_EVENT));
  }
  return state.jobs;
}

export function jobsCacheUpdatedEventName() {
  return JOBS_CACHE_UPDATED_EVENT;
}

export function markJobDeleted(jobId: string) {
  const key = String(jobId || "").trim();
  if (!key) return;
  const ownerKey = getOwnerKey();
  const state = getState(ownerKey);
  LEGACY_REMOVED_JOB_IDS.add(key);
  state.deletedJobIds.add(key);
  state.jobs = state.jobs.filter((job) => String(job?.id ?? "") !== key);
  cachedJobsByOwner.set(ownerKey, state.jobs);
  deletedJobIdsByOwner.set(ownerKey, state.deletedJobIds);
  persistState(ownerKey, state);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(JOBS_CACHE_UPDATED_EVENT));
  }
}

export function clearDeletedJob(jobId: string) {
  const key = String(jobId || "").trim();
  if (!key) return;
  const ownerKey = getOwnerKey();
  const state = getState(ownerKey);
  LEGACY_REMOVED_JOB_IDS.delete(key);
  if (state.deletedJobIds.delete(key)) {
    persistState(ownerKey, state);
  }
}
