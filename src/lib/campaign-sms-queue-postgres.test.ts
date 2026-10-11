import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/overlay-db', () => ({ ensureOverlaySchema: vi.fn(), overlaySql: (parts: TemplateStringsArray, ...values: unknown[]) => db.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, ''), values) }));
vi.mock('@/lib/communication-settings', async original => ({ ...await original<typeof import('./communication-settings')>(), loadCommunicationSettings: vi.fn().mockResolvedValue({ campaignSendWindowEnabled: false, campaignSmsPerMinute: 30, campaignEmailDailyLimit: 100 }) }));
import { processCampaignQueue, loadCampaignQueueState, loadDueCampaignIds } from './campaign-queue';
import { loadCommunicationSettings } from './communication-settings';
describe.skipIf(!process.env.CAMPAIGN_SMS_TEST_DATABASE_URL)('SMS campaign queue in PostgreSQL', () => {
  let pool: Pool;
  const schema = `sms_test_${randomUUID().replaceAll('-', '')}`;
  const campaignId = randomUUID(), senderId = randomUUID(), recipientId = randomUUID();
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.CAMPAIGN_SMS_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE campaigns (id uuid PRIMARY KEY,status text,channel text,sender_id uuid,send_authorized_user_id text,sent_at timestamptz,updated_at timestamptz);
      CREATE TABLE communication_senders (id uuid PRIMARY KEY,owner_user_id text,channel text,provider text,connection_status text,is_active boolean,provider_config jsonb);
      CREATE TABLE campaign_recipients (id uuid PRIMARY KEY,campaign_id uuid,selected boolean,status text,failure_reason text DEFAULT '',provider_message_id text DEFAULT '',sent_at timestamptz,scheduled_at timestamptz,updated_at timestamptz,rendered_body text,contact_name text,job_number int,destination text);`);
    db.query.mockImplementation(async (sql, values) => (await pool.query(sql, values)).rows);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE campaign_recipients,campaigns,communication_senders');
    await pool.query("INSERT INTO campaigns VALUES ($1,'pending','sms',$2,'owner',NULL,now())", [campaignId,senderId]);
    await pool.query("INSERT INTO communication_senders VALUES ($1,'owner','sms','smsgate','connected',true,$2)", [senderId,{smsgateBaseUrl:'https://sms.example.test',smsgateUsername:'user',smsgatePassword:'password',smsgateDeviceId:'phone'}]);
    await pool.query("INSERT INTO campaign_recipients (id,campaign_id,selected,status,rendered_body,destination) VALUES ($1,$2,true,'pending','Hello','+64211234567')", [recipientId,campaignId]);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { if(pool) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); } });
  const recipient = async () => (await pool.query('SELECT * FROM campaign_recipients WHERE id=$1',[recipientId])).rows[0];
  const due = () => pool.query("UPDATE campaign_recipients SET scheduled_at=now()-interval '1 minute'");
  const accept = () => vi.fn(async (_url, init) => Response.json({id:JSON.parse(init.body).id,state:'Pending'}));
  it('keeps acceptance pending, polls without reposting, and finishes only on confirmation', async () => {
    const fetcher=accept();vi.stubGlobal('fetch',fetcher);
    expect((await processCampaignQueue(campaignId)).done).toBe(false);
    expect(await recipient()).toMatchObject({status:'pending',sent_at:null});
    const ref=(await recipient()).provider_message_id;expect(ref).toBeTruthy();
    expect((await loadCampaignQueueState()).pendingCount).toBe(1);
    await due();fetcher.mockImplementation(async () => Response.json({id:ref,state:'Sent'}));
    expect((await processCampaignQueue(campaignId)).done).toBe(true);
    expect((await recipient()).status).toBe('sent');
    expect(fetcher.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1);
  });
  it('defers the remaining sender queue after explicit queue rejection', async () => {
    await pool.query("INSERT INTO campaign_recipients (id,campaign_id,selected,status) VALUES ($1,$2,true,'pending')",[randomUUID(),campaignId]);
    const fetcher=vi.fn().mockResolvedValue(Response.json({error:'QueueLimitExceeded',message:'queue limits exceeded: too old pending message'},{status:503}));vi.stubGlobal('fetch',fetcher);
    await processCampaignQueue(campaignId);
    const rows=(await pool.query('SELECT * FROM campaign_recipients')).rows;
    expect(rows.every(r=>r.status==='pending' && !r.provider_message_id && r.scheduled_at > new Date())).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never reposts an uncertain submission after a timeout', async () => {
    const fetcher=vi.fn().mockRejectedValue(new Error('timeout'));vi.stubGlobal('fetch',fetcher);
    await processCampaignQueue(campaignId);await due();await processCampaignQueue(campaignId);
    expect(fetcher.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1);
    expect(await recipient()).toMatchObject({status:'pending',sent_at:null});
  });
  it('claims a recipient before network I/O so concurrent processors cannot duplicate it', async () => {
    const fetcher=vi.fn(async (_url, init) => { await new Promise(resolve => setTimeout(resolve, 40)); return Response.json({id:JSON.parse(init.body).id,state:'Pending'}); });vi.stubGlobal('fetch',fetcher);
    await Promise.all([processCampaignQueue(campaignId),processCampaignQueue(campaignId)]);
    expect(fetcher.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1);
  });
  it('continues confirmation checks for halted campaigns without sending new messages', async () => {
    vi.stubGlobal('fetch',accept());await processCampaignQueue(campaignId);
    const ref=(await recipient()).provider_message_id;
    await pool.query("UPDATE campaigns SET status='halted'");await due();
    expect(await loadDueCampaignIds()).toContain(campaignId);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({id:ref,state:'Sent'})));
    await processCampaignQueue(campaignId);
    expect((await recipient()).status).toBe('sent');
    expect((await pool.query('SELECT status FROM campaigns')).rows[0].status).toBe('halted');
  });
  it('holds a second campaign on the same sender while phone confirmation is outstanding', async () => {
    const fetcher=accept();vi.stubGlobal('fetch',fetcher);await processCampaignQueue(campaignId);
    const second=randomUUID();
    await pool.query("INSERT INTO campaigns VALUES ($1,'pending','sms',$2,'owner',NULL,now())",[second,senderId]);
    await pool.query("INSERT INTO campaign_recipients (id,campaign_id,selected,status) VALUES ($1,$2,true,'pending')",[randomUUID(),second]);
    await processCampaignQueue(second);
    expect(fetcher.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1);
    expect((await pool.query('SELECT status,provider_message_id FROM campaign_recipients WHERE campaign_id=$1',[second])).rows[0]).toEqual({status:'pending',provider_message_id:''});
  });
  it('records a definite rejection as failed and leaves it safe for an explicit retry', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({message:'Invalid number'},{status:400})));
    await processCampaignQueue(campaignId);
    expect(await recipient()).toMatchObject({status:'failed',provider_message_id:'',sent_at:null});
  });
  it('checks accepted messages outside sending hours', async () => {
    vi.stubGlobal('fetch',accept());await processCampaignQueue(campaignId);const ref=(await recipient()).provider_message_id;await due();
    vi.mocked(loadCommunicationSettings).mockResolvedValueOnce({campaignSendWindowEnabled:true,campaignSendWindowStartTime:'00:00',campaignSendWindowEndTime:'00:00',campaignSmsPerMinute:30,campaignEmailDailyLimit:100});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({id:ref,state:'Failed',reason:'Expired'})));
    await processCampaignQueue(campaignId);
    expect(await recipient()).toMatchObject({status:'failed',failure_reason:'Expired',sent_at:null});
  });
});
