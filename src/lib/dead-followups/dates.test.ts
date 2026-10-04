import {describe,it,expect} from 'vitest';
import {assumedEntry,quoteInCohort,transitionKind,isTrackedMutation} from './dates';
const now='2026-10-04T00:00:00Z';
const job={_id:'a',stage:'QUOTE',quote:{status:'DECLINED',date:'2026-02-01'},lead:{leadStatus:'DEAD'}};
describe('fixed quote cohort and agreed assumptions',()=>{
 it('uses quote date, not note date, at the NZ new-year boundary',()=>{
  expect(quoteInCohort({...job,quote:{...job.quote,date:'2025-12-31T10:59:59Z'},notes:'01/06/26 - recent note'})).toBe(false);
  expect(quoteInCohort({...job,quote:{...job.quote,date:'2025-12-31T11:00:00Z'}})).toBe(true);
  expect(quoteInCohort({...job,quote:{...job.quote,date:null}})).toBe(false);
  expect(quoteInCohort({...job,quote:{...job.quote,date:'2026-02-30'}})).toBe(false);
 });
 it('uses latest dated note regardless of words or note ordering',()=>{
  expect(assumedEntry({...job,notes:'05/04/26 - Called customer\n03/03/2026 - Dead\nundated comment'},now)).toMatchObject({source:'last_note',at:'2026-04-05T11:59:59.999Z'});
  expect(assumedEntry({...job,notes:'2026-04-07 - Another note'},now)).toMatchObject({source:'last_note',at:'2026-04-07T11:59:59.999Z'});
 });
 it('ignores dates in prose, invalid/future note stamps and generated follow-up notes',()=>{
  expect(assumedEntry({...job,notes:'Visit planned 04/05/26\n31/02/26 - invalid\n01/01/27 - future\n[Dead quote follow-up abc]\n02/09/2026, 10:00 (NZ time) — Approach 1 sent'},now)).toMatchObject({source:'quote_plus_30',at:'2026-03-03T10:59:59.999Z'});
 });
 it('adds thirty calendar days across DST, retaining future fallback dates',()=>{
  expect(assumedEntry({...job,quote:{...job.quote,date:'2026-09-20'}},now)).toMatchObject({source:'quote_plus_30',at:'2026-10-20T10:59:59.999Z'});
 });
 it('never assumes an entry for an old quote or lead',()=>{
  expect(assumedEntry({...job,quote:{...job.quote,date:'2025-12-31'}},now)).toBeNull();
  expect(assumedEntry({...job,stage:'LEAD'},now)).toBeNull();
 });
});
describe('effective quote transitions',()=>{
 it('records entry and exit but not repeated saves or leads',()=>{
  const open={...job,lead:{leadStatus:'NEW'},quote:{...job.quote,status:'UNSET'}};
  expect(transitionKind(open,job)).toBe('entered');expect(transitionKind(job,open)).toBe('left');
  expect(transitionKind(job,{...job,notes:'changed'})).toBeNull();
  expect(transitionKind({...open,stage:'LEAD'},{...job,stage:'LEAD'})).toBeNull();
  expect(transitionKind(job,{...job,stage:'INSTALLATION'})).toBe('left');
 });
 it('routes every updateJob and archive mutation but no queries or unrelated mutations',()=>{
  expect(isTrackedMutation('mutation X($input:UpdateJobInput!){updateJob(input:$input){_id}}',{input:{_id:'a'}})).toBe('a');
  expect(isTrackedMutation('mutation X($_id:ObjectId!){archiveJob(_id:$_id)}',{_id:'a'})).toBe('a');
  expect(isTrackedMutation('query {jobs{total}}',{})).toBeNull();
 });
});

import {evaluateFollowup} from './rules';
import {controlHistory,emptyControls,applyControl} from './controls';
it('allows automatic assumed dates, retains offer review, and waits for a future fallback',()=>{
 const quote={...job,updatedAt:'v1',quote:{...job.quote,date:'2026-09-20'}};
 const state={...emptyControls(),reviewedVersion:'v1'};
 expect(evaluateFollowup(quote,controlHistory(state,quote),now)).toMatchObject({state:'waiting',dueAt:'2026-12-20T10:59:59.999Z'});
 expect(evaluateFollowup(quote,controlHistory(emptyControls(),quote),now).state).toBe('review');
 const reviewed=applyControl(emptyControls(),{action:'review',historyConfirmed:true},quote,now);
 expect(reviewed.deadDate).toBe('2026-10-20T10:59:59.999Z');
});
it('blocks old quotes even with manually reviewed history and recorded transitions',()=>{
 const quote={...job,quote:{...job.quote,date:'2025-12-31'},updatedAt:'v1'};
 expect(evaluateFollowup(quote,{entry:{at:'2026-01-01',provenance:'ui'},historyReviewed:true,approaches:[]},now).state).toBe('excluded');
 expect(()=>applyControl(emptyControls(),{action:'discount',amount:'5'},quote,now)).toThrow();
});
it('recorded re-entry overrides any old staff date and retains successful offers',()=>{
 const quote={...job,updatedAt:'v1',deadEntry:{at:'2026-10-01T00:00:00Z',source:'ui_transition' as const,evidence:'UI'}};
 const state={...emptyControls(),deadDate:'2026-01-01',reviewedVersion:'v1',offers:[{number:1 as const,sentAt:'2026-04-01T00:00:00Z',discountCents:50000,channel:'sms' as const,source:'provider_sent' as const,evidence:'sent'}]};
 expect(evaluateFollowup(quote,controlHistory(state,quote),now)).toMatchObject({state:'waiting',approach:2,dueAt:'2026-12-01T00:00:00.000Z',previousDiscountCents:50000});
});
it('rejects impossible ISO dates and ambiguous timestamps',()=>{
 for(const date of ['2026-02-30T00:00:00Z','2026-01-01T00:00:00'])expect(quoteInCohort({...job,quote:{...job.quote,date}})).toBe(false);
});
