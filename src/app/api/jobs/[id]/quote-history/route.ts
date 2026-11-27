import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { ControlError } from "@/lib/dead-followups/controls";
import { validQuoteJobId } from "@/lib/quote-history/mutation";
import { quoteHistoryEnabled, quoteHistoryRepository, readQuoteHistoryJob } from "@/lib/quote-history/server";

const headers = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!quoteHistoryEnabled()) return new NextResponse(null, { status: 204, headers });
  try {
    const { id } = await context.params;
    const cursor = request.nextUrl.searchParams.get("before");
    const token = tokenFromRequest(request);
    if (!token || token.length > 8192) throw new ControlError("Sign in again.", 401);
    if (!validQuoteJobId(id)) throw new ControlError("Quote not found.", 404);
    if (cursor !== null && (!/^[1-9]\d{0,18}$/.test(cursor) || BigInt(cursor) > BigInt("9223372036854775807"))) {
      throw new ControlError("Invalid history page.");
    }
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const result = await quoteHistoryRepository().list(id, () => readQuoteHistoryJob(token, id), cursor);
    return NextResponse.json(result, { headers });
  } catch (error) {
    const reason = error instanceof ControlError ? error : new ControlError("Could not load quote history.", 503);
    return NextResponse.json({ error: reason.message }, { status: reason.status, headers });
  }
}
