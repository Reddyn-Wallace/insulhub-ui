import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type CampaignInput = {
  name?: string;
  channel?: "email" | "sms";
  createdBy?: string | null;
};

const VALID_CHANNELS = ["email", "sms"] as const;

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0);
}

function toCampaign(row: Record<string, unknown>) {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    channel: stringValue(row.channel),
    status: stringValue(row.status),
    senderLabel: stringValue(row.sender_label),
    recipientCount: numberValue(row.recipient_count),
    pendingCount: numberValue(row.pending_count),
    sentCount: numberValue(row.sent_count),
    failedCount: numberValue(row.failed_count),
    skippedCount: numberValue(row.skipped_count),
    createdBy: stringValue(row.created_by),
    sentBy: stringValue(row.sent_by),
    sentAt: row.sent_at,
    archivedAt: row.archived_at,
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
    const archived = searchParams.get("archived") === "true";

    const rows = await overlaySql`
      SELECT
        c.*,
        COUNT(cr.id) FILTER (WHERE cr.selected = true AND cr.status = 'pending')::int AS pending_count,
        COUNT(cr.id) FILTER (WHERE cr.selected = true AND cr.status = 'sent')::int AS sent_count,
        COUNT(cr.id) FILTER (WHERE cr.selected = true AND cr.status = 'failed')::int AS failed_count,
        COUNT(cr.id) FILTER (WHERE cr.selected = true AND cr.status = 'skipped')::int AS skipped_count
      FROM campaigns c
      LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
      WHERE ${archived ? overlaySql`c.archived_at IS NOT NULL` : overlaySql`c.archived_at IS NULL`}
      GROUP BY c.id
      ORDER BY ${archived ? overlaySql`c.archived_at DESC NULLS LAST` : overlaySql`c.created_at DESC`}
    `;

    return NextResponse.json({ campaigns: rows.map(toCampaign) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load campaigns" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const input = (await request.json()) as CampaignInput;
    const name = input.name?.trim();
    const channel = input.channel;

    if (!name) return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    if (!channel || !VALID_CHANNELS.includes(channel)) {
      return NextResponse.json({ error: "Valid channel is required" }, { status: 400 });
    }

    const rows = await overlaySql`
      INSERT INTO campaigns (name, channel, created_by)
      VALUES (
        ${name},
        ${channel},
        ${input.createdBy?.trim() || ""}
      )
      RETURNING *
    `;

    return NextResponse.json({ campaign: toCampaign(rows[0]) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create campaign" },
      { status: 500 }
    );
  }
}
