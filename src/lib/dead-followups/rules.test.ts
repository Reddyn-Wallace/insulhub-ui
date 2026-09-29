import { describe, expect, it } from 'vitest';
import { addNzMonths, classifyQuote, evaluateFollowup, suggestDeadDate } from './rules';
const job = { _id: 'a', stage: 'QUOTE', quote: { status: 'DECLINED' }, lead: { leadStatus: 'DEAD' } };
const known = { at: '2026-01-29T21:00:00.000Z', provenance: 'canonical' as const };
const now = '2026-09-29T00:00:00Z';
describe('quote-only classification', () => {
  it.each(['LEAD','SCHEDULED','INSTALLATION','INVOICE','COMPLETED'])('excludes %s even with Dead flags', stage => expect(classifyQuote({...job,stage})).toBe('excluded'));
  it('excludes accepted and archived quotes', () => {
    expect(classifyQuote({...job,quote:{status:'ACCEPTED'}})).toBe('excluded');
    expect(classifyQuote({...job,archivedAt:now})).toBe('excluded');
  });
  it('requires a quote and either Dead signal', () => {
    expect(classifyQuote({...job,quote:null})).toBe('excluded');
    expect(classifyQuote({...job,lead:{leadStatus:'NEW'},quote:{status:'OPEN'}})).toBe('excluded');
    expect(classifyQuote({...job,lead:{leadStatus:'NEW'}})).toBe('dead');
  });
  it('withholds conflicting callback and Dead states', () => {
    expect(classifyQuote({...job,lead:{leadStatus:'ON_HOLD'}})).toBe('conflict');
    expect(classifyQuote({...job,quote:{status:'DEFERRED'}})).toBe('conflict');
  });
});
describe('NZ calendar waiting periods', () => {
  it.each([
    ['2026-01-30T21:00:00Z',1,'2026-02-27T21:00:00.000Z'],
    ['2026-01-29T21:00:00Z',2,'2026-03-29T21:00:00.000Z'],
    ['2026-04-10T00:00:00Z',4,'2026-08-10T00:00:00.000Z'],
    ['2026-07-29T00:00:00Z',4,'2026-11-28T23:00:00.000Z'],
    ['2024-01-30T21:00:00Z',1,'2024-02-28T21:00:00.000Z'],
  ])('adds months across month-end/DST: %s', (at, months, expected) => expect(addNzMonths(at,months)).toBe(expected));
});
describe('history gates and timing', () => {
  it('does not confuse missing history with no previous offer', () => expect(evaluateFollowup(job,{entry:known,historyReviewed:false,approaches:[]},now).state).toBe('review'));
  it('withholds unknown and unreviewed estimated dates', () => {
    expect(evaluateFollowup(job,{entry:null,historyReviewed:true,approaches:[]},now).state).toBe('review');
    expect(evaluateFollowup(job,{entry:{...known,provenance:'note'},historyReviewed:true,approaches:[]},now).state).toBe('review');
  });
  it('becomes due at exactly two months, not before', () => {
    const data={entry:known,historyReviewed:true,approaches:[]};
    expect(evaluateFollowup(job,data,'2026-03-29T20:59:59Z').state).toBe('waiting');
    expect(evaluateFollowup(job,data,'2026-03-29T21:00:00Z')).toMatchObject({state:'due',approach:1,dueAt:'2026-03-29T21:00:00.000Z'});
  });
  it('uses actual first success for second approach, retaining discount', () => {
    const data={entry:known,historyReviewed:true,approaches:[{number:1 as const,status:'sent' as const,sentAt:'2026-06-10T00:00:00Z',discountCents:50000}]};
    expect(evaluateFollowup(job,data,now)).toMatchObject({state:'waiting',approach:2,dueAt:'2026-10-09T23:00:00.000Z',previousDiscountCents:50000});
  });
  it.each(['pending','unknown'] as const)('blocks unresolved %s without starting a clock', status => expect(evaluateFollowup(job,{entry:known,historyReviewed:true,approaches:[{number:1,status}]},now).state).toBe('attention'));
  it('failed attempt does not count as approach one', () => expect(evaluateFollowup(job,{entry:known,historyReviewed:true,approaches:[{number:1,status:'failed'}]},now)).toMatchObject({state:'due',approach:1}));
  it('missing success timestamp needs review', () => expect(evaluateFollowup(job,{entry:known,historyReviewed:true,approaches:[{number:1,status:'sent'}]},now).state).toBe('review'));
  it('stops after two successful approaches', () => expect(evaluateFollowup(job,{entry:known,historyReviewed:true,approaches:[{number:1,status:'sent',sentAt:'2026-03-30T00:00:00Z'},{number:2,status:'sent',sentAt:'2026-08-01T00:00:00Z'}]},now).state).toBe('complete'));
  it('keeps the later minimum on re-entry and cannot snooze earlier', () => {
    const data={entry:{...known,at:'2026-09-01T00:00:00Z'},historyReviewed:true,snoozedUntil:'2026-09-02T00:00:00Z',approaches:[{number:1 as const,status:'sent' as const,sentAt:'2026-04-01T00:00:00Z'}]};
    expect(evaluateFollowup(job,data,now)).toMatchObject({state:'waiting',approach:2,dueAt:'2026-10-31T23:00:00.000Z'});
  });
});
describe('conservative historical note suggestions', () => {
  it('suggests an explicit transition with evidence and NZ date-only precision', () => expect(suggestDeadDate('29/01/26 - Marked as Dead: too expensive - Staff',now)).toMatchObject({provenance:'note',date:'2026-01-29',evidence:'29/01/26 - Marked as Dead: too expensive - Staff'}));
  it.each(['29/01/26 - too expensive - Staff','29/01/26 - Not marked as Dead - Staff','31/02/26 - Marked as Dead - Staff','01/01/28 - Marked as Dead - Staff','29/01/26 - Marked as Dead - Staff\n01/06/26 - Marked as Dead - Staff','29/01/26 - Marked as Dead - Staff\n01/06/26 - Reopened quote - Staff'])('does not guess ambiguous evidence: %s', notes => expect(suggestDeadDate(notes,now)).toBeNull());
});
it('chooses the later instant in the repeated NZ autumn hour',()=>expect(addNzMonths('2026-02-04T13:30:00Z',2)).toBe('2026-04-04T14:30:00.000Z'));
it('moves forward through the missing NZ spring hour',()=>expect(addNzMonths('2026-07-26T14:30:00Z',2)).toBe('2026-09-26T14:30:00.000Z'));
it('does not restart reminders for an exhausted quote when its review version changes',()=>{
 expect(evaluateFollowup(job,{entry:known,historyReviewed:false,approaches:[{number:1,status:'sent',sentAt:'2026-03-30T00:00:00Z'},{number:2,status:'sent',sentAt:'2026-08-01T00:00:00Z'}]},now).state).toBe('complete');
});
