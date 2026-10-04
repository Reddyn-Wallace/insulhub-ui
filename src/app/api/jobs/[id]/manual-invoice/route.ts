import { NextRequest, NextResponse } from "next/server";
import { jobSmsIdentity } from "@/lib/job-sms-access";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";
import { validateManualInvoice, type ManualInvoiceConfirmation } from "@/lib/job-completion";

type Context = { params: Promise<{ id: string }> };
// UI-owned confirmation of an externally sent invoice; never an invoice/Xero record.
const keyFor = (id: string) => `job-manual-invoice:${id}`;
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (message === "Job not found") return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ error: "Could not access the manual invoice confirmation. Please try again." }, { status: 503 });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    await jobSmsIdentity(request, id);
    await ensureOverlaySchema();
    const rows = await overlaySql`SELECT value FROM overlay_settings WHERE key=${keyFor(id)}`;
    return NextResponse.json({ confirmation: rows[0] ? JSON.parse(String(rows[0].value)) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const { me } = await jobSmsIdentity(request, id);
    let reference: string;
    try { reference = validateManualInvoice(await request.json()); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid confirmation." }, { status: 400 }); }
    const confirmation: ManualInvoiceConfirmation = {
      reference, confirmedAt: new Date().toISOString(), confirmedBy: me._id,
      confirmedByName: [me.firstname, me.lastname].filter(Boolean).join(" ") || me._id,
    };
    await ensureOverlaySchema();
    // Idempotent: a retry cannot overwrite the person/time of the original confirmation.
    await overlaySql`INSERT INTO overlay_settings(key,value,updated_at)
      VALUES(${keyFor(id)},${JSON.stringify(confirmation)},now()) ON CONFLICT(key) DO NOTHING`;
    const rows = await overlaySql`SELECT value FROM overlay_settings WHERE key=${keyFor(id)}`;
    const saved = JSON.parse(String(rows[0].value)) as ManualInvoiceConfirmation;
    if (saved.reference !== reference) return NextResponse.json({ error: "An invoice has already been confirmed for this job. Refresh to see its reference." }, { status: 409 });
    return NextResponse.json({ confirmation: saved });
  } catch (error) { return failure(error); }
}
