import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { testCommunicationConnection } from "@/lib/communication-delivery";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type SenderInput = {
  channel?: "email" | "sms";
  label?: string;
  senderValue?: string;
  provider?: "stub" | "gmail" | "smsgate";
  providerConfig?: Record<string, string>;
  isDefault?: boolean;
  isActive?: boolean;
};

const VALID_CHANNELS = ["email", "sms"] as const;
const VALID_PROVIDERS = ["stub", "gmail", "smsgate"] as const;

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

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const { searchParams } = new URL(request.url);
    const channel = searchParams.get("channel");
    if (channel && !VALID_CHANNELS.includes(channel as typeof VALID_CHANNELS[number])) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    const rows = channel
      ? await overlaySql`
          SELECT *
          FROM communication_senders
          WHERE channel = ${channel}
          ORDER BY is_default DESC, is_active DESC, label ASC
        `
      : await overlaySql`
          SELECT *
          FROM communication_senders
          ORDER BY channel ASC, is_default DESC, is_active DESC, label ASC
        `;

    return NextResponse.json({ senders: rows.map(toSender) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load senders" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const input = (await request.json()) as SenderInput;
    const channel = input.channel;
    const label = input.label?.trim();
    const rawSenderValue = input.senderValue?.trim() || "";
    const provider = input.provider || "stub";

    if (!channel || !VALID_CHANNELS.includes(channel)) return NextResponse.json({ error: "Valid channel is required" }, { status: 400 });
    if (!label) return NextResponse.json({ error: "Sender label is required" }, { status: 400 });
    if (!VALID_PROVIDERS.includes(provider)) return NextResponse.json({ error: "Valid provider is required" }, { status: 400 });
    if (channel === "email" && provider === "smsgate") return NextResponse.json({ error: "Email senders cannot use SMSGate" }, { status: 400 });
    if (channel === "sms" && provider === "gmail") return NextResponse.json({ error: "SMS senders cannot use Gmail" }, { status: 400 });
    const senderValue = rawSenderValue || (provider === "smsgate" || provider === "gmail" ? label : "");
    if (!senderValue) return NextResponse.json({ error: "Sender value is required" }, { status: 400 });

    const providerConfig = input.providerConfig || {};
    if (provider === "smsgate" && !providerConfig.smsgateBaseUrl) {
      return NextResponse.json({ error: "SMSGate server address is required" }, { status: 400 });
    }
    if (provider === "smsgate" && (!providerConfig.smsgateUsername || !providerConfig.smsgatePassword)) {
      return NextResponse.json({ error: "SMSGate username and password are required" }, { status: 400 });
    }

    let connectionStatus = provider === "gmail" ? "disconnected" : "connected";
    let connectedAt: string | null = provider === "gmail" ? null : new Date().toISOString();
    let lastTestedAt: string | null = null;

    if (provider === "smsgate") {
      const testResult = await testCommunicationConnection({
        provider,
        providerConfig,
      });
      lastTestedAt = new Date().toISOString();
      if (!testResult.ok) {
        return NextResponse.json(
          { error: `Connection test failed: ${testResult.failureReason || "Unknown error"}` },
          { status: 400 }
        );
      }
      connectionStatus = "connected";
      connectedAt = lastTestedAt;
    }

    const rows = await overlaySql`
      INSERT INTO communication_senders (channel, label, sender_value, provider, provider_config, connection_status, connected_at, last_tested_at, is_default, is_active)
      VALUES (
        ${channel},
        ${label},
        ${senderValue},
        ${provider},
        ${JSON.stringify(providerConfig)}::jsonb,
        ${connectionStatus},
        ${connectedAt},
        ${lastTestedAt},
        false,
        ${input.isActive !== false}
      )
      RETURNING *
    `;

    return NextResponse.json({ sender: toSender(rows[0]) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create sender" },
      { status: 500 }
    );
  }
}
