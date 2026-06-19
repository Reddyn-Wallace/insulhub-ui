import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { GMAIL_OAUTH_SCOPE } from "@/lib/communication-delivery";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireInsulhubAuth(request);
  if (unauthorized) return unauthorized;

  await ensureOverlaySchema();
  const { id } = await params;
  const rows = await overlaySql`
    SELECT *
    FROM communication_senders
    WHERE id = ${id}
    LIMIT 1
  `;
  const sender = rows[0];
  if (!sender) return NextResponse.json({ error: "Sender not found" }, { status: 404 });
  if (stringValue(sender.provider) !== "gmail") return NextResponse.json({ error: "Sender is not a Gmail sender" }, { status: 400 });

  const clientId = process.env.GMAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json(
      { error: "Gmail connect is not configured for this app yet. Add the app Google OAuth client once, then users can connect Gmail with one click." },
      { status: 400 }
    );
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/communication-senders/gmail/callback`;
  const state = Buffer.from(JSON.stringify({ senderId: id, ts: Date.now() }), "utf8").toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  if ((request.headers.get("accept") || "").includes("application/json")) {
    return NextResponse.json({ url: url.toString() });
  }

  return NextResponse.redirect(url);
}
