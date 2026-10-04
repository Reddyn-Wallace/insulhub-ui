import {quoteInCohort} from './dates';
import type { DeadQuote, FollowupHistory, Eligibility, DateSuggestion } from './types';

export function classifyQuote(job: DeadQuote): 'excluded' | 'conflict' | 'dead' {
  if (job.stage !== 'QUOTE' || !job.quote || job.archivedAt || job.quote.status === 'ACCEPTED') return 'excluded';
  if (job.lead?.leadStatus !== 'DEAD' && job.quote.status !== 'DECLINED') return 'excluded';
  if (job.quote.status === 'DEFERRED' || ['ON_HOLD', 'CALLBACK'].includes(job.lead?.leadStatus || '') || job.lead?.callbackDate) return 'conflict';
  return 'dead';
}

const nzParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function localParts(at: number) {
  const p = Object.fromEntries(nzParts.formatToParts(at).map(x => [x.type, x.value]));
  return [Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)];
}
function localStamp(parts: number[]) { const [y,m,d,h,min,s] = parts; return Date.UTC(y,m-1,d,h,min,s); }
// Modern NZ dates have +12/+13 offsets. Select the later instant for a repeated
// autumn time, and move forward through a nonexistent spring time: never early.
function fromNzParts(parts: number[], ms = 0) {
  const stamp = localStamp(parts);
  const candidates = [12,13].map(offset => stamp - offset * 3600000);
  const exact = candidates.filter(at => localStamp(localParts(at)) === stamp);
  return (exact.length ? Math.max(...exact) : candidates.filter(at => localStamp(localParts(at)) > stamp).sort((a,b)=>a-b)[0]) + ms;
}
export function addNzMonths(at: string, months: number): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time) || !Number.isInteger(months) || months < 0) throw Error('Invalid scheduling date');
  const parts = localParts(time);
  if (parts[0] < 2000) throw Error('Scheduling dates must be from 2000 onwards');
  const month = new Date(Date.UTC(parts[0], parts[1] - 1 + months, 1));
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth()+1, 0)).getUTCDate();
  return new Date(fromNzParts([month.getUTCFullYear(), month.getUTCMonth()+1, Math.min(parts[2],days), ...parts.slice(3)], new Date(time).getUTCMilliseconds())).toISOString();
}

export function evaluateFollowup(job: DeadQuote, history: FollowupHistory, now: string): Eligibility {
  if (!quoteInCohort(job)) return {state:'excluded',reason:'Only quotes dated from 1 January 2026 qualify.'};
  if (job.deadDateUncertain) return {state:'attention',reason:'The last job save needs its Dead date checked. Refresh and check the date before sending.'};
  const classification = classifyQuote(job);
  if (classification === 'excluded' || history.excluded) return {state:'excluded',reason:'Not an eligible Dead quote.'};
  if (classification === 'conflict') return {state:'review',reason:'Dead and callback statuses conflict. Review the quote status.'};
  if (history.approaches.some(a => a.status === 'unknown' || a.status === 'pending')) return {state:'attention',reason:'Confirm the previous send before another approach.'};
  const sent = history.approaches.filter(a => a.status === 'sent').sort((a,b)=>a.number-b.number);
  if (sent.some(a => !a.sentAt || !Number.isFinite(Date.parse(a.sentAt)) || Date.parse(a.sentAt) > Date.parse(now)) || new Set(sent.map(a=>a.number)).size !== sent.length || (sent.length && sent[0].number !== 1)) return {state:'review',reason:'Previous offer history needs review.'};
  if (sent.length === 2) return {state:'complete',reason:'Two approaches recorded. No more individual reminders.'};
  if (!history.historyReviewed || history.reentryReviewRequired) return {state:'review',reason:'Review previous offers before deciding the next approach.'};
  const entry = history.entry;
  if (!entry || (!['canonical','assumed','ui'].includes(entry.provenance) && !entry.reviewed) || !Number.isFinite(Date.parse(entry.at)) || (Date.parse(entry.at) > Date.parse(now) && entry.provenance !== 'assumed')) return {state:'review',reason:'The current Dead entry date needs review.'};
  try {
    let due = Date.parse(addNzMonths(entry.at,2));
    if (sent.length) due = Math.max(due,Date.parse(addNzMonths(sent[0].sentAt!,4)));
    if (history.snoozedUntil) {
      if (!Number.isFinite(Date.parse(history.snoozedUntil))) return {state:'review',reason:'The snooze date needs review.'};
      due = Math.max(due,Date.parse(history.snoozedUntil));
    }
    return {state:due <= Date.parse(now) ? 'due':'waiting',reason:sent.length ? 'Four months after the first successful send, subject to the current Dead entry.' : 'Two months after the current Dead entry.',approach:sent.length ? 2:1,dueAt:new Date(due).toISOString(),...(sent.length ? {previousDiscountCents:sent[0].discountCents}: {})};
  } catch { return {state:'review',reason:'The current Dead entry date needs review.'}; }
}

// Deliberately narrow: a suggestion is evidence for staff review, never a
// transition event. Ordinary reason notes ("too expensive") prove no date.
export function suggestDeadDate(notes: string | null | undefined, now: string): DateSuggestion | null {
  if (!notes || /\b(reopened|re-opened|accepted|revived|back to (?:new|open))\b/i.test(notes)) return null;
  const lines = notes.split(/\r?\n/).filter(line => /\b(dead|declined)\b/i.test(line));
  if (lines.length !== 1) return null;
  const match = lines[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+-\s+(?:marked\s+(?:as\s+)?dead|moved\s+to\s+dead|quote\s+declined)\b/i);
  if (!match) return null;
  const [,d,m,y] = match;
  const year = y.length === 2 ? 2000+Number(y) : Number(y);
  const day = Number(d), month = Number(m);
  const date = new Date(Date.UTC(year,month-1,day));
  if (year < 2000 || date.getUTCFullYear() !== year || date.getUTCMonth()+1 !== month || date.getUTCDate() !== day) return null;
  const at = new Date(fromNzParts([year,month,day,23,59,59],999)).toISOString();
  if (Date.parse(at) > Date.parse(now)) return null;
  return {provenance:'note',date:date.toISOString().slice(0,10),at,evidence:lines[0]};
}

/** Date-only evidence keeps a conservative end-of-NZ-day boundary. */
export function nzDateEnd(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Choose a valid date.');
  const [year,month,day]=value.split('-').map(Number);
  const check=new Date(Date.UTC(year,month-1,day));
  if (year<2000 || check.toISOString().slice(0,10)!==value) throw Error('Choose a valid date.');
  return new Date(fromNzParts([year,month,day,23,59,59],999)).toISOString();
}
