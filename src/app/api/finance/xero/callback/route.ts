import { NextRequest, NextResponse } from "next/server";
import { financeOrigin } from "@/lib/finance/errors";
import {
  finishXeroConnection,
  XERO_COOKIE,
  XERO_CALLBACK,
} from "@/lib/finance/xero-oauth";
export async function GET(request: NextRequest) {
  let outcome = "failed";
  if (request.nextUrl.searchParams.has("error")) outcome = "denied";
  else
    try {
      await finishXeroConnection(
        request.nextUrl.searchParams.get("code") || "",
        request.nextUrl.searchParams.get("state") || "",
        request.cookies.get(XERO_COOKIE)?.value || "",
      );
      outcome = "connected";
    } catch {
      /* Never return provider secrets or authorisation codes. */
    }
  const response = NextResponse.redirect(
    financeOrigin() + "/jobs/finance/connections?xero=" + outcome,
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(XERO_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: XERO_CALLBACK,
    maxAge: 0,
  });
  return response;
}
