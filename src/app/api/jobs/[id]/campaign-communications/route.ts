import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type LogInput = {
  channel?: "email" | "sms";
  destination?: string;
  contactName?: string;
  jobNumber?: number | string | null;
  templateId?: string | null;
  templateTitle?: string | null;
  renderedSubject?: string | null;
  renderedBody?: string | null;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0);
}

function toCommunication(row: Record<string, unknown>) {
  return {
    id: stringValue(row.id),
    source: stringValue(row.source),
    campaignId: stringValue(row.campaign_id),
    campaignName: stringValue(row.campaign_name),
    templateId: stringValue(row.template_id),
    templateTitle: stringValue(row.template_title),
    channel: stringValue(row.channel),
    senderLabel: stringValue(row.sender_label),
    destination: stringValue(row.destination),
    contactName: stringValue(row.contact_name),
    jobNumber: numberValue(row.job_number),
    status: stringValue(row.status),
    renderedSubject: stringValue(row.rendered_subject),
    renderedBody: stringValue(row.rendered_body),
    sentAt: row.sent_at || row.launched_at,
    launchedAt: row.launched_at,
    failureReason: stringValue(row.failure_reason),
  };
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

    const rows = await overlaySql`
      WITH campaign_logs AS (
        SELECT
          cr.id,
          'campaign' AS source,
          cr.campaign_id,
          c.name AS campaign_name,
          NULL::uuid AS template_id,
          '' AS template_title,
          c.channel,
          c.sender_label,
          cr.destination,
          cr.contact_name,
          cr.job_number,
          cr.status,
          cr.rendered_subject,
          cr.rendered_body,
          cr.sent_at,
          NULL::timestamptz AS launched_at,
          cr.failure_reason
        FROM campaign_recipients cr
        JOIN campaigns c ON c.id = cr.campaign_id
        WHERE cr.insulhub_job_id = ${id}
          AND cr.status IN ('sent', 'failed', 'skipped')
      ),
      job_logs AS (
        SELECT
          jcl.id,
          'job' AS source,
          NULL::uuid AS campaign_id,
          '' AS campaign_name,
          jcl.template_id,
          jcl.template_title,
          jcl.channel,
          '' AS sender_label,
          jcl.destination,
          jcl.contact_name,
          jcl.job_number,
          'launched' AS status,
          jcl.rendered_subject,
          jcl.rendered_body,
          NULL::timestamptz AS sent_at,
          jcl.launched_at,
          '' AS failure_reason
        FROM job_communication_logs jcl
        WHERE jcl.insulhub_job_id = ${id}
      )
      SELECT *
      FROM (
        SELECT * FROM campaign_logs
        UNION ALL
        SELECT * FROM job_logs
      ) combined
      ORDER BY COALESCE(sent_at, launched_at) DESC NULLS LAST
    `;

    return NextResponse.json({ communications: rows.map(toCommunication) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load campaign communications" },
      { status: 500 }
    );
  }
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
    const input = (await request.json()) as LogInput;
    const channel = input.channel;
    if (channel !== "email" && channel !== "sms") {
      return NextResponse.json({ error: "Channel must be email or sms" }, { status: 400 });
    }

    const destination = input.destination?.trim() || "";
    if (!destination) return NextResponse.json({ error: "Destination is required" }, { status: 400 });

    const templateId = input.templateId?.trim() || null;
    const templateTitle = input.templateTitle?.trim() || "";
    const renderedSubject = input.renderedSubject?.trim() || "";
    const renderedBody = input.renderedBody?.trim() || "";
    const contactName = input.contactName?.trim() || "";
    const jobNumber = input.jobNumber ? Number(input.jobNumber) : null;

    const rows = await overlaySql`
      INSERT INTO job_communication_logs (
        insulhub_job_id,
        job_number,
        channel,
        destination,
        contact_name,
        template_id,
        template_title,
        rendered_subject,
        rendered_body
      )
      VALUES (
        ${id},
        ${jobNumber},
        ${channel},
        ${destination},
        ${contactName},
        ${templateId},
        ${templateTitle},
        ${renderedSubject},
        ${renderedBody}
      )
      RETURNING
        id,
        'job' AS source,
        NULL::uuid AS campaign_id,
        '' AS campaign_name,
        template_id,
        template_title,
        channel,
        '' AS sender_label,
        destination,
        contact_name,
        job_number,
        'launched' AS status,
        rendered_subject,
        rendered_body,
        NULL::timestamptz AS sent_at,
        launched_at,
        '' AS failure_reason
    `;

    return NextResponse.json({ communication: toCommunication(rows[0]) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record job communication" },
      { status: 500 }
    );
  }
}
