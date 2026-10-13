import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function RedirectToAsk() {
  const navigate = useNavigate();
  useEffect(() => { void navigate({ to: "/discover", replace: true }); }, [navigate]);
  return null;
}

export const Route = createFileRoute("/playbooks/ask")({
  component: RedirectToAsk,
});
