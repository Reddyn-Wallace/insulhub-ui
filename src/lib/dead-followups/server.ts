import {assumedEntry,quoteInCohort} from './dates';
import 'server-only';
import { addNzMonths, classifyQuote, evaluateFollowup, suggestDeadDate } from './rules';
import type { DeadQuote, QueueItem, QueueResponse } from './types';

const QUERY = `query DeadQuoteReview($skip: Int, $limit: Int) {
  jobs(stages: [QUOTE], skip: $skip, limit: $limit) {
    total results {
      _id jobNumber stage notes archivedAt updatedAt
      lead { leadStatus callbackDate }
      quote { status date quoteNumber c_total quoteNote wall { SQM } ceiling { SQM } }
      client { contactDetails { name streetAddress suburb city } }
    }
  }
}`;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validQuote(value: unknown): value is DeadQuote {
  if (!record(value) || typeof value._id !== 'string' || !value._id || typeof value.stage !== 'string') return false;
  if (!('quote' in value) || !('lead' in value)) return false;
  if (value.quote !== null && (!record(value.quote) || !('status' in value.quote) || (value.quote.status !== null && typeof value.quote.status !== 'string'))) return false;
  if (value.lead !== null && (!record(value.lead) || !('leadStatus' in value.lead) || (value.lead.leadStatus !== null && typeof value.lead.leadStatus !== 'string'))) return false;
  for (const key of ['notes', 'archivedAt']) if (value[key] != null && typeof value[key] !== 'string') return false;
  if (record(value.lead) && value.lead.callbackDate != null && typeof value.lead.callbackDate !== 'string') return false;
  if (record(value.quote)) {
    for (const key of ['date','quoteNote']) if (value.quote[key] != null && typeof value.quote[key] !== 'string') return false;
    if (value.quote.c_total != null && (typeof value.quote.c_total !== 'number' || !Number.isFinite(value.quote.c_total))) return false;
    for (const key of ['wall','ceiling']) {
      const scope=value.quote[key];
      if (scope != null && (!record(scope) || (scope.SQM != null && (typeof scope.SQM !== 'number' || !Number.isFinite(scope.SQM))))) return false;
    }
  }
  if (value.client != null) {
    if (!record(value.client)) return false;
    const contact=value.client.contactDetails;
    if (contact != null) {
      if (!record(contact)) return false;
      for (const key of ['name','streetAddress','suburb','city','email','phoneMobile','phoneSecondary']) if (contact[key] != null && typeof contact[key] !== 'string') return false;
    }
  }
  return true;
}
const SCAN_ERROR = 'The full quote list could not be verified. Refresh and try again.';

export async function loadDeadQuoteQueue(token: string, checkedAt = new Date().toISOString()): Promise<QueueResponse> {
  const items: QueueItem[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let skip = 0;
  const signal = AbortSignal.timeout(40000);
  try {
    do {
      const response = await fetch('https://api.insulhub.nz/graphql', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal,
        headers: {'content-type':'application/json','x-access-token':token},
        body: JSON.stringify({query:QUERY,variables:{skip,limit:250}}),
      });
      if (!response.ok) throw Error(SCAN_ERROR);
      const json = await response.json();
      const page = json.data?.jobs;
      if (json.errors?.length || !Number.isInteger(page?.total) || page.total < 0 || page.total > 10000 || !Array.isArray(page.results) || (total !== null && page.total !== total)) throw Error(SCAN_ERROR);
      total = page.total;
      if (page.results.length === 0 && skip < total!) throw Error(SCAN_ERROR);
      for (const value of page.results) {
        if (!validQuote(value) || seen.has(value._id)) throw Error(SCAN_ERROR);
        seen.add(value._id);
        const job = value;
        if (classifyQuote(job) === 'excluded' || !quoteInCohort(job)) continue;
        job.deadEntry=assumedEntry(job,checkedAt);
        const suggestion = suggestDeadDate(job.notes,checkedAt);
        items.push({job,suggestion,
          earliestFirstApproach:job.deadEntry ? addNzMonths(job.deadEntry.at,2) : null,
          // Historical communication is not yet classified as individual offers.
          // Even a plausible note date must not silently authorise an approach.
          eligibility:evaluateFollowup(job,{entry:suggestion ? {at:suggestion.at,provenance:'note'} : null,historyReviewed:false,approaches:[]},checkedAt),
        });
      }
      skip += page.results.length;
      if (skip > total!) throw Error(SCAN_ERROR);
    } while (skip < total!);
  } catch { throw Error(SCAN_ERROR); }
  items.sort((a,b) => (a.suggestion?.at || '9999').localeCompare(b.suggestion?.at || '9999') || a.job._id.localeCompare(b.job._id));
  return {items,checkedAt,readOnly:true,historyAvailable:false};
}
