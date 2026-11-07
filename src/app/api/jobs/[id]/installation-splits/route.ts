import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { readSplits, SplitError } from "@/lib/installation-splits/store";
import { changeSplit, loadSplitSource } from "@/lib/installation-splits/server";
type Context = { params: Promise<{ id: string }> };
function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof SplitError
          ? error.message
          : "Installation visits could not be loaded or saved. Please retry; contact an administrator if this continues.",
    },
    { status: error instanceof SplitError ? error.status : 503 },
  );
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const denied = await requireInsulhubAuth(request);
    if (denied) return denied;
    const { id } = await context.params;
    if (!/^[a-f\d]{24}$/i.test(id)) throw new SplitError("Invalid job ID.");
    const { job } = await loadSplitSource(tokenFromRequest(request), id);
    const split = (await readSplits([id]))[id] || null;
    return NextResponse.json(
      { split, job },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const denied = await requireInsulhubAuth(request);
    if (denied) return denied;
    const { id } = await context.params;
    if (!/^[a-f\d]{24}$/i.test(id)) throw new SplitError("Invalid job ID.");
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new SplitError("Invalid visit change.");
    const split = await changeSplit(tokenFromRequest(request), id, input);
    return NextResponse.json(
      { split },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
