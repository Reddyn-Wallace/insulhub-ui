import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {DateRepository} from './date-repository';
const url=process.env.DEAD_FOLLOWUPS_TEST_DATABASE_URL;
const actor={id:'staff',name:'Staff'};
const dead={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',quote:{date:'2026-02-01',status:'DECLINED'},lead:{leadStatus:'DEAD'}};
const open={...dead,quote:{...dead.quote,status:'UNSET'},lead:{leadStatus:'NEW'}};
describe.skipIf(!url)('durable UI date history',()=>{
 let pool:Pool;let repo:DateRepository;
 beforeAll(async()=>{if(!url||new URL(url).port!=='55687'||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Local only');
 const setup=new Pool({connectionString:url});await setup.query('DROP SCHEMA IF EXISTS date_tests CASCADE');await setup.query('CREATE SCHEMA date_tests');await setup.end();
 pool=new Pool({connectionString:url,options:'-c search_path=date_tests'});repo=new DateRepository(pool);
 for(const name of ['schema','date-schema'])await pool.query(readFileSync(`scripts/dead-followups-${name}.sql`,'utf8'));
 });
 afterAll(async()=>{await pool?.end();});
 it('freezes assumptions instead of shifting with later notes',async()=>{
  const first=await repo.attach(dead,true);const next=await repo.attach({...dead,notes:'01/09/26 - follow up note'},true);
  expect(first.deadEntry?.source).toBe('quote_plus_30');expect(next.deadEntry).toEqual(first.deadEntry);
 });
 it('records confirmed entry/re-entry, excludes no-op/failed changes, and preserves immutable history',async()=>{
  await repo.capture(open._id,async()=>open,async()=>({data:{updateJob:{_id:open._id}}}),async()=>open,actor);
  await repo.capture(open._id,async()=>open,async()=>({data:{updateJob:{_id:open._id}}}),async()=>dead,actor);
  const first=(await repo.attach(dead,false)).deadEntry;expect(first?.source).toBe('ui_transition');
  await repo.capture(dead._id,async()=>dead,async()=>({data:{updateJob:{_id:dead._id}}}),async()=>dead,actor);
  await repo.capture(dead._id,async()=>dead,async()=>({data:{updateJob:{_id:dead._id}}}),async()=>open,actor);
  await repo.capture(dead._id,async()=>open,async()=>({errors:[{message:'Rejected'}]}),async()=>open,actor);
  await repo.capture(dead._id,async()=>open,async()=>({data:{updateJob:{_id:dead._id}}}),async()=>dead,actor);
  const rows=await pool.query("SELECT kind FROM dead_quote_date_events WHERE kind<>'assumed' ORDER BY id");
  expect(rows.rows.map(x=>x.kind)).toEqual(['entered','left','entered']);
  await expect(pool.query('DELETE FROM dead_quote_date_events')).rejects.toThrow('immutable');
 });
 it('persists uncertainty before dispatch and never retries a lost mutation',async()=>{
  let calls=0;
  await expect(repo.capture(dead._id,async()=>dead,async()=>{calls++;throw Error('Lost reply');},async()=>open,actor)).rejects.toThrow();
  expect(calls).toBe(1);expect((await repo.attach(dead,false)).deadDateUncertain).toBe(true);
  await expect(repo.capture(dead._id,async()=>dead,async()=>{calls++;return {};},async()=>dead,actor)).rejects.toThrow(/Refresh|checking/);
  expect(calls).toBe(1);
 });
 it('recovers an interrupted entry conservatively without repeating the job mutation',async()=>{
  const id='cccccccccccccccccccccccc';const initial={...open,_id:id};const final={...dead,_id:id};
  await expect(repo.capture(id,async()=>initial,async()=>{throw Error('Lost');},async()=>final,actor)).rejects.toThrow();
  await expect(repo.reconcile(id,async()=>final)).rejects.toThrow(/minute/);
  await pool.query("UPDATE dead_quote_dates SET updated_at=now()-interval '2 minutes' WHERE insulhub_job_id=$1",[id]);
  await repo.reconcile(id,async()=>final);const result=await repo.attach(final,false);
  expect(result.deadDateUncertain).toBe(false);expect(result.deadEntry?.source).toBe('ui_recovery');
  expect(Date.now()-Date.parse(result.deadEntry!.at)).toBeLessThan(10000);
  await repo.reconcile(id,async()=>final);
  expect((await pool.query("SELECT * FROM dead_quote_date_events WHERE insulhub_job_id=$1 AND kind='recovered'",[id])).rows).toHaveLength(1);
 });
 it('serialises simultaneous saves and retains one entry event',async()=>{
  const id='dddddddddddddddddddddddd';let release!:()=>void;let entered!:()=>void;
  const signal=new Promise<void>(resolve=>{entered=resolve;});const hold=new Promise<void>(resolve=>{release=resolve;});
  const first=repo.capture(id,async()=>({...open,_id:id}),async()=>{entered();await hold;return {};},async()=>({...dead,_id:id}),actor);
  await signal;
  try{await expect(repo.capture(id,async()=>({...open,_id:id}),async()=>({}),async()=>({...dead,_id:id}),actor)).rejects.toThrow(/being saved/);}finally{release();}
  await first;expect((await pool.query("SELECT * FROM dead_quote_date_events WHERE insulhub_job_id=$1 AND kind='entered'",[id])).rows).toHaveLength(1);
 });
 it('batch-freezes first observations without duplicating or overwriting provenance',async()=>{
  const input=[{...dead,_id:'eeeeeeeeeeeeeeeeeeeeeeee'},{...dead,_id:'ffffffffffffffffffffffff',notes:'01/05/26 - Last note'}];
  const first=await repo.attachMany(input,true);const second=await repo.attachMany(input.map(j=>({...j,notes:'01/09/26 - Later note'})),true);
  expect(second.map(j=>j.deadEntry)).toEqual(first.map(j=>j.deadEntry));
  expect((await pool.query("SELECT * FROM dead_quote_date_events WHERE insulhub_job_id=ANY($1::text[])",[input.map(j=>j._id)])).rows).toHaveLength(2);
 });

});
