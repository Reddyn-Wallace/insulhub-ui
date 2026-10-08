import {expect,it} from 'vitest';
import {sortQueueItems,matchesView,waitingLabel} from './queue-view';
import type {QueueItem} from './types';
const item=(id:string,state:QueueItem['eligibility']['state'],dueAt?:string):QueueItem=>({job:{_id:id,stage:'QUOTE'},eligibility:{state,reason:'',dueAt},suggestion:null,earliestFirstApproach:null});
it('pending notes remain in Needs review even after two approaches',()=>{expect(matchesView({...item('x','complete'),notePending:true},'review','2026-09-30')).toBe(true);expect(matchesView(item('x','complete'),'due','2026-09-30')).toBe(false);});

import {needsFollowup} from './queue-view';
import {emptyControls} from './controls';
it('shows only due work while still allowing overdue quotes to have their offer history checked',()=>{
 const row={...item('x','review'),job:{_id:'x',stage:'QUOTE',updatedAt:'v',quote:{date:'2026-01-01',status:'DECLINED'},deadEntry:{at:'2026-02-01T00:00:00Z',source:'ui_transition' as const,evidence:'UI'}},controls:{revision:0,state:emptyControls(),actorName:'',updatedAt:null}};
 expect(needsFollowup(row,'2026-10-04T00:00:00Z')).toBe(true);
 expect(needsFollowup({...row,job:{...row.job,deadEntry:{...row.job.deadEntry,at:'2026-09-30T00:00:00Z'}}},'2026-10-04T00:00:00Z')).toBe(false);
 for(const state of [{...row.controls.state,exclusionReason:'No'}, {...row.controls.state,snoozedUntil:'2026-11-01T00:00:00Z'}])expect(needsFollowup({...row,controls:{...row.controls,state}},'2026-10-04T00:00:00Z')).toBe(false);
 expect(needsFollowup({...row,eligibility:{state:'attention',reason:'Pending send'}},'2026-10-04T00:00:00Z')).toBe(false);
});

it('orders by longest time in Dead or since first offer, regardless of review status',()=>{
 const first={...item('first','review'),job:{_id:'first',stage:'QUOTE',deadEntry:{at:'2026-01-01T00:00:00Z',source:'last_note' as const,evidence:'Note'}}};
 const second={...item('second','due'),controls:{revision:1,actorName:'',updatedAt:null,state:{...emptyControls(),offers:[{number:1 as const,sentAt:'2026-03-01T00:00:00Z',discountCents:50000,channel:'sms' as const,source:'provider_sent' as const,evidence:'Sent'}]}}};
 const input=[second,item('unknown','review'),first];expect(sortQueueItems(input).map(x=>x.job._id)).toEqual(['first','second','unknown']);expect(input[0]).toBe(second);
 expect(waitingLabel(first,'2026-10-08T00:00:00Z')).toBe('In Dead for 280 days');expect(waitingLabel(second,'2026-10-08T00:00:00Z')).toBe('221 days since first follow-up');
});
it('counts NZ calendar days across daylight saving and handles missing dates',()=>{const row={...item('x','review'),job:{_id:'x',stage:'QUOTE',deadEntry:{at:'2026-09-26T12:00:00Z',source:'ui_transition' as const,evidence:'UI'}}};expect(waitingLabel(row,'2026-09-27T11:00:00Z')).toBe('In Dead for 1 day');expect(waitingLabel(item('none','review'),'2026-10-08')).toBeNull();});
