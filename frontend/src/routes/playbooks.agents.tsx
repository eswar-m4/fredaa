import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// The agents catalog lives on /site-specific ("Sources & Agents"); this route
// only exists so the Playbooks tile has a /playbooks/* path, like solutions/ask.
function RedirectToAgents() {
  const navigate = useNavigate();
  useEffect(() => { void navigate({ to: "/site-specific", replace: true }); }, [navigate]);
  return null;
}

export const Route = createFileRoute("/playbooks/agents")({
  component: RedirectToAgents,
});
