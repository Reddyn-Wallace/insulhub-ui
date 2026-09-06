import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { jobSmsIdentity } from "@/lib/job-sms-access";
import { readJobMessagingSettings } from "@/lib/job-messaging-settings";
import { overlaySql } from "@/lib/overlay-db";

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const settings = await readJobMessagingSettings();
    const identity = settings.testUserId ? await jobSmsIdentity(request) : null;
    return NextResponse.json({ enabled: settings.enabled, testOnly: !!settings.testUserId, testerName: settings.testerName, isTester: identity?.me._id === settings.testUserId, canManage: true });
  } catch { return NextResponse.json({ error: "Could not load CRM messaging settings." }, { status: 503 }); }
}
export async function PATCH(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const input = await request.json();
    if (typeof input.enabled !== "boolean" || (input.testOnly !== undefined && typeof input.testOnly !== "boolean")) return NextResponse.json({ error: "Choose whether CRM messaging and account-only testing are enabled." }, { status: 400 });
    if (input.enabled) {
      await overlaySql`SELECT id FROM job_sms_messages LIMIT 1`;
      await overlaySql`SELECT id FROM job_email_messages LIMIT 1`;
    }
    if (input.testOnly === undefined) {
      // Preserve the audience when an older settings screen toggles the master switch.
      await overlaySql`INSERT INTO overlay_settings(key,value) VALUES('job_sms_enabled',${String(input.enabled)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`;
      return NextResponse.json({ enabled: input.enabled, canManage: true });
    }
    const identity = input.testOnly ? await jobSmsIdentity(request) : null;
    const testerName = identity ? [identity.me.firstname, identity.me.lastname].filter(Boolean).join(" ") || identity.me._id : "";
    const testValue = identity ? JSON.stringify({ userId: identity.me._id, name: testerName }) : "";
    // Set the master flag and audience atomically, with the tester derived from authentication.
    await overlaySql`INSERT INTO overlay_settings(key,value) VALUES('job_sms_enabled',${String(input.enabled)}),('job_crm_test_user',${testValue}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`;
    return NextResponse.json({ enabled: input.enabled, testOnly: input.testOnly, testerName, isTester: input.testOnly, canManage: true });
  } catch { return NextResponse.json({ error: "Could not update CRM messaging. Check access and database setup." }, { status: 503 }); }
}
