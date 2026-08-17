import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/workflows")({
  head: () => ({ meta: [{ title: "Freda" }] }),
  component: WorkflowsRedirect,
});

function WorkflowsRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}
