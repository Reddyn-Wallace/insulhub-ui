import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { testCommunicationConnection } from "@/lib/communication-delivery";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type SenderInput = {
  label?: string;
  senderValue?: string;
  providerConfig?: Record<string, string>;
  isDefault?: boolean;
  isActive?: boolean;
  test?: boolean;
  disconnect?: boolean;
};

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

async function loadSender(id: string) {
  const rows = await overlaySql`
    SELECT *
    FROM communication_senders
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { id } = await params;
    const existing = await loadSender(id);
    if (!existing) return NextResponse.json({ error: "Sender not found" }, { status: 404 });

    const input = (await request.json()) as SenderInput;
    const channel = stringValue(existing.channel);
    const existingConfig = existing.provider_config && typeof existing.provider_config === "object"
      ? existing.provider_config as Record<string, string>
      : {};
    const nextProviderConfig = input.providerConfig
      ? { ...existingConfig, ...input.providerConfig }
      : existingConfig;
    const nextConfig = JSON.stringify(nextProviderConfig);
    const provider = stringValue(existing.provider) as "stub" | "gmail" | "smsgate";
    const providerConfig = nextProviderConfig;

    if (input.disconnect) {
      const rows = await overlaySql`
        UPDATE communication_senders
        SET
          provider_access_token = '',
          provider_refresh_token = '',
          provider_token_expires_at = NULL,
          connection_status = 'disconnected',
          connected_at = NULL,
          last_tested_at = NULL,
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;

      return NextResponse.json({
        sender: toSender(rows[0]),
        testResult: "Sender disconnected.",
      });
    }

    if (input.isDefault) {
      await overlaySql`
        UPDATE communication_senders
        SET is_default = false, updated_at = now()
        WHERE channel = ${channel} AND id <> ${id}
      `;
    }

    let testResult: Awaited<ReturnType<typeof testCommunicationConnection>> | null = null;
    if (input.test) {
      testResult = await testCommunicationConnection({
        provider,
        providerConfig,
        accessToken: stringValue(existing.provider_access_token),
        refreshToken: stringValue(existing.provider_refresh_token),
        tokenExpiresAt: existing.provider_token_expires_at as string | null,
      });
    }

    const rows = await overlaySql`
      UPDATE communication_senders
      SET
        label = ${input.label?.trim() || stringValue(existing.label)},
        sender_value = ${input.senderValue?.trim() || stringValue(existing.sender_value)},
        provider_config = ${nextConfig}::jsonb,
        provider_access_token = ${testResult?.accessToken || stringValue(existing.provider_access_token)},
        provider_refresh_token = ${testResult?.refreshToken || stringValue(existing.provider_refresh_token)},
        provider_token_expires_at = ${testResult?.tokenExpiresAt || existing.provider_token_expires_at},
        connection_status = ${input.test ? testResult?.ok ? "connected" : "disconnected" : stringValue(existing.connection_status) || "disconnected"},
        is_default = ${input.isDefault ?? Boolean(existing.is_default)},
        is_active = ${input.isActive ?? Boolean(existing.is_active)},
        last_tested_at = ${input.test ? new Date().toISOString() : existing.last_tested_at},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({
      sender: toSender(rows[0]),
      testResult: input.test
        ? testResult?.ok
          ? "Connection test passed."
          : `Connection test failed: ${testResult?.failureReason || "Unknown error"}`
        : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update sender" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { id } = await params;

    await overlaySql`
      DELETE FROM communication_senders
      WHERE id = ${id}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete sender" },
      { status: 500 }
    );
  }
}
