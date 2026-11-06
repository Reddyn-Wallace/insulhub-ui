import { describe, expect, it } from 'vitest';
import { completeVisit, rescheduleVisit, usageRows, calendarRows, finaliseChecksheet, weekOf, type SplitJob } from './model';
const job = (): SplitJob => ({ id: 'demo', number: 'DEMO-101', customer: 'Example job', area: 200, value: 10000, budgetBags: 30, visits: [{ id: 'v1', date: '2026-11-06', percent: 100, state: 'planned' }], checksheet: { complete: false, actualBags: null }, history: [] });
describe('installation percentage splits', () => {
 it('counts partial visits before the parent job is installed, leaving planned work out of usage', () => {
  const next = completeVisit(job(), 'v1', 60, '2026-11-10');
  expect(next.visits.map(v => [v.percent,v.state])).toEqual([[60,'completed'],[40,'planned']]);
  expect(next.checksheet.complete).toBe(false);
  expect(usageRows(next)).toMatchObject([{ percent:60, bags:18, basis:'budget-estimate', area:120 }]);
  expect(calendarRows(next).map(r => r.value)).toEqual([6000,4000]);
 });
 it('supports multiple returns using percentages of the whole job', () => {
  let next = completeVisit(job(), 'v1', 60, '2026-11-10');
  next = completeVisit(next, next.visits[1].id, 25, null);
  expect(next.visits.map(v=>v.percent)).toEqual([60,25,15]);
  expect(usageRows(next).reduce((n,r)=>n+(r.bags??0),0)).toBe(25.5);
  expect(next.visits[2].date).toBeNull();
 });
 it('rescheduling preserves completed visit dates and allocations', () => {
  const next = completeVisit(job(),'v1',60,'2026-11-10');
  expect(rescheduleVisit(next,next.visits[1].id,'2026-11-18').visits[0]).toEqual(next.visits[0]);
  expect(()=>rescheduleVisit(next,'v1','2026-11-18')).toThrow();
 });
 it('revises earlier estimates from final actual usage without duplicate rows', () => {
  let next=completeVisit(job(),'v1',60,'2026-11-10');
  next=completeVisit(next,next.visits[1].id,40,null);
  next=finaliseChecksheet(next,32);
  expect(usageRows(next).map(r=>r.bags)).toEqual([19.2,12.8]);
  expect(usageRows(next).every(r=>r.basis==='actual-total-allocation')).toBe(true);
  expect(next.history.at(-1)).toContain('32');
 });
 it('preserves manually recorded usage if imported later', () => {
  let next=completeVisit(job(),'v1',60,'2026-11-10');
  next=completeVisit(next,next.visits[1].id,40,null);
  next.visits[0].actualBags=22;
  next=finaliseChecksheet(next,32);
  expect(usageRows(next).map(r=>r.bags)).toEqual([22,10]);
  expect(()=>finaliseChecksheet(next,20)).toThrow();
 });
 it('reconciles rounding and handles zero actual bags',()=>{
  let next=completeVisit(job(),'v1',33.33,'2026-11-10');
  next=completeVisit(next,next.visits[1].id,33.33,'2026-11-17');
  next=completeVisit(next,next.visits[2].id,33.34,null);
  expect(usageRows(finaliseChecksheet(next,1)).reduce((n,r)=>n+(r.bags??0),0)).toBe(1);
  expect(usageRows(finaliseChecksheet(next,0)).map(r=>r.bags)).toEqual([0,0,0]);
 });
 it('does not invent missing bags or finalise unfinished work',()=>{
  const next=job(); next.budgetBags=null;
  expect(usageRows(completeVisit(next,'v1',60,null))[0].bags).toBeNull();
  expect(()=>finaliseChecksheet(next,32)).toThrow();
 });
 it('rejects duplicate completion, invalid percentages and dates',()=>{
  for(const percent of [0,-1,101,NaN,Infinity,20.123]) expect(()=>completeVisit(job(),'v1',percent,null)).toThrow();
  expect(()=>completeVisit(job(),'v1',60,'2026-02-30')).toThrow();
  expect(()=>completeVisit(job(),'v1',60,'2026-11-05')).toThrow();
  expect(()=>completeVisit(completeVisit(job(),'v1',60,null),'v1',20,null)).toThrow();
 });
 it('groups NZ calendar dates into Monday weeks',()=>{
  expect(weekOf('2026-11-08')).toBe('2026-11-02');
  expect(weekOf('2026-11-09')).toBe('2026-11-09');
 });
});
