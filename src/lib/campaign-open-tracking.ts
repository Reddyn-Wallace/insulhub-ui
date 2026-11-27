export const campaignOpenLabels = {
  opened: "Opened",
  unopened: "Likely unopened",
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
  if (recipient.status !== "sent" || !recipient.openTracking) return null;
  return recipient.openTracking.likelyCount > 0 ? "opened" : "unopened";
}

const emailOpenTimeFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  weekday: "short", day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit",
});

export function formatEmailOpenTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : emailOpenTimeFormat.format(date);
}

export function summarizeCampaignOpens(recipients: CampaignOpenRecipient[]) {
  const counts = { tracked: 0, opened: 0, unopened: 0, repeat: 0, totalOpens: 0 };
  for (const recipient of recipients) {
    const status = campaignOpenStatus(recipient);
    if (!status || !recipient.openTracking) continue;
    counts[status]++;
    counts.tracked++;
    counts.totalOpens += recipient.openTracking.likelyCount;
    if (recipient.openTracking.likelyCount > 1) counts.repeat++;
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
