import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleFredaForm } from "@/lib/freda/handle-turn";
import { rewriteToLiveProduct } from "@/lib/freda/product-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectHome(sid?: string) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/" },
  });
  if (sid) {
    response.cookies.set("freda_sid", sid, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return response;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const result = await handleFredaForm(formData);
  const jar = await cookies();
  const sid = jar.get("freda_sid")?.value;
  if (result?.redirectTo) {
    const target = new URL(result.redirectTo, request.url);
    const location = rewriteToLiveProduct(request, target);
    const response = NextResponse.redirect(location, 303);
    if (sid) {
      response.cookies.set("freda_sid", sid, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return response;
  }
  return redirectHome(sid);
}

export async function GET() {
  return redirectHome();
}
