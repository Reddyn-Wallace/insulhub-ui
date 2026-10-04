import { describe, expect, it } from "vitest";
import { completionPackBlocker, canCompleteJob, validateManualInvoice } from "./job-completion";
const job = { installation: { installDate: "2026-07-23" }, council: { consentNumber: "SR123", files_Other: ["application"], files_CouncilApprovalLetters: ["approval"] }, certificateSentAt: "2026-08-03", finalInvoice: { xeroInvoiceNumber: "INV-1" } };
describe("completion requirements", () => {
  it("waives both council documents and permits saving N/A when council paperwork is not required", () => {
    expect(completionPackBlocker({ ...job, council: {} }, true)).toBeNull();
    expect(completionPackBlocker({ ...job, council: { consentNumber: "N/A" } }, true)).toBeNull();
    expect(completionPackBlocker({ ...job, installation: {} }, true)).toBe("Set an installation date first");
  });
  it("still requires a real consent and both documents without the exception", () => {
    expect(completionPackBlocker(job, false)).toBeNull();
    expect(completionPackBlocker({ ...job, council: { ...job.council, consentNumber: "N/A" } }, false)).toBe("Enter a consent number first");
    expect(completionPackBlocker({ ...job, council: { ...job.council, files_Other: [] } }, false)).toBe("Upload a council application first");
    expect(completionPackBlocker({ ...job, council: { ...job.council, files_CouncilApprovalLetters: [] } }, false)).toBe("Upload a council approval first (or mark N/A)");
  });
  it("accepts manual invoice confirmation but still needs the date and sent completion pack", () => {
    const manual = { reference: "MAN-12", confirmedAt: "2026-09-18", confirmedBy: "user", confirmedByName: "Sam" };
    expect(canCompleteJob({ ...job, finalInvoice: undefined }, null)).toBe(false);
    expect(canCompleteJob({ ...job, finalInvoice: undefined }, manual)).toBe(true);
    expect(canCompleteJob({ ...job, finalInvoice: undefined, certificateSentAt: undefined }, manual)).toBe(false);
    expect(canCompleteJob({ ...job, installation: {} }, manual)).toBe(false);
    expect(canCompleteJob(job, null)).toBe(true);
  });
  it("requires explicit confirmation and a usable invoice reference", () => {
    expect(validateManualInvoice({ reference: " INV-2 ", confirmed: true })).toBe("INV-2");
    expect(() => validateManualInvoice({ reference: "INV-2" })).toThrow();
    expect(() => validateManualInvoice({ reference: " ", confirmed: true })).toThrow();
    expect(() => validateManualInvoice({ reference: "a".repeat(161), confirmed: true })).toThrow();
  });
});
