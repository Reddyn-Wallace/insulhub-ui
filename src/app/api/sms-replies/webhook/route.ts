import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { overlaySql } from "@/lib/overlay-db";

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function POST(request: NextRequest) {
  const pollId = request.nextUrl.searchParams.get("poll")?.trim() || "";
  const token = request.nextUrl.searchParams.get("token") || "";
  if (!pollId || !token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionRows = await overlaySql`SELECT value FROM overlay_settings WHERE key = ${`sms_reply_poll:${pollId}`} LIMIT 1`;
  let session: Record<string, unknown>;
  try { session = JSON.parse(stringValue(sessionRows[0]?.value)); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  if (
    !safeEqualHex(tokenHash, stringValue(session.tokenHash))
    || stringValue(session.state) !== "waiting"
    || new Date(stringValue(session.expiresAt)).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !["sms:batch:received", "sms:received"].includes(stringValue(body.event))) {
    return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
  }
  const payload = body.payload && typeof body.payload === "object" ? body.payload as Record<string, unknown> : {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [payload];
  const fromTime = new Date(stringValue(session.from)).getTime();
  const toTime = new Date(stringValue(session.to)).getTime();
  const records: Array<{ key: string; value: string }> = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const message = item as Record<string, unknown>;
    const receivedAt = stringValue(message.receivedAt || message.createdAt);
    const receivedTime = new Date(receivedAt).getTime();
    const sender = stringValue(message.sender || message.phoneNumber);
    if (!sender || !Number.isFinite(receivedTime) || receivedTime < fromTime || receivedTime > toTime + 60_000) continue;
    const stored = {
      messageId: stringValue(message.messageId || message.id),
      sender,
      recipient: stringValue(message.recipient),
      message: stringValue(message.message || message.contentPreview),
      receivedAt,
    };
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex");
    records.push({ key: `sms_reply_poll_message:${pollId}:${fingerprint}`, value: JSON.stringify(stored) });
  }
  const now = new Date().toISOString();
  const claimed = await overlaySql`
    UPDATE overlay_settings
    SET value = jsonb_set(
          jsonb_set(
            jsonb_set(value::jsonb, '{lastWebhookAt}', to_jsonb(${now}::text), true),
            '{diagnostics,callbackCount}',
            to_jsonb(COALESCE((value::jsonb#>>'{diagnostics,callbackCount}')::int, 0) + 1),
            true
          ),
          '{diagnostics,acceptedMessageCount}',
          to_jsonb(COALESCE((value::jsonb#>>'{diagnostics,acceptedMessageCount}')::int, 0) + ${records.length}),
          true
        )::text,
        updated_at = now()
    WHERE key = ${`sms_reply_poll:${pollId}`}
      AND value::jsonb->>'state' = 'waiting'
      AND (value::jsonb->>'expiresAt')::timestamptz > now()
    RETURNING key
  `;
  if (!claimed.length) return NextResponse.json({ error: "Poll is no longer accepting messages" }, { status: 409 });
  const inserted = records.length ? await overlaySql`
    INSERT INTO overlay_settings (key, value, updated_at)
    SELECT item->>'key', item->>'value', now()
    FROM jsonb_array_elements(${JSON.stringify(records)}::jsonb) AS item
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  ` : [];
  return NextResponse.json({ ok: true, accepted: inserted.length });
}
