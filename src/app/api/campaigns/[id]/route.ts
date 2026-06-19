import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import {
  campaignRecipientScheduleAt,
  loadCommunicationSettings,
} from "@/lib/communication-settings";
import { loadQueuedRecipients, processCampaignQueue } from "@/lib/campaign-queue";
import { deliverCommunication } from "@/lib/communication-delivery";
import { firstNameForMerge, formatNameForMerge } from "@/lib/communication-merge-fields";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type RecipientInput = {
  jobId?: string;
  jobNumber?: number | string | null;
  contactName?: string | null;
  destination?: string | null;
  address?: string | null;
  salespersonName?: string | null;
  jobStage?: string | null;
  quoteDate?: string | null;
};

type AudienceInput = {
  recipients?: RecipientInput[];
  mode?: "replace" | "add";
  senderId?: string | null;
  senderLabel?: string | null;
  templateId?: string | null;
  messageSubject?: string | null;
  messageBody?: string | null;
  test?: boolean;
  testDestination?: string | null;
  testRecipientId?: string | null;
  sendCampaign?: boolean;
  sendStub?: boolean;
  haltCampaign?: boolean;
  archiveCampaign?: boolean;
  unarchiveCampaign?: boolean;
};

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

type DeleteInput = {
  recipientIds?: string[];
};

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
    senderId: stringValue(row.sender_id),
    templateId: stringValue(row.template_id),
    messageSubject: stringValue(row.message_subject),
    messageBody: stringValue(row.message_body),
    testSentAt: row.test_sent_at,
    recipientCount: numberValue(row.recipient_count),
    createdBy: stringValue(row.created_by),
    sentBy: stringValue(row.sent_by),
    sentAt: row.sent_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecipient(row: Record<string, unknown>) {
  return {
    id: stringValue(row.id),
    campaignId: stringValue(row.campaign_id),
    jobId: stringValue(row.insulhub_job_id),
    jobNumber: numberValue(row.job_number),
    contactName: stringValue(row.contact_name),
    destination: stringValue(row.destination),
    address: stringValue(row.address),
    salespersonName: stringValue(row.salesperson_name),
    jobStage: stringValue(row.job_stage),
    quoteDate: row.quote_date,
    selected: Boolean(row.selected),
    status: stringValue(row.status),
    renderedSubject: stringValue(row.rendered_subject),
    renderedBody: stringValue(row.rendered_body),
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    providerMessageId: stringValue(row.provider_message_id),
    failureReason: stringValue(row.failure_reason),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadCampaign(id: string) {
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

function formatNzDate(value: unknown) {
  if (typeof value !== "string" && !(value instanceof Date)) return "No quote date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No quote date";
  return date.toLocaleDateString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function renderMergeFields(text: string, row: Record<string, unknown>) {
  const contactName = formatNameForMerge(stringValue(row.contact_name));
  const salespersonName = stringValue(row.salesperson_name);
  const values: Record<string, string> = {
    "customer name": contactName,
    "first name": firstNameForMerge(contactName),
    "job number": String(row.job_number || ""),
    address: stringValue(row.address),
    salesperson: salespersonName,
    "salesperson name": salespersonName,
    "sales rep": salespersonName,
    "sales rep name": salespersonName,
    "sales consultant": salespersonName,
    "sales consultant name": salespersonName,
    "salesperson first name": firstNameForMerge(salespersonName),
    "salesperson first": firstNameForMerge(salespersonName),
    "sales rep first name": firstNameForMerge(salespersonName),
    "sales consultant first name": firstNameForMerge(salespersonName),
    "quote date": formatNzDate(row.quote_date),
  };
  return text.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = values[key.trim().toLowerCase()];
    return value === undefined ? match : value;
  });
}

function normalizedDestination(destination: string, channel: string) {
  const value = destination.trim().toLowerCase();
  if (channel === "email") return value;
  return value.replace(/[\s().-]/g, "");
}

function normalizeNzSmsDestination(destination: string) {
  const compact = destination.replace(/[^\d+]/g, "");
  if (compact.startsWith("+64")) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+64${digits.slice(1)}`;
  if (digits.startsWith("64")) return `+${digits}`;
  return compact;
}

function normalizeTestDestination(destination: string, channel: string) {
  return channel === "sms" ? normalizeNzSmsDestination(destination) : destination.trim();
}

function campaignIsLocked(campaign: Record<string, unknown>) {
  const status = stringValue(campaign.status);
  return status === "pending" || status === "sending" || status === "sent" || status === "failed" || status === "halted";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { id } = await params;
    const campaign = await loadCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const recipientRows = await overlaySql`
      SELECT *
      FROM campaign_recipients
      WHERE campaign_id = ${id}
      ORDER BY contact_name ASC, job_number ASC
    `;

    return NextResponse.json({
      campaign: toCampaign(campaign),
      recipients: recipientRows.map(toRecipient),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load campaign" },
      { status: 500 }
    );
  }
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
    const campaign = await loadCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const input = (await request.json()) as AudienceInput;
    if (input.archiveCampaign || input.unarchiveCampaign) {
      const status = stringValue(campaign.status);
      if (input.archiveCampaign && status === "draft") {
        return NextResponse.json({ error: "Draft campaigns can be deleted instead of archived" }, { status: 400 });
      }

      const campaignRows = await overlaySql`
        UPDATE campaigns
        SET archived_at = ${input.archiveCampaign ? new Date().toISOString() : null}, updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      const recipientRows = await overlaySql`
        SELECT *
        FROM campaign_recipients
        WHERE campaign_id = ${id}
        ORDER BY contact_name ASC, job_number ASC
      `;

      return NextResponse.json({
        campaign: toCampaign(campaignRows[0]),
        recipients: recipientRows.map(toRecipient),
      });
    }

    if (input.haltCampaign) {
      const status = stringValue(campaign.status);
      if (status !== "pending" && status !== "sending") {
        return NextResponse.json({ error: "Only pending or sending campaigns can be halted" }, { status: 400 });
      }

      await overlaySql`
        UPDATE campaign_recipients
        SET
          status = 'skipped',
          failure_reason = 'Campaign halted before delivery.',
          updated_at = now()
        WHERE campaign_id = ${id}
          AND selected = true
          AND status = 'pending'
      `;

      const campaignRows = await overlaySql`
        UPDATE campaigns
        SET status = 'halted', updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;

      const recipientRows = await overlaySql`
        SELECT *
        FROM campaign_recipients
        WHERE campaign_id = ${id}
        ORDER BY contact_name ASC, job_number ASC
      `;

      return NextResponse.json({
        campaign: toCampaign(campaignRows[0]),
        recipients: recipientRows.map(toRecipient),
        sendResult: "Campaign halted. Pending recipients were skipped.",
      });
    }

    if (input.sendCampaign || input.sendStub) {
      if (campaignIsLocked(campaign)) {
        return NextResponse.json({ error: "Campaign has already been sent" }, { status: 400 });
      }

      const channel = stringValue(campaign.channel);
      const senderLabel = stringValue(campaign.sender_label);
      const senderId = stringValue(campaign.sender_id);
      const subject = stringValue(campaign.message_subject);
      const body = stringValue(campaign.message_body);

      if (!senderLabel) return NextResponse.json({ error: "Sender is required before sending" }, { status: 400 });
      if (!senderId) return NextResponse.json({ error: "Sender record is required before sending" }, { status: 400 });
      if (channel === "email" && !subject.trim()) return NextResponse.json({ error: "Email subject is required before sending" }, { status: 400 });
      if (!body.trim()) return NextResponse.json({ error: "Message body is required before sending" }, { status: 400 });

      const sender = await loadSender(senderId) as SenderRow | null;
      if (!sender) return NextResponse.json({ error: "Active sender record could not be found" }, { status: 400 });
      if (sender.channel !== channel) return NextResponse.json({ error: "Sender channel does not match campaign channel" }, { status: 400 });
      if (sender.provider !== "stub" && stringValue(sender.connection_status) !== "connected") {
        return NextResponse.json({ error: "Test and connect the selected sender before sending this campaign" }, { status: 400 });
      }
      const communicationSettings = await loadCommunicationSettings();

      const recipientRows = await overlaySql`
        SELECT *
        FROM campaign_recipients
        WHERE campaign_id = ${id} AND selected = true
        ORDER BY contact_name ASC, job_number ASC
      `;
      if (recipientRows.length === 0) return NextResponse.json({ error: "At least one recipient is required before sending" }, { status: 400 });

      const counts = new Map<string, number>();
      for (const row of recipientRows) {
        const key = normalizedDestination(stringValue(row.destination), channel);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const hasDuplicates = [...counts.values()].some((count) => count > 1);
      if (hasDuplicates) return NextResponse.json({ error: "Duplicate recipients must be resolved before sending" }, { status: 400 });

      const snapshots = [];
      for (const [index, row] of recipientRows.entries()) {
        const renderedSubject = renderMergeFields(subject, row);
        const renderedBody = renderMergeFields(body, row);
        snapshots.push({
          id: stringValue(row.id),
          status: "pending",
          rendered_subject: renderedSubject,
          rendered_body: renderedBody,
          scheduled_at: campaignRecipientScheduleAt(communicationSettings, channel === "sms" ? "sms" : "email", index).toISOString(),
        });
      }

      await overlaySql`
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb) AS x(
            id uuid,
            status text,
            rendered_subject text,
            rendered_body text,
            scheduled_at timestamptz
          )
        )
        UPDATE campaign_recipients cr
        SET
          status = incoming.status,
          rendered_subject = incoming.rendered_subject,
          rendered_body = incoming.rendered_body,
          provider_message_id = '',
          scheduled_at = incoming.scheduled_at,
          sent_at = NULL,
          failure_reason = '',
          updated_at = now()
        FROM incoming
        WHERE cr.campaign_id = ${id} AND cr.id = incoming.id
      `;

      const campaignRows = await overlaySql`
        UPDATE campaigns
        SET status = 'pending', sent_at = NULL, updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;

      const processResult = await processCampaignQueue(id);
      const updatedRecipients = await loadQueuedRecipients(id);
      const remainingQueued = snapshots.length - processResult.processedCount;

      return NextResponse.json({
        campaign: toCampaign(processResult.campaign || campaignRows[0]),
        recipients: updatedRecipients.map(toRecipient),
        sendResult: processResult.processedCount
          ? remainingQueued > 0
            ? `${processResult.processResult} ${remainingQueued} recipient${remainingQueued === 1 ? "" : "s"} remain queued.`
            : processResult.processResult
          : `${snapshots.length} recipient${snapshots.length === 1 ? "" : "s"} queued for delivery.`,
      });
    }

    if (campaignIsLocked(campaign)) {
      return NextResponse.json({ error: "Sent campaigns cannot be edited" }, { status: 400 });
    }

    if (input.senderId !== undefined || input.senderLabel !== undefined) {
      const senderId = input.senderId?.trim() || null;
      const senderLabel = input.senderLabel?.trim() || "";
      const campaignRows = await overlaySql`
        UPDATE campaigns
        SET sender_id = ${senderId}, sender_label = ${senderLabel}, updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      const recipientRows = await overlaySql`
        SELECT *
        FROM campaign_recipients
        WHERE campaign_id = ${id}
        ORDER BY contact_name ASC, job_number ASC
      `;
      return NextResponse.json({
        campaign: toCampaign(campaignRows[0]),
        recipients: recipientRows.map(toRecipient),
      });
    }

    if (
      input.templateId !== undefined ||
      input.messageSubject !== undefined ||
      input.messageBody !== undefined ||
      input.test !== undefined
    ) {
      const current = campaign;
      const templateId = input.templateId === undefined ? current.template_id : input.templateId?.trim() || null;
      const subject = input.messageSubject === undefined ? stringValue(current.message_subject) : input.messageSubject?.trim() || "";
      const body = input.messageBody === undefined ? stringValue(current.message_body) : input.messageBody?.trim() || "";
      let testResultMessage: string | undefined;

      if (input.test) {
        const channel = stringValue(current.channel);
        const senderId = stringValue(current.sender_id);
        const testDestination = normalizeTestDestination(input.testDestination?.trim() || "", channel);
        if (!testDestination) return NextResponse.json({ error: "Test destination is required" }, { status: 400 });
        if (!senderId) return NextResponse.json({ error: "Select and save a sender before sending a test" }, { status: 400 });
        if (channel === "email" && !subject.trim()) return NextResponse.json({ error: "Email subject is required before sending a test" }, { status: 400 });
        if (!body.trim()) return NextResponse.json({ error: "Message body is required before sending a test" }, { status: 400 });

        const sender = await loadSender(senderId) as SenderRow | null;
        if (!sender) return NextResponse.json({ error: "Active sender record could not be found" }, { status: 400 });
        if (sender.channel !== channel) return NextResponse.json({ error: "Sender channel does not match campaign channel" }, { status: 400 });
        let testSubject = subject;
        let testBody = body;
        const testRecipientId = input.testRecipientId?.trim();
        if (testRecipientId) {
          const recipientRows = await overlaySql`
            SELECT *
            FROM campaign_recipients
            WHERE campaign_id = ${id} AND id = ${testRecipientId}
            LIMIT 1
          `;
          if (recipientRows[0]) {
            testSubject = renderMergeFields(subject, recipientRows[0]);
            testBody = renderMergeFields(body, recipientRows[0]);
          }
        }

        const result = await deliverCommunication({
          channel: channel === "sms" ? "sms" : "email",
          provider: sender.provider,
          from: stringValue(sender.sender_value),
          fromName: stringValue(sender.label),
          to: testDestination,
          subject: testSubject,
          body: testBody,
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
        }
        if (!result.ok) return NextResponse.json({ error: result.failureReason || "Test send failed" }, { status: 400 });
        testResultMessage = `Test sent to ${testDestination}.`;
      }

      const campaignRows = await overlaySql`
        UPDATE campaigns
        SET
          template_id = ${templateId},
          message_subject = ${subject},
          message_body = ${body},
          test_sent_at = ${input.test ? new Date().toISOString() : current.test_sent_at},
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      const recipientRows = await overlaySql`
        SELECT *
        FROM campaign_recipients
        WHERE campaign_id = ${id}
        ORDER BY contact_name ASC, job_number ASC
      `;
      return NextResponse.json({
        campaign: toCampaign(campaignRows[0]),
        recipients: recipientRows.map(toRecipient),
        testResult: testResultMessage,
      });
    }

    const recipients = input.recipients || [];

    const mode = input.mode || "replace";

    if (mode === "replace") {
      await overlaySql`
        DELETE FROM campaign_recipients
        WHERE campaign_id = ${id}
      `;
    }

    const rows = [];
    for (const recipient of recipients) {
      const jobId = recipient.jobId?.trim();
      const destination = recipient.destination?.trim();
      if (!jobId || !destination) continue;

      rows.push({
        job_id: jobId,
        job_number: recipient.jobNumber ? Number(recipient.jobNumber) : null,
        contact_name: recipient.contactName?.trim() || "",
        destination,
        address: recipient.address?.trim() || "",
        salesperson_name: recipient.salespersonName?.trim() || "",
        job_stage: recipient.jobStage?.trim() || "",
        quote_date: typeof recipient.quoteDate === "string" ? recipient.quoteDate : null,
      });
    }

    if (rows.length > 0) {
      await overlaySql`
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
            job_id text,
            job_number integer,
            contact_name text,
            destination text,
            address text,
            salesperson_name text,
            job_stage text,
            quote_date timestamptz
          )
        )
        INSERT INTO campaign_recipients (
          campaign_id,
          insulhub_job_id,
          job_number,
          contact_name,
          destination,
          address,
          salesperson_name,
          job_stage,
          quote_date,
          selected
        )
        SELECT
          ${id}::uuid,
          job_id,
          job_number,
          contact_name,
          destination,
          address,
          salesperson_name,
          job_stage,
          quote_date,
          true
        FROM incoming
        ON CONFLICT (campaign_id, insulhub_job_id)
        DO UPDATE SET
          job_number = EXCLUDED.job_number,
          contact_name = EXCLUDED.contact_name,
          destination = EXCLUDED.destination,
          address = EXCLUDED.address,
          salesperson_name = EXCLUDED.salesperson_name,
          job_stage = EXCLUDED.job_stage,
          quote_date = EXCLUDED.quote_date,
          selected = true,
          updated_at = now()
      `;
    }

    const countRows = await overlaySql`
      SELECT COUNT(*)::int AS count
      FROM campaign_recipients
      WHERE campaign_id = ${id} AND selected = true
    `;
    const recipientCount = Number(countRows[0]?.count || 0);

    const campaignRows = await overlaySql`
      UPDATE campaigns
      SET recipient_count = ${recipientCount}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    const recipientRows = await overlaySql`
      SELECT *
      FROM campaign_recipients
      WHERE campaign_id = ${id}
      ORDER BY contact_name ASC, job_number ASC
    `;

    return NextResponse.json({
      campaign: toCampaign(campaignRows[0]),
      recipients: recipientRows.map(toRecipient),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save campaign audience" },
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
    const campaign = await loadCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (campaignIsLocked(campaign)) {
      return NextResponse.json({ error: "Sent campaign audiences cannot be edited" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const recipientId = searchParams.get("recipientId");
    let recipientIds = recipientId ? [recipientId] : [];

    if (!recipientIds.length) {
      try {
        const input = (await request.json()) as DeleteInput;
        recipientIds = (input.recipientIds || []).filter(Boolean);
      } catch {}
    }

    if (!recipientIds.length) {
      if (stringValue(campaign.status) !== "draft") {
        return NextResponse.json({ error: "Only draft campaigns can be deleted" }, { status: 400 });
      }

      await overlaySql`
        DELETE FROM campaigns
        WHERE id = ${id}
      `;

      return NextResponse.json({ ok: true, deletedCampaign: true });
    }

    await overlaySql`
      DELETE FROM campaign_recipients
      WHERE campaign_id = ${id}
        AND id IN (
          SELECT value::uuid
          FROM jsonb_array_elements_text(${JSON.stringify(recipientIds)}::jsonb)
        )
    `;

    const countRows = await overlaySql`
      SELECT COUNT(*)::int AS count
      FROM campaign_recipients
      WHERE campaign_id = ${id} AND selected = true
    `;
    const recipientCount = Number(countRows[0]?.count || 0);

    const campaignRows = await overlaySql`
      UPDATE campaigns
      SET recipient_count = ${recipientCount}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    const recipientRows = await overlaySql`
      SELECT *
      FROM campaign_recipients
      WHERE campaign_id = ${id}
      ORDER BY contact_name ASC, job_number ASC
    `;

    return NextResponse.json({
      campaign: toCampaign(campaignRows[0]),
      recipients: recipientRows.map(toRecipient),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove audience recipient" },
      { status: 500 }
    );
  }
}
