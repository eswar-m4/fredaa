import { NextResponse } from "next/server";
import { datasetSetupLocation, sourcesAgentsLocation } from "@/lib/freda/product-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Old placeholder URL — send "Use this capability" clicks to the matching playbook. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const id = params.get("id") || params.get("dataset") || params.get("agent");
  if (kind === "agent") {
    return NextResponse.redirect(sourcesAgentsLocation(request, id), 303);
  }
  return NextResponse.redirect(datasetSetupLocation(request, id), 303);
}
