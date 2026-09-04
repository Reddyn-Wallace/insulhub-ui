export const PARTNER_VISIBLE_MILESTONES = ["EBA_COMPLETED", "INSTALL_DATE_SET", "JOB_COMPLETED"] as const;
export type PartnerVisibleMilestone = typeof PARTNER_VISIBLE_MILESTONES[number];

export type PartnerVisibleAmendment = {
  sequence: number;
  description: string;
  createdAt: string;
  authorName?: string;
};

export type NeutralPartnerTracking = {
  id: string;
  clientReference: string;
  milestones: Partial<Record<PartnerVisibleMilestone, { recordedAt: string; effectiveAt?: string; installDate?: string }>>;
  amendments: PartnerVisibleAmendment[];
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const iso = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

/**
 * Deliberately projects only the neutral partner workflow. Historic billing,
 * invoice, settlement and cancellation data can remain archived in Postgres,
 * but it must never cross an active application boundary.
 */
export function neutralPartnerTracking(value: unknown): NeutralPartnerTracking | null {
  if (!record(value) || typeof value.id !== "string" || typeof value.clientReference !== "string") return null;
  const sourceMilestones = record(value.milestones) ? value.milestones : {};
  const milestones: NeutralPartnerTracking["milestones"] = {};
  for (const key of PARTNER_VISIBLE_MILESTONES) {
    const source = sourceMilestones[key];
    if (!record(source)) continue;
    const recordedAt = iso(source.recordedAt);
    if (!recordedAt) continue;
    const effectiveAt = iso(source.effectiveAt);
    const installDate = typeof source.installDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.installDate) ? source.installDate : null;
    milestones[key] = { recordedAt, ...(effectiveAt ? { effectiveAt } : {}), ...(installDate ? { installDate } : {}) };
  }
  const amendments = Array.isArray(value.amendments) ? value.amendments.flatMap((item) => {
    if (!record(item) || !Number.isSafeInteger(item.sequence) || Number(item.sequence) < 1 || typeof item.description !== "string") return [];
    const description = item.description.trim(), createdAt = iso(item.createdAt);
    return description && description.length <= 1000 && createdAt ? [{ sequence: Number(item.sequence), description, createdAt, ...(typeof item.authorName === "string" && item.authorName.trim() && item.authorName.length <= 200 ? { authorName: item.authorName.trim() } : {}) }] : [];
  }) : [];
  return { id: value.id, clientReference: value.clientReference, milestones, amendments };
}
