import {
  communicationSendWindowError,
  loadCommunicationSettings,
  nextAllowedSendAt,
} from "@/lib/communication-settings";
import { deliverCommunication } from "@/lib/communication-delivery";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type SenderRow = {
  id: string;
  channel: "email" | "sms";
  label: string;
  sender_value: string;
  provider: "stub" | "gmail" | "smsgate";
  provider_config?: Record<string, string>;
  provider_access_token?: string;
  provider_refresh_token?: string;
  provider_token_expires_at?: string | null;
  connection_status?: string;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0);
}

export function toQueuedCampaign(row: Record<string, unknown>) {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    channel: stringValue(row.channel),
    status: stringValue(row.status),
    senderLabel: stringValue(row.sender_label),
    senderId: stringValue(row.sender_id),
    templateId: stringValue(row.template_id),
    messageSubject: stringValue(row.message_subject),
    messageBody: stringValue(row.message_body),
    testSentAt: row.test_sent_at,
    recipientCount: numberValue(row.recipient_count),
    createdBy: stringValue(row.created_by),
    sentBy: stringValue(row.sent_by),
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toQueuedRecipient(row: Record<string, unknown>) {
  return {
    id: stringValue(row.id),
    campaignId: stringValue(row.campaign_id),
    jobId: stringValue(row.insulhub_job_id),
    jobNumber: numberValue(row.job_number),
    contactName: stringValue(row.contact_name),
    destination: stringValue(row.destination),
    selected: Boolean(row.selected),
    status: stringValue(row.status),
    renderedSubject: stringValue(row.rendered_subject),
    renderedBody: stringValue(row.rendered_body),
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    providerMessageId: stringValue(row.provider_message_id),
    failureReason: stringValue(row.failure_reason),
  };
}

export async function loadQueuedCampaign(id: string) {
  const rows = await overlaySql`
    SELECT *
    FROM campaigns
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function loadSender(id: string) {
  const rows = await overlaySql`
    SELECT *
    FROM communication_senders
    WHERE id = ${id}
      AND is_active = true
    LIMIT 1
  `;
  return rows[0] || null;
}

async function todayEmailSentCount(senderId: string) {
  const rows = await overlaySql`
    SELECT COUNT(*)::int AS count
    FROM campaign_recipients cr
    JOIN campaigns c ON c.id = cr.campaign_id
    WHERE c.channel = 'email'
      AND c.sender_id = ${senderId}
      AND cr.status = 'sent'
      AND cr.sent_at >= (date_trunc('day', now() AT TIME ZONE 'Pacific/Auckland') AT TIME ZONE 'Pacific/Auckland')
  `;
  return Number(rows[0]?.count || 0);
}

export async function loadQueuedRecipients(id: string) {
  return overlaySql`
    SELECT *
    FROM campaign_recipients
    WHERE campaign_id = ${id}
    ORDER BY contact_name ASC, job_number ASC
  `;
}

async function finalizeCampaignIfDone(id: string) {
  const countRows = await overlaySql`
    SELECT
      COUNT(*) FILTER (WHERE selected = true AND status = 'pending')::int AS pending_count,
      COUNT(*) FILTER (WHERE selected = true AND status = 'sent')::int AS sent_count,
      COUNT(*) FILTER (WHERE selected = true AND status = 'failed')::int AS failed_count,
      COUNT(*) FILTER (WHERE selected = true AND status = 'skipped')::int AS skipped_count
    FROM campaign_recipients
    WHERE campaign_id = ${id}
  `;
  const pendingCount = Number(countRows[0]?.pending_count || 0);
  const sentCount = Number(countRows[0]?.sent_count || 0);
  const failedCount = Number(countRows[0]?.failed_count || 0);
  const skippedCount = Number(countRows[0]?.skipped_count || 0);

  if (pendingCount > 0) {
    const rows = await overlaySql`
      UPDATE campaigns
      SET status = 'sending', updated_at = now()
      WHERE id = ${id} AND status IN ('pending', 'sending')
      RETURNING *
    `;
    return { campaign: rows[0], pendingCount, sentCount, failedCount, skippedCount };
  }

  const finalStatus = sentCount > 0 || skippedCount > 0 ? "sent" : "failed";
  const rows = await overlaySql`
    UPDATE campaigns
    SET status = ${finalStatus}, sent_at = COALESCE(sent_at, now()), updated_at = now()
    WHERE id = ${id} AND status IN ('pending', 'sending')
    RETURNING *
  `;
  return { campaign: rows[0], pendingCount, sentCount, failedCount, skippedCount };
}

export async function processCampaignQueue(id: string) {
  await ensureOverlaySchema();
  const campaign = await loadQueuedCampaign(id);
  if (!campaign) throw new Error("Campaign not found");

  const status = stringValue(campaign.status);
  if (status === "halted" || status === "sent" || status === "failed") {
    return {
      campaign,
      processResult: "No queued delivery remains.",
      processedCount: 0,
      done: true,
    };
  }
  if (status !== "pending" && status !== "sending") {
    throw new Error("Campaign is not queued for delivery");
  }

  const sender = await loadSender(stringValue(campaign.sender_id)) as SenderRow | null;
  if (!sender) throw new Error("Active sender record could not be found");

  const settings = await loadCommunicationSettings();
  if (sender.provider !== "stub") {
    const windowError = communicationSendWindowError(settings);
    if (windowError) {
      await overlaySql`
        UPDATE campaign_recipients
        SET scheduled_at = ${nextAllowedSendAt(settings).toISOString()}, updated_at = now()
        WHERE campaign_id = ${id}
          AND selected = true
          AND status = 'pending'
          AND scheduled_at <= now()
      `;
      return {
        campaign,
        processResult: windowError,
        processedCount: 0,
        done: false,
      };
    }
  }

  let batchLimit = 5;
  if (stringValue(campaign.channel) === "email") {
    const sentToday = await todayEmailSentCount(stringValue(sender.id));
    batchLimit = Math.max(0, Math.min(batchLimit, settings.campaignEmailDailyLimit - sentToday));
    if (batchLimit === 0) {
      return {
        campaign,
        processResult: "Email daily limit reached. Remaining recipients stay pending.",
        processedCount: 0,
        done: false,
      };
    }
  }

  const dueRows = await overlaySql`
    SELECT *
    FROM campaign_recipients
    WHERE campaign_id = ${id}
      AND selected = true
      AND status = 'pending'
      AND COALESCE(scheduled_at, now()) <= now()
    ORDER BY scheduled_at ASC NULLS FIRST, contact_name ASC, job_number ASC
    LIMIT ${batchLimit}
  `;

  if (dueRows.length === 0) {
    return {
      campaign,
      processResult: "No recipients are due yet.",
      processedCount: 0,
      done: false,
    };
  }

  await overlaySql`
    UPDATE campaigns
    SET status = 'sending', updated_at = now()
    WHERE id = ${id} AND status = 'pending'
  `;

  let processedCount = 0;
  for (const row of dueRows) {
    const result = await deliverCommunication({
      channel: stringValue(campaign.channel) === "sms" ? "sms" : "email",
      provider: sender.provider,
      from: stringValue(sender.sender_value),
      fromName: stringValue(sender.label),
      to: stringValue(row.destination),
      subject: stringValue(row.rendered_subject),
      body: stringValue(row.rendered_body),
      providerConfig: sender.provider_config || {},
      accessToken: stringValue(sender.provider_access_token),
      refreshToken: stringValue(sender.provider_refresh_token),
      tokenExpiresAt: sender.provider_token_expires_at || null,
    });

    if (result.accessToken) {
      await overlaySql`
        UPDATE communication_senders
        SET
          provider_access_token = ${result.accessToken},
          provider_refresh_token = ${result.refreshToken || stringValue(sender.provider_refresh_token)},
          provider_token_expires_at = ${result.tokenExpiresAt || sender.provider_token_expires_at || null},
          connection_status = 'connected',
          updated_at = now()
        WHERE id = ${sender.id}
      `;
      sender.provider_access_token = result.accessToken;
      sender.provider_refresh_token = result.refreshToken || sender.provider_refresh_token;
      sender.provider_token_expires_at = result.tokenExpiresAt || sender.provider_token_expires_at;
    }

    await overlaySql`
      UPDATE campaign_recipients
      SET
        status = ${result.ok ? "sent" : "failed"},
        provider_message_id = ${result.providerMessageId || ""},
        sent_at = ${result.ok ? new Date().toISOString() : null},
        failure_reason = ${result.failureReason || ""},
        updated_at = now()
      WHERE id = ${stringValue(row.id)}
    `;
    processedCount += 1;
  }

  const finalized = await finalizeCampaignIfDone(id);
  return {
    campaign: finalized.campaign || campaign,
    processResult: processedCount
      ? `Processed ${processedCount} queued recipient${processedCount === 1 ? "" : "s"}.`
      : "No recipients are due yet.",
    processedCount,
    done: finalized.pendingCount === 0,
    counts: {
      pending: finalized.pendingCount,
      sent: finalized.sentCount,
      failed: finalized.failedCount,
      skipped: finalized.skippedCount,
    },
  };
}

export async function loadDueCampaignIds(limit = 10) {
  await ensureOverlaySchema();
  const rows = await overlaySql`
    SELECT DISTINCT c.id
    FROM campaigns c
    JOIN campaign_recipients cr ON cr.campaign_id = c.id
    WHERE c.status IN ('pending', 'sending')
      AND cr.selected = true
      AND cr.status = 'pending'
      AND COALESCE(cr.scheduled_at, now()) <= now()
    ORDER BY c.id
    LIMIT ${limit}
  `;
  return rows.map((row) => stringValue(row.id)).filter(Boolean);
}

export async function loadCampaignQueueState() {
  await ensureOverlaySchema();
  const rows = await overlaySql`
    SELECT
      COUNT(*)::int AS pending_count,
      MIN(COALESCE(cr.scheduled_at, now())) AS next_run_at
    FROM campaigns c
    JOIN campaign_recipients cr ON cr.campaign_id = c.id
    WHERE c.status IN ('pending', 'sending')
      AND cr.selected = true
      AND cr.status = 'pending'
  `;

  const nextRunAt = rows[0]?.next_run_at;
  return {
    pendingCount: Number(rows[0]?.pending_count || 0),
    nextRunAt: nextRunAt ? new Date(String(nextRunAt)).toISOString() : null,
  };
}
