// Fire-and-forget activity logger — sends user actions to the gateway's /freda-log endpoint.
// All errors are silently swallowed so logging never blocks or breaks the UI.

export function logActivity(action: string, details: string, page?: string): void {
  if (typeof fetch === "undefined") return;
  try {
    fetch("/freda-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        details,
        page: page ?? (typeof window !== "undefined" ? window.location.pathname : ""),
      }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}
