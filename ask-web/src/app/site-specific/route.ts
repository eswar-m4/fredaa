import { NextResponse } from "next/server";
import { sourcesAgentsLocation } from "@/lib/freda/product-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const agent = new URL(request.url).searchParams.get("agent");
  return NextResponse.redirect(sourcesAgentsLocation(request, agent), 303);
}
