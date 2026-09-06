import { normalizeNzPhone } from "./sms-reply-matching";

export type SmsOutcome = { status: "accepted" | "sent" | "delivered" | "failed" | "unknown"; failureReason: string };
export function validateSmsInput(input: { body: unknown; destination: unknown }) {
  if (typeof input.body !== "string" || !input.body.trim() || input.body.length > 1600 || input.body.includes("\0")) throw Error("Enter a message of 1–1,600 characters.");
  if (typeof input.destination !== "string" || !/^[+\d\s().-]+$/.test(input.destination)) throw Error("Correct the mobile number in the job contact details before sending.");
  const destination = normalizeNzPhone(input.destination);
  if (!/^\+[1-9]\d{7,14}$/.test(destination)) throw Error("Correct the mobile number in the job contact details before sending.");
  return { body: input.body, destination };
}
export function smsProviderOutcome(value: Record<string, unknown>): SmsOutcome {
  const status = ({ Pending: "accepted", Processed: "accepted", Sent: "sent", Delivered: "delivered", Failed: "failed", Cancelled: "failed" } as Record<string, SmsOutcome["status"]>)[String(value.state)] || "unknown";
  return { status, failureReason: status === "failed" ? (typeof value.reason === "string" ? value.reason : "SMS Gateway reported a failure.") : "" };
}
export async function runSmsAttempt(deps: { claim: () => Promise<boolean>; deliver: () => Promise<SmsOutcome>; save: (outcome: SmsOutcome) => Promise<void> }) {
  if (!await deps.claim()) return;
  let outcome: SmsOutcome;
  try { outcome = await deps.deliver(); }
  catch { outcome = { status: "unknown", failureReason: "The SMS service response was not confirmed. Check status before sending again." }; }
  await deps.save(outcome);
}
export function smsStatusLabel(status: string) {
  return ({ sending: "Sending", accepted: "Accepted by SMS service", sent: "Sent", delivered: "Delivery reported", failed: "Failed", unknown: "Status unknown" } as Record<string, string>)[status] || status;
}
