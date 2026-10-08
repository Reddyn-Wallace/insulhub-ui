import type { NextRequest } from "next/server";
import { requireFinanceOwner } from "@/lib/finance/access";
import { financeError, financeJson } from "@/lib/finance/errors";
import { buildDashboard } from "@/lib/finance/dashboard";
import { settleDashboardLoads } from "@/lib/finance/snapshot-cache";
import { refreshBankAccounts } from "@/lib/finance/bank-refresh";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  try {
    return financeJson(
      await buildDashboard(
        await requireFinanceOwner(request),
        request.nextUrl.searchParams.get("bank") === "1",
        request.nextUrl.searchParams.get("refresh") === "1",
      ),
    );
  } catch (e) {
    return financeError(e);
  }
}

// Only an explicit owner action requests upstream refresh; normal GET remains read-only.
export async function POST(request: NextRequest) {
  try {
    const owner = await requireFinanceOwner(request);
    const bankRefresh = await refreshBankAccounts();
    await settleDashboardLoads(owner.userId);
    const dashboard = await buildDashboard(owner, false, true);
    return financeJson({ ...dashboard, bankRefresh });
  } catch (e) {
    return financeError(e);
  }
}
