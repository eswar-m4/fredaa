import { createFileRoute, redirect } from "@tanstack/react-router";

// "Overview" used to poll a real backend API (/api/v1/admin/requests) that
// this build never had — auth.ts is explicit that no backend is wired here,
// everything lives in the browser via ticket-store.ts. admin-tickets.tsx is
// the real, working local admin console (same data, plus workspace filters,
// approve/reject, notes, onboarding checklist) — so /admin now just lands
// there instead of showing a permanently-broken "failed to fetch" page.
export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    throw redirect({ to: "/admin-tickets" });
  },
});
