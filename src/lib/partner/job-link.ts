/** Small, explicit projection for the operational milestones partners need. */
export type LinkedJobStatus = {
  ebaCompleted: boolean | null;
  installDate: string | null;
  jobCompleted: boolean | null;
  checkedAt: string;
};
export type JobLinkTarget = {
  id: string; jobNumber: number; customerName: string;
  address: { street: string; suburb: string; city: string; postcode: string };
  status: LinkedJobStatus;
};
export type LinkablePartnerJob = {
  id: string; revision: number; clientReference: string; customerName: string;
  siteAddress: JobLinkTarget["address"]; submissionState: string;
  legacyId: string | null; linkedJobNumber: number | null; linkMethod:"MANUAL"|"AUTOMATIC"|"MANUAL_FALLBACK"|null; linkedStatus: LinkedJobStatus | null;
};
export const JOB_LINK_ERRORS = {
  INVALID: "Enter an InsulHub job number, job ID or job link.",
  NOT_FOUND: "That job could not be found. Check the identifier.",
  UNAVAILABLE: "InsulHub could not be checked. No link was changed. Try again shortly.",
  STALE: "The job details changed or the preview expired. Check the job again.",
  CONFLICT: "This job is already linked, is still transferring, or cannot be linked. Reload its latest details.",
  CONFIRM: "Confirm that the customer and property match before linking.",
} as const;
export class JobLinkError extends Error {
  constructor(public readonly code: keyof typeof JOB_LINK_ERRORS, public readonly status: number) { super(JOB_LINK_ERRORS[code]); }
}
export function parseJobIdentifier(raw: unknown): { id: string } | { number: number } {
  if (typeof raw !== "string" || raw.length > 500) throw new JobLinkError("INVALID", 400);
  const input = raw.trim();
  if (/^[a-f0-9]{24}$/i.test(input)) return { id: input.toLowerCase() };
  if (/^[1-9][0-9]{0,9}$/.test(input)) return { number: Number(input) };
  try {
    const url = new URL(input);
    // Extract an identifier only; this URL is never fetched. Accept local and
    // hosted InsulHub UI links, not arbitrary credentials/paths.
    const match = /^\/jobs\/([a-f0-9]{24})\/?$/i.exec(url.pathname);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && match) return { id: match[1].toLowerCase() };
  } catch { /* invalid identifier */ }
  throw new JobLinkError("INVALID", 400);
}
