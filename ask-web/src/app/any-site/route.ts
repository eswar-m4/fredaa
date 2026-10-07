import { NextResponse } from "next/server";
import { datasetSetupLocation } from "@/lib/freda/product-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const dataset = new URL(request.url).searchParams.get("dataset");
  return NextResponse.redirect(datasetSetupLocation(request, dataset), 303);
}
