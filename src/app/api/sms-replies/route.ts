import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteSmsgateWebhook,
  getSmsgateLogs,
  getSmsgateSettings,
  listSmsgateDevices,
  listSmsgateWebhooks,
  refreshSmsgateInbox,
  registerSmsgateWebhook,
} from "@/lib/communication-delivery";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";
import { matchSmsReply, normalizeNzPhone } from "@/lib/sms-reply-matching";

type PollSession = {
  pollId: string;
  tokenHash: string;
  senderId: string;
  senderLabel: string;
  webhookId: string;
  from: string;
  to: string;
  createdAt: string;
  expiresAt: string;
  refreshRequestedAt: string;
  lastWebhookAt: string;
  state: "starting" | "waiting" | "closed" | "failed";
  failureReason?: string;
  diagnostics: {
    configuredDeviceId: string;
    configuredDeviceFound: boolean;
    deviceLastSeen: string;
    webhookListedAfterRegistration: boolean;
    refreshStatus: number;
    callbackCount: number;
    acceptedMessageCount: number;
  };
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function pollKey(pollId: string) {
  return `sms_reply_poll:${pollId}`;
}

function messageKeyPrefix(pollId: string) {
  return `sms_reply_poll_message:${pollId}:`;
}

function parseSession(value: unknown): PollSession | null {
  try {
    const parsed = JSON.parse(stringValue(value));
    return parsed && typeof parsed === "object" ? parsed as PollSession : null;
  } catch {
    return null;
  }
}

async function loadSession(pollId: string) {
  const rows = await overlaySql`SELECT value FROM overlay_settings WHERE key = ${pollKey(pollId)} LIMIT 1`;
  return parseSession(rows[0]?.value);
}

async function saveSession(session: PollSession) {
  await overlaySql`
    INSERT INTO overlay_settings (key, value, updated_at)
    VALUES (${pollKey(session.pollId)}, ${JSON.stringify(session)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

async function loadSender(senderId = "") {
  const rows = senderId
    ? await overlaySql`
        SELECT id, label, provider_config
        FROM communication_senders
        WHERE id = ${senderId} AND channel = 'sms' AND provider = 'smsgate' AND is_active = true
        LIMIT 1
      `
    : await overlaySql`
        SELECT id, label, provider_config
        FROM communication_senders
        WHERE channel = 'sms' AND provider = 'smsgate' AND is_active = true AND connection_status = 'connected'
        ORDER BY is_default DESC, updated_at DESC
        LIMIT 1
      `;
  return rows[0] || null;
}

function providerConfig(sender: Record<string, unknown>) {
  return sender.provider_config && typeof sender.provider_config === "object"
    ? sender.provider_config as Record<string, string>
    : {};
}

function nestedBoolean(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "boolean" ? current : null;
}

function logSignals(value: unknown) {
  const logs = Array.isArray(value) ? value : [];
  const messages = logs.map((entry) => (
    entry && typeof entry === "object" ? stringValue((entry as Record<string, unknown>).message) : ""
  ));
  return {
    logCount: logs.length,
    permissionError: messages.some((message) => /permission|securityexception|read_sms|receive_sms/i.test(message)),
    inboxRefreshSeen: messages.some((message) => /inbox|refresh|export/i.test(message)),
    webhookError: messages.some((message) => /webhook/i.test(message) && /error|fail|reject|retry/i.test(message)),
  };
}

async function removeStaleInsulhubPollWebhooks(config: Record<string, string>, origin: string) {
  const listed = await listSmsgateWebhooks(config);
  if (!listed.ok || !Array.isArray(listed.value)) {
    return { ok: false, failureReason: listed.failureReason || "Could not inspect existing SMSGate webhooks" };
  }
  const prefix = `${origin}/api/sms-replies/webhook?poll=`;
  for (const webhook of listed.value) {
    if (!webhook.url?.startsWith(prefix) || !webhook.id) continue;
    const webhookPollId = new URL(webhook.url).searchParams.get("poll") || "";
    const session = webhookPollId ? await loadSession(webhookPollId) : null;
    const stale = !session
      || session.state === "closed"
      || session.state === "failed"
      || safeDate(session.expiresAt) <= Date.now();
    if (stale) {
      const removed = await deleteSmsgateWebhook(config, webhook.id);
      if (!removed.ok && removed.status !== 404) {
        return { ok: false, failureReason: removed.failureReason || "Could not remove an earlier temporary SMSGate webhook" };
      }
      if (webhookPollId) {
        await overlaySql`
          DELETE FROM overlay_settings
          WHERE key = ${pollKey(webhookPollId)} OR key LIKE ${`${messageKeyPrefix(webhookPollId)}%`}
        `;
      }
    }
  }
  return { ok: true };
}

async function closePoll(pollId: string) {
  const session = await loadSession(pollId);
  if (!session) return { ok: false, status: 404, error: "SMS reply poll was not found" };
  session.state = "closed";
  await saveSession(session);
  const sender = await loadSender(session.senderId);
  let removalError = "";
  if (sender && session.webhookId) {
    const removed = await deleteSmsgateWebhook(providerConfig(sender), session.webhookId);
    if (!removed.ok && removed.status !== 404) {
      removalError = removed.failureReason || "Could not remove temporary SMSGate webhook";
    }
  }
  await overlaySql`
    DELETE FROM overlay_settings
    WHERE key = ${pollKey(pollId)} OR key LIKE ${`${messageKeyPrefix(pollId)}%`}
  `;
  if (removalError) return { ok: false, status: 502, error: removalError };
  return { ok: true, status: 200, session };
}

function safeDate(value: unknown) {
  const time = new Date(stringValue(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireInsulhubAuth(request);
  if (unauthorized) return unauthorized;
  await ensureOverlaySchema();

  const input = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (input.action === "close") {
    const result = await closePoll(stringValue(input.pollId));
    return NextResponse.json(result.ok ? { ok: true } : { error: result.error }, { status: result.status });
  }

  const sender = await loadSender(stringValue(input.senderId));
  if (!sender) return NextResponse.json({ error: "No connected SMSGate sender is configured" }, { status: 404 });
  const config = providerConfig(sender);
  if (input.action === "diagnose") {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 60_000);
    const [devices, settings, logs] = await Promise.all([
      listSmsgateDevices(config),
      getSmsgateSettings(config),
      getSmsgateLogs({ providerConfig: config, from: from.toISOString(), to: to.toISOString() }),
    ]);
    const configuredDeviceId = stringValue(config.smsgateDeviceId);
    const selectedDevice = devices.ok && Array.isArray(devices.value)
      ? (configuredDeviceId ? devices.value.find((device) => device.id === configuredDeviceId) : devices.value[0])
      : undefined;
    return NextResponse.json({
      deviceFound: Boolean(selectedDevice),
      deviceLastSeen: stringValue(selectedDevice?.lastSeen),
      receiverContentProviderEnabled: settings.ok
        ? nestedBoolean(settings.value, ["receiver", "content_provider_enabled"])
        : null,
      settingsStatus: settings.status,
      logsStatus: logs.status,
      ...logSignals(logs.value),
    });
  }
  const hours = boundedNumber(input.hours, 72, 1, 24 * 31);
  const to = new Date();
  const from = new Date(to.getTime() - hours * 60 * 60_000);
  const pollId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const session: PollSession = {
    pollId,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    senderId: stringValue(sender.id),
    senderLabel: stringValue(sender.label),
    webhookId: "",
    from: from.toISOString(),
    to: to.toISOString(),
    createdAt: to.toISOString(),
    expiresAt: new Date(to.getTime() + 10 * 60_000).toISOString(),
    refreshRequestedAt: "",
    lastWebhookAt: "",
    state: "starting",
    diagnostics: {
      configuredDeviceId: stringValue(config.smsgateDeviceId),
      configuredDeviceFound: false,
      deviceLastSeen: "",
      webhookListedAfterRegistration: false,
      refreshStatus: 0,
      callbackCount: 0,
      acceptedMessageCount: 0,
    },
  };

  const devices = await listSmsgateDevices(config);
  if (devices.ok && Array.isArray(devices.value)) {
    const configuredDeviceId = session.diagnostics.configuredDeviceId;
    const selectedDevice = configuredDeviceId
      ? devices.value.find((device) => device.id === configuredDeviceId)
      : devices.value[0];
    session.diagnostics.configuredDeviceFound = Boolean(selectedDevice);
    session.diagnostics.deviceLastSeen = stringValue(selectedDevice?.lastSeen);
  }
  await saveSession(session);

  const origin = new URL(process.env.INSULHUB_PUBLIC_URL?.trim() || "https://insulhub-ui.vercel.app").origin;
  const cleanup = await removeStaleInsulhubPollWebhooks(config, origin);
  if (!cleanup.ok) {
    session.state = "failed";
    session.failureReason = cleanup.failureReason;
    await saveSession(session);
    return NextResponse.json({ error: cleanup.failureReason }, { status: 502 });
  }
  const callback = `${origin}/api/sms-replies/webhook?poll=${encodeURIComponent(pollId)}&token=${encodeURIComponent(token)}`;
  const registered = await registerSmsgateWebhook({ providerConfig: config, url: callback, event: "sms:batch:received" });
  const webhookId = stringValue(registered.value?.id);
  if (!registered.ok || !webhookId) {
    session.state = "failed";
    session.failureReason = registered.failureReason || "SMSGate did not return a webhook ID";
    await saveSession(session);
    return NextResponse.json({ error: session.failureReason }, { status: 502 });
  }
  session.webhookId = webhookId;
  // Cloud registrations are asynchronous and must reach the Android device
  // before an inbox refresh can emit its export callbacks.
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  const registeredWebhooks = await listSmsgateWebhooks(config);
  session.diagnostics.webhookListedAfterRegistration = Boolean(
    registeredWebhooks.ok
    && Array.isArray(registeredWebhooks.value)
    && registeredWebhooks.value.some((webhook) => webhook.id === webhookId)
  );
  session.state = "waiting";
  session.refreshRequestedAt = new Date().toISOString();
  await saveSession(session);

  const refreshed = await refreshSmsgateInbox({ providerConfig: config, from: session.from, to: session.to });
  session.diagnostics.refreshStatus = refreshed.status;
  await saveSession(session);
  if (!refreshed.ok) {
    await deleteSmsgateWebhook(config, webhookId);
    session.state = "failed";
    session.failureReason = refreshed.failureReason || "SMSGate inbox refresh failed";
    await saveSession(session);
    return NextResponse.json({ error: session.failureReason }, { status: 502 });
  }

  return NextResponse.json({ pollId, state: session.state, from: session.from, to: session.to, expiresAt: session.expiresAt }, { status: 202 });
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireInsulhubAuth(request);
  if (unauthorized) return unauthorized;
  await ensureOverlaySchema();

  const pollId = request.nextUrl.searchParams.get("pollId")?.trim() || "";
  const session = await loadSession(pollId);
  if (!session) return NextResponse.json({ error: "SMS reply poll was not found" }, { status: 404 });
  const rows = await overlaySql`
    SELECT value FROM overlay_settings
    WHERE key LIKE ${`${messageKeyPrefix(pollId)}%`}
    ORDER BY updated_at ASC
  `;
  const messages = rows.map((row) => {
    try { return JSON.parse(stringValue(row.value)) as Record<string, unknown>; } catch { return null; }
  }).filter((row): row is Record<string, unknown> => Boolean(row));
  const phones = [...new Set(messages.map((message) => normalizeNzPhone(stringValue(message.sender))).filter(Boolean))];
  const digits = phones.map((phone) => phone.replace(/\D/g, ""));
  const candidates = digits.length ? await overlaySql`
    SELECT cr.destination, cr.insulhub_job_id, cr.job_number, cr.contact_name, cr.address, cr.sent_at,
      c.id AS campaign_id, c.name AS campaign_name
    FROM campaign_recipients cr
    JOIN campaigns c ON c.id = cr.campaign_id
    WHERE c.channel = 'sms'
      AND c.sender_id = ${session.senderId}
      AND cr.status = 'sent'
      AND (
        CASE
          WHEN regexp_replace(cr.destination, '[^0-9]', '', 'g') LIKE '0%'
            THEN '64' || substring(regexp_replace(cr.destination, '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(cr.destination, '[^0-9]', '', 'g')
        END
      ) = ANY(${digits}::text[])
    ORDER BY cr.sent_at DESC NULLS LAST
  ` : [];

  const replies = messages.map((message) => {
    const result = matchSmsReply(stringValue(message.sender), stringValue(message.receivedAt), candidates);
    const formatMatch = (candidate: Record<string, unknown>) => ({
      jobId: stringValue(candidate.insulhub_job_id),
      jobNumber: Number(candidate.job_number) || null,
      contactName: stringValue(candidate.contact_name),
      address: stringValue(candidate.address),
      campaignId: stringValue(candidate.campaign_id),
      campaignName: stringValue(candidate.campaign_name),
      campaignSmsSentAt: candidate.sent_at,
    });
    return {
      id: stringValue(message.messageId || message.id),
      sender: stringValue(message.sender),
      normalizedSender: result.normalizedSender,
      recipient: stringValue(message.recipient),
      message: stringValue(message.message),
      receivedAt: stringValue(message.receivedAt),
      match: result.match ? formatMatch(result.match) : null,
      ambiguous: result.ambiguous,
      candidates: result.candidates.map(formatMatch),
    };
  }).sort((a, b) => safeDate(b.receivedAt) - safeDate(a.receivedAt));

  const now = Date.now();
  const exportAgeMs = now - safeDate(session.refreshRequestedAt || session.createdAt);
  return NextResponse.json({
    pollId,
    state: session.state,
    settled: session.state !== "waiting" || exportAgeMs >= 60_000,
    from: session.from,
    to: session.to,
    count: replies.length,
    matchedCount: replies.filter((reply) => reply.match).length,
    ambiguousCount: replies.filter((reply) => reply.ambiguous).length,
    unmatchedCount: replies.filter((reply) => !reply.match && !reply.ambiguous).length,
    diagnostics: {
      configuredDeviceFound: session.diagnostics?.configuredDeviceFound || false,
      deviceLastSeen: session.diagnostics?.deviceLastSeen || "",
      webhookListedAfterRegistration: session.diagnostics?.webhookListedAfterRegistration || false,
      refreshStatus: session.diagnostics?.refreshStatus || 0,
      callbackCount: session.diagnostics?.callbackCount || 0,
      acceptedMessageCount: session.diagnostics?.acceptedMessageCount || 0,
      callbackReceived: Boolean(session.lastWebhookAt),
    },
    replies,
  });
}
