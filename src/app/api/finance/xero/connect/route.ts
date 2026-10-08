import type { NextRequest } from "next/server";
import { requireFinanceOwner } from "@/lib/finance/access";
import { financeError, financeJson } from "@/lib/finance/errors";
import {
  startXeroConnection,
  XERO_COOKIE,
  XERO_CALLBACK,
} from "@/lib/finance/xero-oauth";
export async function POST(request: NextRequest) {
  try {
    const owner = await requireFinanceOwner(request);
    const result = await startXeroConnection(owner.userId);
    const response = financeJson({ url: result.url });
    response.cookies.set(XERO_COOKIE, result.state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: XERO_CALLBACK,
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return financeError(error);
  }
}
