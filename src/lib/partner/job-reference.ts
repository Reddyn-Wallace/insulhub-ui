import type { PartnerJobView } from "./repository";

export function partnerJobReference(job: PartnerJobView): string {
  if (job.submissionState === "DRAFT") return job.clientReference;
  return job.finalQuoteNumber?.trim() || (job.legacyJobNumber ? `Job ${job.legacyJobNumber}` : job.submissionState === "SUBMITTED" ? "Submitted job" : "Job reference pending");
}
