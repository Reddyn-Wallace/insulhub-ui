import type { NextRequest } from "next/server";
import { requireFinanceOwner } from "@/lib/finance/access";
import { financeError, financeJson } from "@/lib/finance/errors";
import { buildDashboard } from "@/lib/finance/dashboard";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  try {
    return financeJson(
      await buildDashboard(await requireFinanceOwner(request)),
    );
  } catch (e) {
    return financeError(e);
  }
}
