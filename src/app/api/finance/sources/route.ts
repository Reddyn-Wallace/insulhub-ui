import type { NextRequest } from "next/server";
import { requireFinanceOwner } from "@/lib/finance/access";
import { financeError, financeJson } from "@/lib/finance/errors";
import { getSourceStatus } from "@/lib/finance/sources";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    return financeJson(
      await getSourceStatus(await requireFinanceOwner(request)),
    );
  } catch (error) {
    return financeError(error);
  }
}
