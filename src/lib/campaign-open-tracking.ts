export const campaignOpenLabels = {
  likely: "Likely opened",
  ambiguous: "Automated or unclear",
  undetected: "No open detected",
  unavailable: "Tracking unavailable",
} as const;

export type CampaignOpenStatus = keyof typeof campaignOpenLabels;
export const campaignOpenFilters = {
  all: "All recipients",
  ...campaignOpenLabels,
  repeat: "Repeat opens",
} as const;
export type CampaignOpenFilter = keyof typeof campaignOpenFilters;
export type CampaignOpenSort = "recipient" | "recent" | "count";

export type CampaignOpenRecipient = {
  status: string;
  openTracking?: {
    likelyCount: number;
    lastLikelyAt: string | null;
    ambiguousSeen: boolean;
  } | null;
};

export function campaignOpenStatus(recipient: CampaignOpenRecipient): CampaignOpenStatus | null {
  if (recipient.status !== "sent") return null;
  if (!recipient.openTracking) return "unavailable";
  if (recipient.openTracking.likelyCount > 0) return "likely";
  return recipient.openTracking.ambiguousSeen ? "ambiguous" : "undetected";
}

export function summarizeCampaignOpens(recipients: CampaignOpenRecipient[]) {
  const counts = { tracked: 0, likely: 0, ambiguous: 0, undetected: 0, unavailable: 0, repeat: 0 };
  for (const recipient of recipients) {
    const status = campaignOpenStatus(recipient);
    if (!status) continue;
    counts[status]++;
    if (status !== "unavailable") counts.tracked++;
    if ((recipient.openTracking?.likelyCount ?? 0) > 1) counts.repeat++;
  }
  return counts;
}

export function selectCampaignOpenRecipients<T extends CampaignOpenRecipient>(
  recipients: T[], filter: CampaignOpenFilter, sort: CampaignOpenSort,
) {
  const selected = filter === "all" ? recipients : recipients.filter(row =>
    filter === "repeat" ? row.status === "sent" && (row.openTracking?.likelyCount ?? 0) > 1 : campaignOpenStatus(row) === filter,
  );
  if (sort === "recipient") return selected;
  const recent = (row: T) => row.openTracking?.lastLikelyAt ? Date.parse(row.openTracking.lastLikelyAt) : 0;
  const count = (row: T) => row.openTracking?.likelyCount ?? 0;
  return [...selected].sort((a, b) => (sort === "count" ? count(b) - count(a) : 0) || recent(b) - recent(a));
}

export function serializeCampaignOpenTracking(row: Record<string, unknown>) {
  if (row.status !== "sent" || typeof row.open_tracking_token !== "string") return null;
  return {
    likelyCount: Number(row.likely_open_count ?? 0),
    lastLikelyAt: row.last_likely_open_at ?? null,
    ambiguousSeen: row.ambiguous_open_seen === true,
  };
}
