import { expect,it } from 'vitest';
import { applyControl, emptyControls, parseDiscount, controlHistory } from './controls';
const now='2026-09-30T01:00:00Z';
const job={_id:'abc',stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',quote:{status:'DECLINED',c_total:10000},lead:{leadStatus:'DEAD'}};
it.each([['500',50000],['12.35',1235],['0',0]])('stores NZD %s exactly in cents',(s,n)=>expect(parseDiscount(s)).toBe(n));
it.each(['-1','1.005','NaN','1e3','', 'Infinity'])('rejects invalid discount %s',s=>expect(()=>parseDiscount(s)).toThrow());
it('draft discount does not become an offer or change eligibility history',()=>{
 const result=applyControl(emptyControls(),{action:'discount',amount:'500'},job,now);
 expect(result.draftDiscountCents).toBe(50000);expect(result.offers).toEqual([]);expect(controlHistory(result,job).historyReviewed).toBe(false);
});
it('rejects a discount greater than the current quoted total',()=>expect(()=>applyControl(emptyControls(),{action:'discount',amount:'10001'},job,now)).toThrow());
it('snooze is future-only and reversible',()=>{
 expect(()=>applyControl(emptyControls(),{action:'snooze',date:'2026-01-01'},job,now)).toThrow();
 const saved=applyControl(emptyControls(),{action:'snooze',date:'2026-10-07'},job,now);
 expect(saved.snoozedUntil).toBe('2026-10-07T10:59:59.999Z');
 expect(applyControl(saved,{action:'unsnooze'},job,now).snoozedUntil).toBeNull();
});
it('exclusion requires a reason and restore preserves the saved draft',()=>{
 expect(()=>applyControl(emptyControls(),{action:'exclude',reason:''},job,now)).toThrow();
 const saved=applyControl({...emptyControls(),draftDiscountCents:12300},{action:'exclude',reason:'Not suitable'},job,now);
 expect(saved.exclusionReason).toBe('Not suitable');expect(applyControl(saved,{action:'restore'},job,now)).toMatchObject({draftDiscountCents:12300,exclusionReason:null});
});
it('records staff-estimated date with evidence, never canonical provenance',()=>{
 const saved=applyControl(emptyControls(),{action:'review',date:'2026-01-29',evidence:'Dated note confirms this episode',historyConfirmed:true},job,now);
 expect(controlHistory(saved,job)).toMatchObject({entry:{provenance:'staff',reviewed:true},historyReviewed:true});
 expect(controlHistory(saved,{...job,updatedAt:now}).historyReviewed).toBe(false);
});
it('records an earlier offer independently of the draft, retaining evidence and discount',()=>{
 const saved=applyControl({...emptyControls(),draftDiscountCents:90000},{action:'record_offer',date:'2026-05-15',amount:'500',channel:'sms',evidence:'SMS in company phone Sent folder'},job,now);
 expect(saved.offers[0]).toMatchObject({number:1,discountCents:50000,channel:'sms',source:'staff_recorded'});
 expect(saved.draftDiscountCents).toBe(90000);
 expect(saved.reviewedVersion).toBeNull();
 expect(controlHistory(saved,job).approaches[0]).toMatchObject({status:'sent',discountCents:50000});
});
it('caps history at two offers, allows correcting only the latest with a reason',()=>{
 let saved=applyControl(emptyControls(),{action:'record_offer',date:'2026-01-01',amount:'100',channel:'email',evidence:'Sent folder'},job,now);
 saved=applyControl(saved,{action:'record_offer',date:'2026-06-01',amount:'200',channel:'sms',evidence:'Phone history'},job,now);
 expect(()=>applyControl(saved,{action:'record_offer',date:'2026-09-01',amount:'300',channel:'sms',evidence:'Phone'},job,now)).toThrow();
 expect(()=>applyControl(saved,{action:'remove_latest_offer',reason:''},job,now)).toThrow();
 expect(applyControl(saved,{action:'remove_latest_offer',reason:'Recorded on wrong quote'},job,now).offers).toHaveLength(1);
});
it.each([{...job,stage:'LEAD'},{...job,quote:{status:'ACCEPTED'}},{...job,updatedAt:undefined}])('blocks stale/ineligible canonical records',quote=>expect(()=>applyControl(emptyControls(),{action:'discount',amount:'10'},quote,now)).toThrow());
it('requires explicitly checked history, evidence and a valid past date',()=>{
 for(const input of [{action:'review',date:'2026-02-31',evidence:'note',historyConfirmed:true},{action:'review',date:'2026-01-01',evidence:'',historyConfirmed:true},{action:'review',date:'2026-01-01',evidence:'note',historyConfirmed:false}]) expect(()=>applyControl(emptyControls(),input,job,now)).toThrow();
});
