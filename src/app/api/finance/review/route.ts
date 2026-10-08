import type { NextRequest } from "next/server";
import { requireFinanceOwner } from "@/lib/finance/access";
import { FinanceError, financeError, financeJson } from "@/lib/finance/errors";
import { loadFinanceInputs } from "@/lib/finance/live-data";
import { saveReviewDecision } from "@/lib/finance/review-store";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  try {
    const owner = await requireFinanceOwner(request);
    const raw = await request.text();
    if (raw.length > 20000)
      throw new FinanceError(400, "Review request is too large.");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new FinanceError(400, "Invalid review request.");
    }
    return financeJson(
      await saveReviewDecision(
        owner.userId,
        await loadFinanceInputs(
          owner,
          body?.value?.kind === "receipt" || body?.value?.kind === "opening",
        ),
        body,
      ),
    );
  } catch (e) {
    return financeError(e);
  }
}
