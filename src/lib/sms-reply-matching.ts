export type SmsReplyCandidate = Record<string, unknown>;

export function normalizeNzPhone(value: string) {
  const compact = value.replace(/[^\d+]/g, "");
  if (compact.startsWith("+64")) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+64${digits.slice(1)}`;
  if (digits.startsWith("64")) return `+${digits}`;
  return compact;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function dateValue(value: unknown) {
  const time = new Date(stringValue(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function matchSmsReply(sender: string, receivedAt: string, candidates: SmsReplyCandidate[]) {
  const normalizedSender = normalizeNzPhone(sender);
  const receivedTime = dateValue(receivedAt);
  const eligible = candidates
    .filter((candidate) => (
      normalizeNzPhone(stringValue(candidate.destination)) === normalizedSender
      && dateValue(candidate.sent_at) > 0
      && dateValue(candidate.sent_at) <= receivedTime
    ))
    .sort((left, right) => dateValue(right.sent_at) - dateValue(left.sent_at));
  const byJob = new Map<string, SmsReplyCandidate>();
  for (const candidate of eligible) {
    const jobId = stringValue(candidate.insulhub_job_id);
    if (jobId && !byJob.has(jobId)) byJob.set(jobId, candidate);
  }
  const distinct = [...byJob.values()];
  return {
    normalizedSender,
    match: distinct.length === 1 ? distinct[0] : null,
    ambiguous: distinct.length > 1,
    candidates: distinct.length > 1 ? distinct : [],
  };
}
