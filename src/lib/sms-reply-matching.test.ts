import { describe, expect, it } from "vitest";
import { matchSmsReply, normalizeNzPhone } from "./sms-reply-matching";

describe("SMS reply matching", () => {
  it("normalizes common New Zealand phone formats", () => {
    expect(normalizeNzPhone("027 123 4567")).toBe("+64271234567");
    expect(normalizeNzPhone("64271234567")).toBe("+64271234567");
    expect(normalizeNzPhone("+64 27 123 4567")).toBe("+64271234567");
  });

  it("matches repeated campaigns for the same job", () => {
    const result = matchSmsReply("+64271234567", "2026-08-30T12:00:00Z", [
      { destination: "027 123 4567", insulhub_job_id: "job-1", sent_at: "2026-08-29T10:00:00Z" },
      { destination: "+64271234567", insulhub_job_id: "job-1", sent_at: "2026-08-20T10:00:00Z" },
    ]);
    expect(result.match?.insulhub_job_id).toBe("job-1");
    expect(result.ambiguous).toBe(false);
  });

  it("does not match messages sent after the reply", () => {
    const result = matchSmsReply("0271234567", "2026-08-30T09:00:00Z", [
      { destination: "+64271234567", insulhub_job_id: "job-1", sent_at: "2026-08-30T10:00:00Z" },
    ]);
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it("reports ambiguity when the same number belongs to different jobs", () => {
    const result = matchSmsReply("0271234567", "2026-08-30T12:00:00Z", [
      { destination: "+64271234567", insulhub_job_id: "job-1", sent_at: "2026-08-29T10:00:00Z" },
      { destination: "027 123 4567", insulhub_job_id: "job-2", sent_at: "2026-08-28T10:00:00Z" },
    ]);
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });
});
