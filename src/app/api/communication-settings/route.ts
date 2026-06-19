import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import {
  loadCommunicationSettings,
  normalizeCommunicationSettings,
  saveCommunicationSettings,
} from "@/lib/communication-settings";

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    const settings = await loadCommunicationSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load communication settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    const input = await request.json();
    const normalized = normalizeCommunicationSettings(input.settings || input);
    if (normalized.campaignSendWindowStartTime >= normalized.campaignSendWindowEndTime) {
      return NextResponse.json({ error: "Send window start must be before the end time" }, { status: 400 });
    }

    const settings = await saveCommunicationSettings(normalized);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save communication settings" },
      { status: 500 }
    );
  }
}
