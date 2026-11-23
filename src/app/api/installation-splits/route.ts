import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { readPendingSplits, readSplits } from "@/lib/installation-splits/store";
import { reconcileListedSplits } from "@/lib/installation-splits/reconcile";
// Same staff-only access as the existing calendar and usage-report job list.
export async function POST(request: NextRequest) {
  const denied = await requireInsulhubAuth(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (
    body?.pending !== true && (
    !Array.isArray(body?.jobIds) ||
    body.jobIds.length > 10000 ||
    !body.jobIds.every(
      (id: unknown) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id),
    ))
  )
    return NextResponse.json({ error: "Invalid job IDs." }, { status: 400 });
  try {
    const stored = body.pending === true ? await readPendingSplits() : await readSplits(body.jobIds);
    const reconciled = await reconcileListedSplits(stored, tokenFromRequest(request));
    const splits = body.pending === true
      ? Object.fromEntries(Object.entries(reconciled).filter(([, split]) =>
        split.visits.some(visit => visit.state === "planned"),
      ))
      : reconciled;
    return NextResponse.json(
      { splits },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Visit allocations could not be loaded. Reporting stopped to avoid showing incorrect totals.",
      },
      { status: 503 },
    );
  }
}
