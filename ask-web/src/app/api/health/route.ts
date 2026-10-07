import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API = process.env.FREDA_API_URL || "http://127.0.0.1:43148";

export async function GET() {
  try {
    const response = await fetch(`${API}/health`, { cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        ok: false,
        error: "The Ask Freda Python API is not reachable.",
        detail: `${detail} Start it with: npm run api`,
      },
      { status: 503 },
    );
  }
}
