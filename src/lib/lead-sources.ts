export const LEAD_SOURCE_OPTIONS = [
  "Contact Form",
  "Social Media",
  "Phone Call",
  "Referral",
  "Homeshow",
] as const;

export type LeadSourceOption = (typeof LEAD_SOURCE_OPTIONS)[number];

export function normalizeLeadSourceValue(value: string) {
  return value.trim().toLowerCase();
}

export function canonicalLeadSourceLabel(value: string) {
  const normalized = normalizeLeadSourceValue(value);
  return LEAD_SOURCE_OPTIONS.find((option) => normalizeLeadSourceValue(option) === normalized) || value.trim();
}
