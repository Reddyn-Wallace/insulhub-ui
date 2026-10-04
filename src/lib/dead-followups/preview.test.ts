import {expect,it} from 'vitest';
import {FollowupPreview} from '../../../scripts/lib/followup-preview';
const now='2026-10-04T00:00:00.000Z';
const sender='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
it('supports an actual editable preview with both first and second approaches',()=>{
 const demo=new FollowupPreview(undefined,()=>now);const queue=demo.queue();
 expect(queue.preview).toBe(true);expect(queue.readOnly).toBe(false);
 expect(queue.items.filter(x=>x.eligibility.state==='due').map(x=>x.eligibility.approach)).toEqual([1,2]);
});
it('simulates an offer exactly once, retains discount in notes, and persists across reload',()=>{
 const demo=new FollowupPreview(undefined,()=>now);const item=demo.queue().items[0];
 const input={action:'send',requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc',revision:item.controls!.revision,jobVersion:item.job.updatedAt,channel:'sms',senderId:sender,destination:item.job.client!.contactDetails!.phoneMobile,body:'Sample offer $500.00 off.',subject:''};
 const first=demo.send(item.job._id,input);expect(first.attempt.status).toBe('sent');expect(demo.send(item.job._id,input).attempt.id).toBe(first.attempt.id);
 const loaded=new FollowupPreview(JSON.parse(JSON.stringify(demo.state)),()=>now);const saved=loaded.queue().items[0];
 expect(saved.controls!.state.offers).toHaveLength(1);expect(saved.job.notes).toContain('NZD $500.00');
 expect(saved.job.notes!.match(/Discount offered:/g)).toHaveLength(1);
});
it('uses production validation for edits and cannot forward unknown actions',()=>{
 const demo=new FollowupPreview(undefined,()=>now);const row=demo.queue().items[0];
 expect(()=>demo.change(row.job._id,{revision:row.controls!.revision,jobVersion:row.job.updatedAt!,command:{action:'discount',amount:'999999'}})).toThrow();
 expect(()=>demo.send(row.job._id,{action:'arbitrary'})).toThrow();
});
it('keeps earlier audit snapshots unchanged after a simulated send',()=>{
 const demo=new FollowupPreview(undefined,()=>now);const item=demo.queue().items[0];
 const updated=demo.change(item.job._id,{revision:item.controls!.revision,jobVersion:item.job.updatedAt!,command:{action:'discount',amount:'600'}});
 demo.send(item.job._id,{action:'send',requestId:'dddddddd-dddd-4ddd-dddd-dddddddddddd',revision:updated.record.revision,jobVersion:item.job.updatedAt,channel:'sms',senderId:sender,destination:item.job.client!.contactDetails!.phoneMobile,body:'Sample $600.00 discount.',subject:''});
 expect(demo.history(item.job._id).events[0].state.offers).toHaveLength(0);
});
it('returns dated template audit records',()=>{
 const demo=new FollowupPreview(undefined,()=>now);const result=demo.templateWrite({revision:0,templates:demo.templateRead().record.templates});
 expect(result.events[0]).toMatchObject({createdAt:now});
});
