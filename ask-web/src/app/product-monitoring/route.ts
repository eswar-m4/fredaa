import { NextResponse } from "next/server";
import { productMonitoringLocation } from "@/lib/freda/product-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return NextResponse.redirect(productMonitoringLocation(request), 303);
}
