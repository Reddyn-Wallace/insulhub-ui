import {expect,it} from 'vitest';
import {sortQueueItems,matchesView} from './queue-view';
import type {QueueItem} from './types';
const item=(id:string,state:QueueItem['eligibility']['state'],dueAt?:string):QueueItem=>({job:{_id:id,stage:'QUOTE'},eligibility:{state,reason:'',dueAt},suggestion:null,earliestFirstApproach:null});
it('puts recovery first, then oldest due quotes; input order is unchanged',()=>{const list=[item('waiting','waiting','2027-01-01'),item('new','due','2026-09-01'),item('old','due','2026-01-01'),item('unknown','attention')];expect(sortQueueItems(list).map(x=>x.job._id)).toEqual(['unknown','old','new','waiting']);expect(list[0].job._id).toBe('waiting');});
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
