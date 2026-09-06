import { crmJobMessagingEnabled } from "@/lib/job-messaging-settings";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { jobSmsIdentity } from "@/lib/job-sms-access";
import { overlaySql } from "@/lib/overlay-db";
import { checkJobSms, deliverJobSms } from "@/lib/job-sms-delivery";
import { runSmsAttempt, validateSmsInput } from "@/lib/job-sms";

export const maxDuration = 60;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
type Context = { params: Promise<{ id: string }> };
function publicMessage(row: Record<string, unknown>) {
  return { id: row.id, body: row.body, destination: row.destination, senderLabel: row.sender_label, actorName: row.actor_name,
    status: row.status === "sending" && Date.now() - new Date(String(row.created_at)).getTime() > 60000 ? "unknown" : row.status,
    failureReason: row.failure_reason, createdAt: row.created_at };
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const { me } = await jobSmsIdentity(request, id);
    const available = await crmJobMessagingEnabled(me._id);
    const attempt = request.nextUrl.searchParams.get("attempt");
    if (attempt && !uuid.test(attempt)) return NextResponse.json({ error: "Invalid message reference." }, { status: 400 });
    const rows = attempt ? await overlaySql`SELECT * FROM job_sms_messages WHERE id=${attempt} AND insulhub_job_id=${id}` : [];
    const senders = available ? await overlaySql`SELECT id,label,sender_value AS "senderValue" FROM communication_senders WHERE channel='sms' AND provider='smsgate' AND is_active=true AND connection_status='connected' ORDER BY is_default DESC,label` : [];
    return NextResponse.json({ enabled: available, senders, message: rows[0] ? publicMessage(rows[0]) : null });
  } catch { return NextResponse.json({ error: "Could not load CRM SMS. Check your connection and job access." }, { status: 503 }); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const { me, job } = await jobSmsIdentity(request, id);
    const input = await request.json();
    if (typeof input.id !== "string" || !uuid.test(input.id)) return NextResponse.json({ error: "Invalid message reference." }, { status: 400 });
    const existing = await overlaySql`SELECT * FROM job_sms_messages WHERE id=${input.id}`;
    const row = existing[0];
    if (row && row.insulhub_job_id !== id) return NextResponse.json({ error: "Message reference already used." }, { status: 409 });
    if (input.action === "check") {
      if (!row) return NextResponse.json({ error: "Message not found." }, { status: 404 });
      const senders = await overlaySql`SELECT provider_config FROM communication_senders WHERE id=${row.sender_id} AND provider='smsgate'`;
      if (!senders[0]) return NextResponse.json({ error: "Sender is no longer available. Check the sending device." }, { status: 409 });
      const outcome = await checkJobSms(String(row.provider_message_id), senders[0].provider_config as Record<string, string>);
      if (outcome.status !== "unknown") await overlaySql`UPDATE job_sms_messages SET status=${outcome.status}, failure_reason=${outcome.failureReason}, updated_at=now() WHERE id=${input.id}
        AND status <> 'failed' AND (status IN ('sending','unknown','accepted') OR ${outcome.status} IN ('delivered','failed') OR (status='sent' AND ${outcome.status}='sent'))`;
    } else {
      let message;
      try { message = validateSmsInput(input); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
      if (typeof input.senderId !== "string" || !uuid.test(input.senderId) || (input.templateTitle !== undefined && (typeof input.templateTitle !== "string" || input.templateTitle.length > 200))) return NextResponse.json({ error: "Choose a connected SMS sender and valid template." }, { status: 400 });
      const templateTitle = input.templateTitle || "";
      const hash = createHash("sha256").update(JSON.stringify([id, me._id, input.senderId, message.destination, message.body, templateTitle])).digest("hex");
      if (row) {
        if (row.request_hash !== hash) return NextResponse.json({ error: "This send attempt already has different content. Check its status before composing another message." }, { status: 409 });
        return NextResponse.json({ message: publicMessage(row) });
      }
      if (!await crmJobMessagingEnabled(me._id)) return NextResponse.json({ error: "CRM SMS is disabled. Manual SMS remains available." }, { status: 403 });
      const contact = job?.client?.contactDetails;
      let canonical;
      try { canonical = validateSmsInput({ body: message.body, destination: contact?.phoneMobile || contact?.phoneSecondary }); }
      catch { return NextResponse.json({ error: "Correct the mobile number in the job contact details before sending." }, { status: 400 }); }
      if (canonical.destination !== message.destination) return NextResponse.json({ error: "The job contact number has changed. Refresh the job before sending.", safeToEdit: true }, { status: 409 });
      const senders = await overlaySql`SELECT * FROM communication_senders WHERE id=${input.senderId} AND channel='sms' AND provider='smsgate' AND is_active=true AND connection_status='connected'`;
      const sender = senders[0];
      if (!sender) return NextResponse.json({ error: "That SMS sender is unavailable. Choose a connected sender." }, { status: 400 });
      await runSmsAttempt({
        claim: async () => {
          const claimed = await overlaySql`INSERT INTO job_sms_messages(id,insulhub_job_id,job_number,sender_id,sender_label,sender_value,actor_id,actor_name,destination,contact_name,body,template_title,request_hash,status,provider_message_id)
            VALUES(${input.id},${id},${job!.jobNumber},${input.senderId},${sender.label},${sender.sender_value},${me._id},${[me.firstname,me.lastname].filter(Boolean).join(" ") || me._id},${message.destination},${contact?.name || ""},${message.body},${templateTitle},${hash},'sending',${input.id})
            ON CONFLICT(id) DO NOTHING RETURNING id`;
          return claimed.length === 1;
        },
        deliver: () => deliverJobSms({ id: input.id, to: message.destination, body: message.body, providerConfig: sender.provider_config as Record<string, string> }),
        save: async outcome => { await overlaySql`UPDATE job_sms_messages SET status=${outcome.status},failure_reason=${outcome.failureReason},updated_at=now() WHERE id=${input.id} AND status='sending'`; },
      });
      // A concurrent loser must not return another request's content.
      const saved = await overlaySql`SELECT * FROM job_sms_messages WHERE id=${input.id}`;
      if (saved[0]?.request_hash !== hash) return NextResponse.json({ error: "Message reference already used." }, { status: 409 });
      return NextResponse.json({ message: publicMessage(saved[0]) });
    }
    const saved = await overlaySql`SELECT * FROM job_sms_messages WHERE id=${input.id} AND insulhub_job_id=${id}`;
    return NextResponse.json({ message: publicMessage(saved[0]) });
  } catch { return NextResponse.json({ error: "The request could not be confirmed. Check the saved message status before sending again." }, { status: 503 }); }
}
