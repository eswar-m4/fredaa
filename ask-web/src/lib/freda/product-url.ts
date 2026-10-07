const DEFAULT_PRODUCT_PORT = "5433";

/** Origin of the live Freda product UI (dataset setup, library, monitoring). */
export function liveProductOrigin(request: Request): string {
  const override = (process.env.FREDA_PRODUCT_URL || "").trim().replace(/\/$/, "");
  if (override) return override;

  const url = new URL(request.url);
  const proto = (request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0].trim();
  const hostHeader = (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    url.host
  )
    .split(",")[0]
    .trim();
  const hostname = hostHeader.split(":")[0];
  const port = (process.env.FREDA_PRODUCT_PORT || DEFAULT_PRODUCT_PORT).trim();
  return `${proto}://${hostname}:${port}`;
}

/** Mythili-freda dataset setup page, optionally deep-linked to a catalog solution. */
export function datasetSetupLocation(request: Request, datasetId?: string | null): string {
  const origin = liveProductOrigin(request);
  if (datasetId) return `${origin}/any-site?dataset=${encodeURIComponent(datasetId)}`;
  return `${origin}/any-site`;
}

/** Mythili-freda Sources & Agents page, optionally deep-linked to an onboarded agent. */
export function sourcesAgentsLocation(request: Request, agentId?: string | null): string {
  const origin = liveProductOrigin(request);
  if (agentId) return `${origin}/site-specific?agent=${encodeURIComponent(agentId)}`;
  return `${origin}/site-specific`;
}

/** Live Freda Monitoring, where Ask Freda solution requests are queued. */
export function productMonitoringLocation(request: Request): string {
  return `${liveProductOrigin(request)}/monitoring`;
}

/** Rewrite a genesis-relative Freda path onto the live product origin. */
export function rewriteToLiveProduct(request: Request, target: URL): string | URL {
  switch (target.pathname) {
    case "/any-site":
      return datasetSetupLocation(request, target.searchParams.get("dataset"));
    case "/site-specific":
      return sourcesAgentsLocation(request, target.searchParams.get("agent"));
    case "/library": {
      const q = target.searchParams.get("q");
      const origin = liveProductOrigin(request);
      return q ? `${origin}/library?q=${encodeURIComponent(q)}` : `${origin}/library`;
    }
    case "/monitoring":
      return productMonitoringLocation(request);
    default:
      return target;
  }
}
