import { randomUUID } from 'node:crypto';
import { overlaySql } from '@/lib/overlay-db';
import { deliverCommunication, type DeliveryResult } from '@/lib/communication-delivery';
import { checkJobSms } from '@/lib/job-sms-delivery';
import { communicationSendWindowError, nextAllowedSendAt, nzMinuteOfDay, type CommunicationSettings } from '@/lib/communication-settings';

const WAITING = 'Awaiting phone confirmation. Check SMSGate and Android background settings if this persists.';
const UNKNOWN = 'SMS status is unconfirmed. Checking automatically; do not resend until the phone has been checked.';
const BACKOFF_MS = 5 * 60_000;

export function campaignSmsValidUntil(settings: CommunicationSettings, now = new Date()) {
  let lifetime = 60 * 60_000;
  if (settings.campaignSendWindowEnabled) {
    const [hour, minute] = settings.campaignSendWindowEndTime.split(':').map(Number);
    lifetime = Math.min(lifetime, (hour * 60 + minute - nzMinuteOfDay(now)) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds());
  }
  return new Date(now.getTime() + Math.max(1000, lifetime)).toISOString();
}

// Keep pending + a durable provider reference until the phone confirms an outcome.
// A reference is written BEFORE network I/O: a crash or timeout must never cause a blind resend.
export async function processCampaignSms(input: {
  campaignId: string; halted: boolean; settings: CommunicationSettings;
  sender: { id: string; provider_config?: Record<string, string> };
}) {
  const { campaignId, sender, settings } = input;
  const config = sender.provider_config || {};
  const awaiting = await overlaySql`
    SELECT * FROM campaign_recipients WHERE campaign_id = ${campaignId}
      AND selected = true AND status = 'pending' AND COALESCE(provider_message_id, '') <> ''
      AND COALESCE(scheduled_at, now()) <= now()
    ORDER BY scheduled_at ASC NULLS FIRST, id LIMIT 5
  `;
  for (const row of awaiting) {
    let outcome;
    try { outcome = await checkJobSms(String(row.provider_message_id), config); }
    catch { outcome = { status: 'unknown', failureReason: UNKNOWN }; }
    const sent = outcome.status === 'sent' || outcome.status === 'delivered';
    const status = sent ? 'sent' : outcome.status === 'failed' ? 'failed' : 'pending';
    const reason = status === 'pending' ? (outcome.status === 'unknown' ? UNKNOWN : WAITING) : outcome.failureReason;
    await overlaySql`
      UPDATE campaign_recipients SET status = ${status}, failure_reason = ${reason},
        sent_at = ${sent ? new Date().toISOString() : null},
        scheduled_at = ${new Date(Date.now() + (outcome.status === 'unknown' ? BACKOFF_MS : 60_000)).toISOString()}, updated_at = now()
      WHERE id = ${String(row.id)} AND status = 'pending' AND provider_message_id = ${String(row.provider_message_id)}
    `;
  }
  if (input.halted) return { processedCount: 0, processResult: 'Campaign halted. Checking messages already submitted to SMSGate.' };

  const deferSender = async (reason: string, until: string) => {
    await overlaySql`
      UPDATE campaign_recipients cr SET scheduled_at = GREATEST(COALESCE(cr.scheduled_at, now()), ${until}::timestamptz),
        failure_reason = ${reason}, updated_at = now()
      FROM campaigns c WHERE c.id = cr.campaign_id AND c.sender_id = ${sender.id}
        AND c.status IN ('pending', 'sending') AND cr.selected = true AND cr.status = 'pending'
        AND COALESCE(cr.provider_message_id, '') = ''
    `;
  };
  // Backpressure spans campaigns using this sender, rather than filling the phone's queue.
  const outstanding = await overlaySql`
    SELECT cr.id FROM campaign_recipients cr JOIN campaigns c ON c.id = cr.campaign_id
    WHERE c.sender_id = ${sender.id} AND cr.status = 'pending' AND COALESCE(cr.provider_message_id, '') <> '' LIMIT 1
  `;
  if (outstanding.length) {
    await deferSender(WAITING, new Date(Date.now() + 60_000).toISOString());
    return { processedCount: 0, processResult: WAITING };
  }
  const windowError = communicationSendWindowError(settings);
  if (windowError) {
    await deferSender(windowError, nextAllowedSendAt(settings).toISOString());
    return { processedCount: 0, processResult: windowError };
  }
  const rows = await overlaySql`
    SELECT * FROM campaign_recipients WHERE campaign_id = ${campaignId}
      AND selected = true AND status = 'pending' AND COALESCE(provider_message_id, '') = ''
      AND COALESCE(scheduled_at, now()) <= now()
    ORDER BY scheduled_at ASC NULLS FIRST, contact_name ASC, job_number ASC LIMIT 5
  `;
  let processedCount = 0;
  let processResult = 'No recipients are due yet.';
  for (const row of rows) {
    const messageId = randomUUID();
    const claimed = await overlaySql`
      UPDATE campaign_recipients cr SET provider_message_id = ${messageId}, failure_reason = ${UNKNOWN},
        scheduled_at = ${new Date(Date.now() + 60_000).toISOString()}, updated_at = now()
      FROM campaigns c WHERE cr.id = ${String(row.id)} AND cr.campaign_id = c.id
        AND c.status IN ('pending', 'sending') AND cr.selected = true AND cr.status = 'pending'
        AND COALESCE(cr.provider_message_id, '') = '' AND COALESCE(cr.scheduled_at, now()) <= now()
      RETURNING cr.id
    `;
    if (!claimed.length) continue;
    let result: DeliveryResult;
    try {
      result = await deliverCommunication({ channel: 'sms', provider: 'smsgate', strictSmsgateConnection: true,
        messageId, smsValidUntil: campaignSmsValidUntil(settings), from: '', to: String(row.destination),
        subject: '', body: String(row.rendered_body), providerConfig: config });
    } catch { result = { ok: false, uncertain: true, failureReason: UNKNOWN }; }
    processedCount++;
    if (result.retryable) {
      await overlaySql`UPDATE campaign_recipients SET provider_message_id = '' WHERE id = ${String(row.id)} AND provider_message_id = ${messageId}`;
      processResult = `SMS queue paused: ${result.failureReason || 'SMS service is busy'}. Will check again in five minutes.`;
      await deferSender(processResult, new Date(Date.now() + BACKOFF_MS).toISOString());
      break;
    }
    const sent = result.smsState === 'sent' || result.smsState === 'delivered';
    const failed = result.smsState === 'failed' || (!result.ok && !result.uncertain);
    const status = sent ? 'sent' : failed ? 'failed' : 'pending';
    const reason = failed ? result.failureReason || 'SMS service rejected the message.' : sent ? '' : result.uncertain ? UNKNOWN : WAITING;
    await overlaySql`
      UPDATE campaign_recipients SET status = ${status}, failure_reason = ${reason},
        sent_at = ${sent ? new Date().toISOString() : null}, updated_at = now(),
        provider_message_id = ${failed && !result.ok ? '' : messageId}
      WHERE id = ${String(row.id)} AND status = 'pending' AND provider_message_id = ${messageId}
    `;
    processResult = status === 'pending' ? reason : 'SMS status updated.';
    if (result.uncertain) {
      await deferSender(UNKNOWN, new Date(Date.now() + BACKOFF_MS).toISOString());
      break;
    }
  }
  return { processedCount, processResult };
}
