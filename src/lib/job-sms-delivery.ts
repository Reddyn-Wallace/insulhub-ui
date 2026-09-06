import { smsProviderOutcome, type SmsOutcome } from "./job-sms";
import { normalizeBaseUrl, smsgateAuthHeaders } from "./communication-delivery";
/** Job sends never retry on another device or silently resend after an uncertain result. */
export async function deliverJobSms(input: { id: string; to: string; body: string; providerConfig: Record<string, string> }): Promise<SmsOutcome> {
  const config = input.providerConfig;
  const baseUrl = normalizeBaseUrl(config.smsgateBaseUrl || (() => { throw Error("SMS sender server address is missing."); })());
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { ...smsgateAuthHeaders(config, true), "content-type": "application/json" },
    body: JSON.stringify({ id: input.id, phoneNumbers: [input.to], textMessage: { text: input.body }, withDeliveryReport: true,
      ...(config.smsgateDeviceId ? { deviceId: config.smsgateDeviceId } : {}),
      ...(config.smsgateSimNumber ? { simNumber: Number(config.smsgateSimNumber) } : {}) }),
  });
  if (!response.ok) {
    const rejected = response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status);
    return { status: rejected ? "failed" : "unknown", failureReason: rejected ? `SMS service rejected the request (${response.status}). Check the connected sender.` : "The SMS service response was not confirmed. Check status before sending again." };
  }
  const body = await response.json();
  if (body.id !== input.id) return { status: "unknown", failureReason: "SMS service returned an unexpected message reference. Check the sending device before sending again." };
  const outcome = smsProviderOutcome(body);
  return outcome.status === "unknown" ? { status: "accepted", failureReason: "" } : outcome;
}

export async function checkJobSms(id: string, config: Record<string, string>): Promise<SmsOutcome> {
  const baseUrl = normalizeBaseUrl(config.smsgateBaseUrl || (() => { throw Error("SMS sender server address is missing."); })());
  const response = await fetch(`${baseUrl}/messages/${encodeURIComponent(id)}`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000), headers: smsgateAuthHeaders(config, true),
  });
  if (!response.ok) throw Error("SMS status is unavailable. Do not resend until the sending device has been checked.");
  const body = await response.json();
  if (body.id !== id) throw Error("SMS message reference could not be verified.");
  return smsProviderOutcome(body);
}
