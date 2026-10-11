// Keep the historical reasons recognised so existing halted campaigns can resume.
export const CAMPAIGN_HALTED_REASON = "Campaign halted before delivery.";
export const CAMPAIGN_CONNECTION_HALTED_REASON = "Sending connection is unavailable or its owner has not authorised this campaign. Create a new campaign using your own connected account.";

export function canResumeCampaignRecipient(recipient: {
  selected?: boolean;
  status: string;
  failureReason?: string;
  sentAt?: unknown;
  providerMessageId?: string;
}) {
  return recipient.selected !== false
    && recipient.status === "skipped"
    && !recipient.sentAt
    && !recipient.providerMessageId
    && (recipient.failureReason === CAMPAIGN_HALTED_REASON
      || recipient.failureReason === CAMPAIGN_CONNECTION_HALTED_REASON);
}

export function canRetryCampaignRecipient(recipient: {
  selected?: boolean;
  status: string;
  sentAt?: unknown;
  providerMessageId?: string;
}) {
  return recipient.selected !== false && recipient.status === "failed"
    && !recipient.sentAt && !recipient.providerMessageId;
}
