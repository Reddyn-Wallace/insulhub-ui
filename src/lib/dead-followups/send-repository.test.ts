import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {SendRepository} from './send-repository';
import {ControlRepository} from './repository';
import {emptyControls} from './controls';
const url=process.env.DEAD_FOLLOWUPS_TEST_DATABASE_URL;
const job={_id:'bbbbbbbbbbbbbbbbbbbbbbbb',stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',quote:{status:'DECLINED',c_total:10000}};
const input={requestId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',revision:1,jobVersion:job.updatedAt,channel:'sms',senderId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',destination:'0211234567',body:'Discount $500.00',subject:''};
describe.skipIf(!url)('durable send claims',()=>{
 let pool:Pool;let repo:SendRepository;
 beforeAll(async()=>{if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55687')throw Error('Dedicated database only');const setup=new Pool({connectionString:url});await setup.query('CREATE SCHEMA IF NOT EXISTS followup_send_test');await setup.end();pool=new Pool({connectionString:url,options:'-c search_path=followup_send_test'});repo=new SendRepository(pool);await pool.query(readFileSync('scripts/dead-followups-schema.sql','utf8'));await pool.query(readFileSync('scripts/dead-followups-send-schema.sql','utf8'));});
 beforeEach(async()=>{await pool.query('TRUNCATE dead_quote_followup_attempts,dead_quote_followup_events,dead_quote_followup_controls');await pool.query('INSERT INTO dead_quote_followup_controls(insulhub_job_id,revision,state) VALUES($1,1,$2) ON CONFLICT(insulhub_job_id) DO UPDATE SET revision=1,state=$2',[job._id,JSON.stringify({...emptyControls(),draftDiscountCents:50000,deadDate:'2026-01-01T00:00:00Z',reviewedVersion:job.updatedAt})]);});
 afterAll(async()=>{await pool?.end();});
 it('claims only once across repeated requests and simultaneous staff',async()=>{
  const results=await Promise.allSettled([repo.claim(job,input,{id:'a',name:'A'}),repo.claim(job,{...input,requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc'},{id:'b',name:'B'})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await repo.list(job._id))).toHaveLength(1);
  const won=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof repo.claim>>>;
  expect((await repo.claim(job,{...input,requestId:won.value.attempt.requestId},{id:won.value.attempt.actorId,name:'A'})).claimed).toBe(false);
 });
 it('blocks control changes during uncertain sends',async()=>{await repo.claim(job,input,{id:'a',name:'A'});await expect(new ControlRepository(pool).change(job,1,{action:'record_offer',amount:'500',date:'2026-01-01',channel:'sms',evidence:'manual'},{id:'a',name:'A'})).rejects.toThrow(/send/i);});
 it('confirmation appends exact discount once and failed notes do not undo history',async()=>{
  const {attempt}=await repo.claim(job,input,{id:'a',name:'A'});await repo.setOutcome(attempt.id,'accepted');expect((await new ControlRepository(pool).list([job._id]))[job._id].state.offers).toHaveLength(0);
  await repo.setOutcome(attempt.id,'sent');await repo.setOutcome(attempt.id,'sent');
  const saved=(await new ControlRepository(pool).list([job._id]))[job._id];
  expect(saved.state.offers).toHaveLength(1);expect(saved.state.offers[0]).toMatchObject({discountCents:50000,source:'provider_sent',attemptId:attempt.id});
  expect((await repo.list(job._id))[0].noteStatus).toBe('pending');
  await expect(new ControlRepository(pool).change(job,saved.revision,{action:'remove_latest_offer',reason:'erase'},{id:'a',name:'A'})).rejects.toThrow();
 });
 it('failed attempt does not count and allows a new explicit attempt',async()=>{const {attempt}=await repo.claim(job,input,{id:'a',name:'A'});await repo.setOutcome(attempt.id,'failed');expect((await repo.claim(job,{...input,requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc'},{id:'a',name:'A'})).claimed).toBe(true);});
});
