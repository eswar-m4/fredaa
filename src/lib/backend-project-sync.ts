// Background sync for backend projects: while any project has a backend run
// in flight, poll the shared FreDA backend and pull finished runs into the
// workspace (Review records, counts, status). Mounted once in AppLayout, so
// launches from Solutions or Agents complete even after navigating away.
import { useEffect } from "react";
import { awaitedJobs, checkBackendJob } from "@/lib/backend-datasets";
import { applyBackendRun, pendingBackendProjects } from "@/lib/custom-projects";

const POLL_MS = 8000;
let running = false;

async function syncOnce() {
  if (running) return;
  running = true;
  try {
    for (const { project, profile } of pendingBackendProjects()) {
      if (awaitedJobs.has(profile.backendJobId)) continue;
      try {
        const state = await checkBackendJob(profile.backendJobId);
        if (state.done) applyBackendRun(project.id, state);
      } catch (err) {
        // Backend unreachable for now — try again on the next tick.
        console.warn(`Backend sync for ${project.name} failed:`, err);
      }
    }
  } finally {
    running = false;
  }
}

export function useBackendProjectSync() {
  useEffect(() => {
    void syncOnce();
    const timer = window.setInterval(() => void syncOnce(), POLL_MS);
    return () => window.clearInterval(timer);
  }, []);
}
