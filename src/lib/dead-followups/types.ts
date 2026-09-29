export type DeadQuote = {
  _id: string; jobNumber?: number; stage: string; notes?: string | null; archivedAt?: string | null;
  lead?: { leadStatus?: string | null; callbackDate?: string | null } | null;
  quote?: { status?: string | null; date?: string | null; c_total?: number | null; quoteNumber?: number | string | null; quoteNote?: string | null;
    wall?: { SQM?: number | null } | null; ceiling?: { SQM?: number | null } | null } | null;
  client?: { contactDetails?: { name?: string | null; streetAddress?: string | null; suburb?: string | null; city?: string | null } | null } | null;
};
export type EntryEvidence = { at: string; provenance: 'canonical' | 'note' | 'staff'; reviewed?: boolean };
export type Approach = { number: 1 | 2; status: 'draft' | 'pending' | 'unknown' | 'failed' | 'sent'; sentAt?: string; discountCents?: number };
export type FollowupHistory = { entry: EntryEvidence | null; historyReviewed: boolean; approaches: Approach[]; snoozedUntil?: string; excluded?: boolean; reentryReviewRequired?: boolean };
export type Eligibility = { state: 'excluded' | 'review' | 'attention' | 'due' | 'waiting' | 'complete'; reason: string; approach?: 1 | 2; dueAt?: string; previousDiscountCents?: number };
export type DateSuggestion = { provenance: 'note'; date: string; at: string; evidence: string };
export type QueueItem = { job: DeadQuote; eligibility: Eligibility; suggestion: DateSuggestion | null; earliestFirstApproach: string | null };
export type QueueResponse = { items: QueueItem[]; checkedAt: string; readOnly: true; historyAvailable: false };
