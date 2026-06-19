import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { fetchGmailSignature } from "@/lib/communication-delivery";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function publicProviderConfig(value: unknown) {
  const config = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    smsgateBaseUrl: stringValue(config.smsgateBaseUrl),
    smsgateUsername: stringValue(config.smsgateUsername),
    smsgateDeviceId: stringValue(config.smsgateDeviceId),
    gmailSignature: stringValue(config.gmailSignature),
    gmailSignatureEmail: stringValue(config.gmailSignatureEmail),
    gmailSignatureSyncedAt: stringValue(config.gmailSignatureSyncedAt),
    gmailSignatureSyncError: stringValue(config.gmailSignatureSyncError),
    hasSmsgateAuthToken: Boolean(config.smsgateAuthToken),
    hasSmsgatePassword: Boolean(config.smsgatePassword),
  };
}

function toSender(row: Record<string, unknown>) {
  return {
    id: stringValue(row.id),
    channel: stringValue(row.channel),
    label: stringValue(row.label),
    senderValue: stringValue(row.sender_value),
    provider: stringValue(row.provider),
    providerConfig: publicProviderConfig(row.provider_config),
    connectionStatus: stringValue(row.connection_status),
    connectedAt: row.connected_at,
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    lastTestedAt: row.last_tested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    if (stringValue(sender.provider) !== "gmail") {
      return NextResponse.json({ error: "Sender is not a Gmail sender" }, { status: 400 });
    }

    const existingConfig = sender.provider_config && typeof sender.provider_config === "object"
      ? sender.provider_config as Record<string, unknown>
      : {};
    const signatureResult = await fetchGmailSignature({
      provider: "gmail",
      providerConfig: existingConfig as Record<string, string>,
      accessToken: stringValue(sender.provider_access_token),
      refreshToken: stringValue(sender.provider_refresh_token),
      tokenExpiresAt: sender.provider_token_expires_at as string | null,
    }, stringValue(sender.sender_value));

    if (!signatureResult.ok) {
      const failedConfig = {
        ...existingConfig,
        gmailSignatureSyncError: signatureResult.failureReason || "Could not sync Gmail signature",
      };
      await overlaySql`
        UPDATE communication_senders
        SET
          provider_config = ${JSON.stringify(failedConfig)}::jsonb,
          provider_access_token = ${signatureResult.accessToken || stringValue(sender.provider_access_token)},
          provider_refresh_token = ${signatureResult.refreshToken || stringValue(sender.provider_refresh_token)},
          provider_token_expires_at = ${signatureResult.tokenExpiresAt || sender.provider_token_expires_at},
          updated_at = now()
        WHERE id = ${id}
      `;
      return NextResponse.json(
        { error: signatureResult.failureReason || "Could not sync Gmail signature" },
        { status: 400 }
      );
    }

    const providerConfig = {
      ...existingConfig,
      gmailSignature: signatureResult.signature || "",
      gmailSignatureEmail: signatureResult.signatureEmail || stringValue(sender.sender_value),
      gmailSignatureSyncedAt: new Date().toISOString(),
      gmailSignatureSyncError: "",
    };
    const updated = await overlaySql`
      UPDATE communication_senders
      SET
        provider_config = ${JSON.stringify(providerConfig)}::jsonb,
        provider_access_token = ${signatureResult.accessToken || stringValue(sender.provider_access_token)},
        provider_refresh_token = ${signatureResult.refreshToken || stringValue(sender.provider_refresh_token)},
        provider_token_expires_at = ${signatureResult.tokenExpiresAt || sender.provider_token_expires_at},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({
      sender: toSender(updated[0]),
      message: signatureResult.signature ? "Gmail signature synced." : "Gmail connected, but no signature was found.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync Gmail signature" },
      { status: 500 }
    );
  }
}
