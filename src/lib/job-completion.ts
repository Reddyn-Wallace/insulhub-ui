export type ManualInvoiceConfirmation = {
  reference: string;
  confirmedAt: string;
  confirmedBy: string;
  confirmedByName: string;
};

type CompletionJob = {
  installation?: { installDate?: string | null } | null;
  council?: { consentNumber?: string | null; files_Other?: string[] | null; files_CouncilApprovalLetters?: string[] | null } | null;
  finalInvoice?: { xeroInvoiceId?: string | null; xeroInvoiceNumber?: string | null } | null;
  certificateSentAt?: string | null;
};

export function completionPackBlocker(job: CompletionJob, councilNotRequired: boolean): string | null {
  if (!job.installation?.installDate) return "Set an installation date first";
  // The sending action saves N/A to the canonical job before generating the certificate.
  if (councilNotRequired) return null;
  const consent = job.council?.consentNumber?.trim();
  if (!consent || consent.toUpperCase() === "N/A") return "Enter a consent number first";
  if (!job.council?.files_Other?.length) return "Upload a council application first";
  if (!job.council?.files_CouncilApprovalLetters?.length) return "Upload a council approval first (or mark N/A)";
  return null;
}

export function canCompleteJob(job: CompletionJob, manual: ManualInvoiceConfirmation | null): boolean {
  return Boolean(job.installation?.installDate && job.certificateSentAt &&
    (job.finalInvoice?.xeroInvoiceId || job.finalInvoice?.xeroInvoiceNumber || manual?.reference));
}

export function validateManualInvoice(input: unknown): string {
  if (!input || typeof input !== "object") throw new Error("Confirm that the invoice has been sent.");
  const value = input as Record<string, unknown>;
  if (value.confirmed !== true) throw new Error("Confirm that the invoice has been sent.");
  if (typeof value.reference !== "string" || !value.reference.trim() || value.reference.trim().length > 160 || /[\r\n\x00-\x1f]/.test(value.reference)) {
    throw new Error("Enter an invoice reference of up to 160 characters.");
  }
  return value.reference.trim();
}
