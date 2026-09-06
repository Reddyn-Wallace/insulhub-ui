import { expect, it } from "vitest";
import { mergeJobCommunicationHistory } from "./job-communication-history";
it("retains a confirmed send when an earlier history request returns, without losing older records", () => {
  const sent = { id: "new", sentAt: "2026-09-06T12:00:00Z", status: "sent" };
  const older = { id: "old", sentAt: "2026-09-05T12:00:00Z", status: "sent" };
  expect(mergeJobCommunicationHistory([older], [sent], new Set(["new"]))).toEqual([sent, older]);
  expect(mergeJobCommunicationHistory([{ ...sent, status: "sending" }, older], [sent], new Set(["new"]))).toEqual([sent, older]);
});
it("accepts authoritative history for records not changed during the request", () => {
  expect(mergeJobCommunicationHistory([], [{ id: "not-recorded" }], new Set())).toEqual([]);
});
