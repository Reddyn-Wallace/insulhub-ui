import {expect,it} from 'vitest';
import {sortQueueItems,matchesView} from './queue-view';
import type {QueueItem} from './types';
const item=(id:string,state:QueueItem['eligibility']['state'],dueAt?:string):QueueItem=>({job:{_id:id,stage:'QUOTE'},eligibility:{state,reason:'',dueAt},suggestion:null,earliestFirstApproach:null});
it('puts recovery first, then oldest due quotes; input order is unchanged',()=>{const list=[item('waiting','waiting','2027-01-01'),item('new','due','2026-09-01'),item('old','due','2026-01-01'),item('unknown','attention')];expect(sortQueueItems(list).map(x=>x.job._id)).toEqual(['unknown','old','new','waiting']);expect(list[0].job._id).toBe('waiting');});
it('pending notes remain in Needs review even after two approaches',()=>{expect(matchesView({...item('x','complete'),notePending:true},'review','2026-09-30')).toBe(true);expect(matchesView(item('x','complete'),'due','2026-09-30')).toBe(false);});
