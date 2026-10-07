import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API = process.env.FREDA_API_URL || "http://127.0.0.1:43148";

async function proxy(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "The Ask Freda Python API is not reachable.", detail },
      { status: 503 },
    );
  }
}

export async function GET() {
  return proxy("/jobs");
}

export async function POST(request: Request) {
  return proxy("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
