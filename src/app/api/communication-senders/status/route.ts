import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";

export async function GET(request: NextRequest) {
  const unauthorized = await requireInsulhubAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    gmail: {
      configured: Boolean(
        (process.env.GMAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim()) &&
        (process.env.GMAIL_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim())
      ),
    },
  });
}
