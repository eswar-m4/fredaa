import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { fetchSession } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  head: () => ({ meta: [{ title: "Redirecting — FreDA" }] }),
  component: LoginRedirect,
});

function LoginRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    async function check() {
      const session = await fetchSession();
      if (!active) return;
      if (session) {
        navigate({ to: session.role === "admin" ? "/admin" : "/", replace: true });
      } else {
        // No gateway session — send to gateway login page
        window.location.replace("/auth/logout");
      }
    }
    void check();
    return () => { active = false; };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Redirecting…
      </div>
    </div>
  );
}
