import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { overlaySql } from "@/lib/overlay-db";

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const rows = await overlaySql`SELECT value FROM overlay_settings WHERE key = 'job_sms_enabled'`;
    return NextResponse.json({ enabled: rows[0]?.value === "true", canManage: true });
  } catch { return NextResponse.json({ error: "Could not verify access to SMS settings." }, { status: 403 }); }
}
export async function PATCH(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const input = await request.json();
    if (typeof input.enabled !== "boolean") return NextResponse.json({ error: "Choose whether CRM SMS is enabled." }, { status: 400 });
    // Enabling is allowed only after the explicit additive migration has run.
    if (input.enabled) await overlaySql`SELECT id FROM job_sms_messages LIMIT 1`;
    await overlaySql`INSERT INTO overlay_settings(key,value) VALUES('job_sms_enabled',${String(input.enabled)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`;
    return NextResponse.json({ enabled: input.enabled, canManage: true });
  } catch { return NextResponse.json({ error: "Could not update CRM SMS availability. Check access and database setup." }, { status: 503 }); }
}
