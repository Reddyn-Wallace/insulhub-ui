import { readSnapshot } from "@/lib/finance/snapshot-store";
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
    const owner = await requireFinanceOwner(request);
    if (request.nextUrl.searchParams.get("snapshot") === "1") {
      const saved = await readSnapshot(owner.userId, "overview", true).catch(
        () => null,
      );
      if (!saved) return financeJson(null);
      return financeJson({
        ...(await buildDashboard(owner, false, false, saved)),
        snapshotStale:
          !Number.isFinite(Date.parse(saved.checkedAt)) ||
          Date.now() - Date.parse(saved.checkedAt) >= 300000,
      });
    }
    return financeJson(
      await buildDashboard(
        owner,
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
