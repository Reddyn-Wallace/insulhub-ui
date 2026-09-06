import { crmJobMessagingEnabled } from "@/lib/job-messaging-settings";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { jobSmsIdentity } from "@/lib/job-sms-access";
import { overlaySql } from "@/lib/overlay-db";
import { deliverCommunication, emailContent, GmailPreflightError, type DeliveryResult } from "@/lib/communication-delivery";
import { validateJobEmail } from "@/lib/job-email";

export const maxDuration = 60;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
type Context = { params: Promise<{ id: string }> };
function publicMessage(row: Record<string, unknown>) {
  return { id: row.id, subject: row.subject, body: row.body, renderedBody: row.rendered_body, renderedHtml: row.rendered_html,
    destination: row.destination, senderLabel: row.sender_label, senderValue: row.sender_value, actorName: row.actor_name,
    status: row.status === "sending" && Date.now() - new Date(String(row.created_at)).getTime() > 60000 ? "unknown" : row.status,
    failureReason: row.failure_reason, createdAt: row.created_at };
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const { me } = await jobSmsIdentity(request, id);
    const enabled = await crmJobMessagingEnabled(me._id);
    const attempt = request.nextUrl.searchParams.get("attempt");
    if (attempt && !uuid.test(attempt)) return NextResponse.json({ error: "Invalid email reference." }, { status: 400 });
    const rows = attempt ? await overlaySql`SELECT * FROM job_email_messages WHERE id=${attempt} AND insulhub_job_id=${id}` : [];
    const senders = enabled ? await overlaySql`SELECT id,label,sender_value,provider_config FROM communication_senders WHERE channel='email' AND provider='gmail' AND is_active=true AND connection_status='connected' ORDER BY is_default DESC,label` : [];
    return NextResponse.json({ enabled, senders: senders.map(sender => ({ id: sender.id, label: sender.label, senderValue: sender.sender_value,
      signatureHtml: (sender.provider_config as Record<string,string> | null)?.gmailSignature || "" })), message: rows[0] ? publicMessage(rows[0]) : null });
  } catch { return NextResponse.json({ error: "Could not load CRM email. Check your connection and job access." }, { status: 503 }); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const { me, job } = await jobSmsIdentity(request, id);
    const input = await request.json();
    if (!input || typeof input.id !== "string" || !uuid.test(input.id)) return NextResponse.json({ error: "Invalid email reference." }, { status: 400 });
    let message;
    try { message = validateJobEmail(input); } catch (error) { return NextResponse.json({ error: (error as Error).message, safeToEdit: true }, { status: 400 }); }
    if (typeof input.senderId !== "string" || !uuid.test(input.senderId) || (input.templateTitle !== undefined && (typeof input.templateTitle !== "string" || input.templateTitle.length > 200))) return NextResponse.json({ error: "Choose a connected email account and valid template.", safeToEdit: true }, { status: 400 });
    const title = input.templateTitle || "";
    const hash = createHash("sha256").update(JSON.stringify([id, me._id, input.senderId, message.destination, message.subject, message.body, title])).digest("hex");
    const existing = await overlaySql`SELECT * FROM job_email_messages WHERE id=${input.id}`;
    if (existing[0]) {
      if (existing[0].insulhub_job_id !== id || existing[0].request_hash !== hash) return NextResponse.json({ error: "This email reference already belongs to a different send attempt." }, { status: 409 });
      return NextResponse.json({ message: publicMessage(existing[0]) });
    }
    if (!await crmJobMessagingEnabled(me._id)) return NextResponse.json({ error: "CRM messaging is disabled for your account. Manual Email remains available.", safeToEdit: true }, { status: 403 });
    const contact = job?.client?.contactDetails;
    if (!contact?.email || contact.email.trim().toLowerCase() !== message.destination.toLowerCase()) return NextResponse.json({ error: "The job contact email has changed or is missing. Refresh the job and correct the contact details before sending.", safeToEdit: true }, { status: 409 });
    const senders = await overlaySql`SELECT * FROM communication_senders WHERE id=${input.senderId} AND channel='email' AND provider='gmail' AND is_active=true AND connection_status='connected'`;
    const sender = senders[0];
    if (!sender) return NextResponse.json({ error: "That email account is unavailable. Choose a connected account.", safeToEdit: true }, { status: 400 });
    const config = (sender.provider_config || {}) as Record<string, string>;
    const content = emailContent(message.body, config.gmailSignature || "");
    if (Buffer.byteLength(content.htmlBody, "utf8") > 200000) return NextResponse.json({ error: "The message and signature are too large.", safeToEdit: true }, { status: 400 });
    const messageId = `<${input.id}@insulhub.nz>`;
    const createdAt = new Date().toISOString();
    const claimed = await overlaySql`INSERT INTO job_email_messages(id,insulhub_job_id,job_number,sender_id,sender_label,sender_value,actor_id,actor_name,destination,contact_name,subject,body,rendered_body,rendered_html,template_title,request_hash,status,rfc_message_id,created_at)
      VALUES(${input.id},${id},${job!.jobNumber},${input.senderId},${sender.label},${sender.sender_value},${me._id},${[me.firstname,me.lastname].filter(Boolean).join(" ") || me._id},${message.destination},${contact.name || ""},${message.subject},${message.body},${content.plainBody},${content.htmlBody},${title},${hash},${"sending"},${messageId},${createdAt})
      ON CONFLICT(id) DO NOTHING RETURNING id`;
    if (claimed.length) {
      let result: DeliveryResult;
      try {
        result = await deliverCommunication({ channel: "email", provider: "gmail", strictGmailConnection: true,
          from: String(sender.sender_value), fromName: String(sender.label), to: message.destination, subject: message.subject, body: message.body,
          messageId, providerConfig: config, accessToken: String(sender.provider_access_token || ""), refreshToken: String(sender.provider_refresh_token || ""),
          tokenExpiresAt: sender.provider_token_expires_at ? new Date(String(sender.provider_token_expires_at)).toISOString() : null,
          signal: AbortSignal.timeout(20000) });
      } catch (error) { result = error instanceof GmailPreflightError ? { ok: false, uncertain: false, failureCode: "gmail_connection" } : { ok: false, uncertain: true }; }
      const status = result.ok && result.providerMessageId ? "sent" : result.uncertain === false ? "failed" : "unknown";
      const reason = status === "sent" ? "" : status === "failed" && result.failureCode === "gmail_connection" ? "Email was not sent. Reconnect the selected Gmail account under Senders in Settings and verify its sending address." : status === "failed" ? "Gmail rejected this email. Check the recipient and connected account before composing a new attempt." : "Sending could not be confirmed. Check the sending account’s Sent folder before sending another email.";
      // Save acceptance before updating the token cache: a cache failure must not obscure a sent email.
      await overlaySql`UPDATE job_email_messages SET status=${status},failure_reason=${reason},provider_message_id=${result.providerMessageId || ""},provider_thread_id=${result.providerThreadId || ""},updated_at=now() WHERE id=${input.id} AND status='sending'`;
      if (result.accessToken) {
        try { await overlaySql`UPDATE communication_senders SET provider_access_token=${result.accessToken},provider_refresh_token=${result.refreshToken || sender.provider_refresh_token || ""},provider_token_expires_at=${result.tokenExpiresAt || sender.provider_token_expires_at || null},updated_at=now() WHERE id=${input.senderId} AND provider='gmail' AND provider_refresh_token=${sender.provider_refresh_token || ""}`; } catch { /* The confirmed send remains recorded. */ }
      }
    }
    const saved = await overlaySql`SELECT * FROM job_email_messages WHERE id=${input.id}`;
    if (saved[0]?.request_hash !== hash || saved[0]?.insulhub_job_id !== id) return NextResponse.json({ error: "Email reference already used." }, { status: 409 });
    return NextResponse.json({ message: publicMessage(saved[0]) });
  } catch { return NextResponse.json({ error: "Sending could not be confirmed. Your attempt is saved in this tab; check Gmail’s Sent folder before sending again." }, { status: 503 }); }
}
