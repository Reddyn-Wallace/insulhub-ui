import { NextRequest, NextResponse } from "next/server";
import { fetchGmailSignature, testCommunicationConnection } from "@/lib/communication-delivery";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function parseResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error_description: text };
  }
}

function settingsRedirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/jobs/settings", request.url);
  url.searchParams.set("section", "senders");
  url.searchParams.set("channel", "email");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  await ensureOverlaySchema();
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";
  const state = url.searchParams.get("state") || "";
  if (error) return settingsRedirect(request, { connectError: error });
  if (!code) return settingsRedirect(request, { connectError: "missing_code" });

  let senderId = "";
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { senderId?: string };
    senderId = decoded.senderId || "";
  } catch {
    return settingsRedirect(request, { connectError: "invalid_state" });
  }
  if (!senderId) return settingsRedirect(request, { connectError: "invalid_state" });

  const rows = await overlaySql`
    SELECT *
    FROM communication_senders
    WHERE id = ${senderId}
    LIMIT 1
  `;
  const sender = rows[0];
  if (!sender) return settingsRedirect(request, { connectError: "sender_not_found" });
  if (stringValue(sender.provider) !== "gmail") return settingsRedirect(request, { connectError: "not_gmail_sender" });

  const clientId = process.env.GMAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return settingsRedirect(request, { connectError: "missing_oauth_client" });

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/communication-senders/gmail/callback`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const body = await parseResponseBody(response);
  if (!response.ok || typeof body.access_token !== "string") {
    return settingsRedirect(request, {
      connectError: String(body.error_description || body.error || "token_exchange_failed"),
    });
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in || 3600);
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : stringValue(sender.provider_refresh_token);
  const tokenExpiresAt = new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString();
  const connectionResult = await testCommunicationConnection({
    provider: "gmail",
    accessToken: String(body.access_token),
    refreshToken,
    tokenExpiresAt,
  });
  const signatureResult = await fetchGmailSignature({
    provider: "gmail",
    accessToken: String(body.access_token),
    refreshToken,
    tokenExpiresAt,
  }, stringValue(sender.sender_value));
  const existingConfig = sender.provider_config && typeof sender.provider_config === "object"
    ? sender.provider_config as Record<string, unknown>
    : {};
  const connectedEmail = signatureResult.signatureEmail || stringValue(sender.sender_value);
  const providerConfig = {
    ...existingConfig,
    ...(signatureResult.ok ? {
      gmailSignature: signatureResult.signature || "",
      gmailSignatureEmail: connectedEmail,
      gmailSignatureSyncedAt: new Date().toISOString(),
      gmailSignatureSyncError: "",
    } : {
      gmailSignatureSyncError: signatureResult.failureReason || "Could not sync Gmail signature",
    }),
  };

  await overlaySql`
    UPDATE communication_senders
    SET
      sender_value = ${connectedEmail},
      provider_config = ${JSON.stringify(providerConfig)}::jsonb,
      provider_access_token = ${connectionResult.accessToken || signatureResult.accessToken || String(body.access_token)},
      provider_refresh_token = ${connectionResult.refreshToken || signatureResult.refreshToken || refreshToken},
      provider_token_expires_at = ${connectionResult.tokenExpiresAt || signatureResult.tokenExpiresAt || tokenExpiresAt},
      connected_at = ${connectionResult.ok ? new Date().toISOString() : null},
      connection_status = ${connectionResult.ok ? "connected" : "disconnected"},
      last_tested_at = now(),
      updated_at = now()
    WHERE id = ${senderId}
  `;

  if (!connectionResult.ok) {
    return settingsRedirect(request, {
      connectError: connectionResult.failureReason || "connection_test_failed",
    });
  }

  return settingsRedirect(request, signatureResult.ok
    ? { connected: "gmail", signature: signatureResult.signature ? "synced" : "empty" }
    : { connected: "gmail", signature: "sync_failed" }
  );
}
