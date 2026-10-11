import type {DeadEntry} from './dates';
export type DeadQuote = {
  deadEntry?: DeadEntry | null; deadDateUncertain?: boolean;
  _id: string; updatedAt?: string; jobNumber?: number; stage: string; notes?: string | null; archivedAt?: string | null;
  lead?: { leadStatus?: string | null; callbackDate?: string | null } | null;
  quote?: { extras?: {name?:string|null;price?:number|null}[] | null; status?: string | null; date?: string | null; c_total?: number | null; quoteNumber?: number | string | null; quoteNote?: string | null;
    wall?: { SQM?: number | null } | null; ceiling?: { SQM?: number | null } | null } | null;
  client?: { contactDetails?: { name?: string | null; email?: string | null; phoneMobile?: string | null; phoneSecondary?: string | null; streetAddress?: string | null; suburb?: string | null; city?: string | null } | null } | null;
};
export type EntryEvidence = { at: string; provenance: 'canonical' | 'note' | 'staff' | 'assumed' | 'ui'; reviewed?: boolean };
export type Approach = { number: 1 | 2; status: 'draft' | 'pending' | 'unknown' | 'failed' | 'sent'; sentAt?: string; discountCents?: number };
export type FollowupHistory = { entry: EntryEvidence | null; historyReviewed: boolean; approaches: Approach[]; snoozedUntil?: string; excluded?: boolean; reentryReviewRequired?: boolean };
export type Eligibility = { state: 'excluded' | 'review' | 'attention' | 'due' | 'waiting' | 'complete'; reason: string; approach?: 1 | 2; dueAt?: string; previousDiscountCents?: number };
export type DateSuggestion = { provenance: 'note'; date: string; at: string; evidence: string };
export type QueueItem = { notePending?: boolean; sendAvailable?: boolean; sendEnabled?: boolean; job: DeadQuote; eligibility: Eligibility; suggestion: DateSuggestion | null; earliestFirstApproach: string | null; controls?: ControlRecord };
export type QueueResponse = { quoteCounts?: Record<string,number>; preview?: boolean; items: QueueItem[]; checkedAt: string; readOnly: boolean; historyAvailable: boolean };

export type HistoricalOffer = { number: 1 | 2; sentAt: string; discountCents: number; channel: 'sms' | 'email'; evidence: string; source: 'staff_recorded' | 'provider_sent' | 'staff_verified'; attemptId?: string };
export type ControlState = { draftDiscountCents: number | null; snoozedUntil: string | null; exclusionReason: string | null; deadDate: string | null; dateEvidence: string; reviewedVersion: string | null; offers: HistoricalOffer[] };
export type ControlEvent = { revision: number; action: string; actorName: string; createdAt: string; state: ControlState; reason: string };
export type ControlRecord = { revision: number; state: ControlState; updatedAt: string | null; actorName: string };
