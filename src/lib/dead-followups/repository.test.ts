import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {ControlRepository} from './repository';
const url=process.env.DEAD_FOLLOWUPS_TEST_DATABASE_URL;
const job={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',quote:{date:'2026-01-01',status:'DECLINED',c_total:10000},lead:{leadStatus:'DEAD'}};
describe.skipIf(!url)('real Postgres control persistence',()=>{
 let pool:Pool;let repo:ControlRepository;
 beforeAll(async()=>{if(!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname) || new URL(url).port!=='55687')throw Error('Dedicated local test database only');pool=new Pool({connectionString:url});repo=new ControlRepository(pool);const sql=readFileSync('scripts/dead-followups-schema.sql','utf8');await pool.query(sql);await pool.query(sql);});
 beforeEach(async()=>{await pool.query('TRUNCATE dead_quote_followup_events,dead_quote_followup_controls');});
 afterAll(async()=>{await pool?.end();});
 it('round trips a draft and an immutable audit snapshot',async()=>{
  const result=await repo.change(job,0,{action:'discount',amount:'500'},{id:'staff',name:'Staff Member'});
  expect(result.revision).toBe(1);expect((await repo.list([job._id]))[job._id].state.draftDiscountCents).toBe(50000);
  const events=await repo.events(job._id);expect(events[0]).toMatchObject({action:'discount',actorName:'Staff Member',state:{draftDiscountCents:50000}});
  await expect(pool.query('DELETE FROM dead_quote_followup_events')).rejects.toThrow('immutable');
 });
 it('allows only one of two simultaneous staff changes at the same revision',async()=>{
  const results=await Promise.allSettled([repo.change(job,0,{action:'discount',amount:'100'},{id:'one',name:'One'}),repo.change(job,0,{action:'discount',amount:'200'},{id:'two',name:'Two'})]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
  expect(await repo.events(job._id)).toHaveLength(1);
 });
 it('rolls back control state if the audit write fails',async()=>{
  await pool.query("ALTER TABLE dead_quote_followup_events ADD CONSTRAINT test_reject_actor CHECK (actor_id <> 'reject')");
  try{await expect(repo.change(job,0,{action:'discount',amount:'100'},{id:'reject',name:'Staff'})).rejects.toThrow();expect((await repo.list([job._id]))[job._id]).toBeUndefined();}
  finally{await pool.query('ALTER TABLE dead_quote_followup_events DROP CONSTRAINT test_reject_actor');}
 });
 it('keeps original historical offer evidence after a correction',async()=>{
  await repo.change(job,0,{action:'record_offer',date:'2026-01-01',amount:'500',channel:'sms',evidence:'Phone sent history'},{id:'staff',name:'Staff'});
  await repo.change(job,1,{action:'remove_latest_offer',reason:'Wrong quote'},{id:'staff',name:'Staff'});
  const events=await repo.events(job._id);expect(events[1].state.offers[0].discountCents).toBe(50000);expect(events[0].reason).toBe('Wrong quote');
 });
});
