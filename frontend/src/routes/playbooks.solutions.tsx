import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function RedirectToSolutions() {
  const navigate = useNavigate();
  useEffect(() => { void navigate({ to: "/any-site", replace: true }); }, [navigate]);
  return null;
}

export const Route = createFileRoute("/playbooks/solutions")({
  component: RedirectToSolutions,
});
