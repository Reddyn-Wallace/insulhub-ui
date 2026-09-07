import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";

// Compatibility for tabs opened before general release. Rollout settings are retired.
export async function GET(request: NextRequest) {
  const unauthorized = await requireInsulhubAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ enabled: true, testOnly: false, testerName: "", isTester: false, canManage: false });
}
export async function PATCH(request: NextRequest) {
  const unauthorized = await requireInsulhubAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ error: "CRM messaging is now available to everyone. Refresh Settings; these rollout controls have been removed." }, { status: 410 });
}
