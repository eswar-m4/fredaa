import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// Review now lives on the Dashboard; keep /review (and ?jobId= deep links) working.
function RedirectToDashboard() {
  const navigate = useNavigate();
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("jobId");
    void navigate({ to: "/", search: (jobId ? { jobId } : {}) as any, replace: true });
  }, [navigate]);
  return null;
}

export const Route = createFileRoute("/review")({
  component: RedirectToDashboard,
});
