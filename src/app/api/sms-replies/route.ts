import { NextRequest, NextResponse } from "next/server";
import { readSmsgateInbox } from "@/lib/communication-delivery";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeNzPhone(value: string) {
  const compact = value.replace(/[^\d+]/g, "");
  if (compact.startsWith("+64")) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+64${digits.slice(1)}`;
  if (digits.startsWith("64")) return `+${digits}`;
  return compact;
}

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireInsulhubAuth(request);
  if (unauthorized) return unauthorized;

  await ensureOverlaySchema();
  const senderId = request.nextUrl.searchParams.get("senderId")?.trim() || "";
  const senderRows = senderId
    ? await overlaySql`
        SELECT id, label, provider_config
        FROM communication_senders
        WHERE id = ${senderId}
          AND channel = 'sms'
          AND provider = 'smsgate'
          AND is_active = true
        LIMIT 1
      `
    : await overlaySql`
        SELECT id, label, provider_config
        FROM communication_senders
        WHERE channel = 'sms'
          AND provider = 'smsgate'
          AND is_active = true
          AND connection_status = 'connected'
        ORDER BY is_default DESC, updated_at DESC
        LIMIT 1
      `;
  const sender = senderRows[0];
  if (!sender) {
    return NextResponse.json({ error: "No connected SMSGate sender is configured" }, { status: 404 });
  }

  const hours = boundedNumber(request.nextUrl.searchParams.get("hours"), 72, 1, 24 * 31);
  const limit = boundedNumber(request.nextUrl.searchParams.get("limit"), 100, 1, 500);
  const to = new Date();
  const from = new Date(to.getTime() - hours * 60 * 60_000);
  const providerConfig = sender.provider_config && typeof sender.provider_config === "object"
    ? sender.provider_config as Record<string, string>
    : {};
  const inbox = await readSmsgateInbox({
    providerConfig,
    from: from.toISOString(),
    to: to.toISOString(),
    limit,
  });
  if (!inbox.ok) {
    return NextResponse.json({
      error: inbox.failureReason || "Could not read SMSGate inbox",
      code: inbox.unsupportedInCloudMode ? "SMSGATE_CLOUD_EXPORT_REQUIRED" : "SMSGATE_INBOX_FAILED",
    }, { status: inbox.unsupportedInCloudMode ? 501 : 502 });
  }

  const phones = [...new Set(inbox.messages.map((message) => normalizeNzPhone(message.sender)).filter(Boolean))];
  const matchRows = phones.length
    ? await overlaySql`
        SELECT DISTINCT ON (cr.destination)
          cr.destination,
          cr.insulhub_job_id,
          cr.job_number,
          cr.contact_name,
          cr.address,
          cr.sent_at,
          c.id AS campaign_id,
          c.name AS campaign_name
        FROM campaign_recipients cr
        JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.channel = 'sms'
          AND cr.status = 'sent'
          AND cr.destination = ANY(${phones}::text[])
        ORDER BY cr.destination, cr.sent_at DESC NULLS LAST
      `
    : [];
  const matchByPhone = new Map(matchRows.map((row) => [normalizeNzPhone(stringValue(row.destination)), row]));

  const replies = inbox.messages
    .map((message) => {
      const normalizedSender = normalizeNzPhone(message.sender);
      const match = matchByPhone.get(normalizedSender);
      return {
        ...message,
        normalizedSender,
        match: match ? {
          jobId: stringValue(match.insulhub_job_id),
          jobNumber: Number(match.job_number) || null,
          contactName: stringValue(match.contact_name),
          address: stringValue(match.address),
          campaignId: stringValue(match.campaign_id),
          campaignName: stringValue(match.campaign_name),
          campaignSmsSentAt: match.sent_at,
        } : null,
      };
    })
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  return NextResponse.json({
    polledAt: to.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    sender: { id: stringValue(sender.id), label: stringValue(sender.label) },
    count: replies.length,
    matchedCount: replies.filter((reply) => reply.match).length,
    unmatchedCount: replies.filter((reply) => !reply.match).length,
    replies,
  });
}
