// Run against a disposable local database with CAMPAIGN_RESUME_TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/overlay-db', () => ({
  ensureOverlaySchema: vi.fn(),
  overlaySql: (parts: TemplateStringsArray, ...values: unknown[]) => database.query(parts.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, ''), values),
}));
vi.mock('@/lib/insulhub-auth', () => ({ requireInsulhubAuth: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/job-sms-access', () => ({ jobSmsIdentity: vi.fn().mockResolvedValue({ me: { _id: 'owner' } }) }));
vi.mock('@/lib/campaign-scheduler', () => ({ activateCampaignScheduler: vi.fn().mockResolvedValue({ activated: true }) }));
vi.mock('@/lib/communication-settings', async original => ({
  ...await original<typeof import('./communication-settings')>(),
  loadCommunicationSettings: vi.fn().mockResolvedValue({ campaignSendWindowEnabled: false, campaignSmsPerMinute: 6, campaignEmailDailyLimit: 100 }),
}));
vi.mock('@/lib/communication-delivery', () => ({ deliverCommunication: vi.fn().mockResolvedValue({ ok: true, providerMessageId: 'retried-message' }) }));
import { processCampaignQueue } from './campaign-queue';
import { PATCH } from '@/app/api/campaigns/[id]/route';

describe.skipIf(!process.env.CAMPAIGN_RESUME_TEST_DATABASE_URL)('campaign resume in PostgreSQL', () => {
  let pool: Pool;
  const schema = `resume_test_${randomUUID().replaceAll('-', '')}`;
  const campaignId = randomUUID();
  const senderId = randomUUID();
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.CAMPAIGN_RESUME_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE campaigns (id uuid PRIMARY KEY, status text, channel text, sender_id uuid, send_authorized_user_id text, sent_at timestamptz, updated_at timestamptz);
      CREATE TABLE communication_senders (id uuid PRIMARY KEY, owner_user_id text, channel text, provider text, connection_status text, is_active boolean);
      CREATE TABLE campaign_recipients (id uuid PRIMARY KEY, campaign_id uuid, selected boolean, status text, failure_reason text DEFAULT '', provider_message_id text DEFAULT '', sent_at timestamptz, scheduled_at timestamptz, updated_at timestamptz, rendered_body text, contact_name text, job_number int);
    `);
    database.query.mockImplementation(async (sql, values) => (await pool.query(sql, values)).rows);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE campaign_recipients, campaigns, communication_senders');
    await pool.query("INSERT INTO campaigns (id,status,channel,sender_id) VALUES ($1,'halted','sms',$2)", [campaignId, senderId]);
    await pool.query("INSERT INTO communication_senders VALUES ($1,'owner','sms','smsgate','connected',true)", [senderId]);
    for (let i = 0; i < 30; i++) {
      const status = i < 9 ? 'sent' : i < 28 ? 'skipped' : i === 28 ? 'failed' : 'skipped';
      await pool.query(`INSERT INTO campaign_recipients
        (id,campaign_id,selected,status,failure_reason,provider_message_id,sent_at,rendered_body,contact_name)
        VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), campaignId, status, i >= 9 && i < 28 ? 'Campaign halted before delivery.' : 'Other reason', i < 9 ? `sent-${i}` : '', i < 9 ? '2026-10-01T00:00:00Z' : null, `Original message ${i}`, `Customer ${i}`]);
    }
  });
  afterAll(async () => {
    if (pool) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); }
  });
  const resume = () => PATCH(new NextRequest(`http://localhost/api/campaigns/${campaignId}`, { method: 'PATCH', body: JSON.stringify({ resumeCampaign: true }) }), { params: Promise.resolve({ id: campaignId }) });
  const retry = (recipientIds?: string[]) => PATCH(new NextRequest(`http://localhost/api/campaigns/${campaignId}`, { method: 'PATCH', body: JSON.stringify({ retryFailed: true, recipientIds }) }), { params: Promise.resolve({ id: campaignId }) });
  it('retries only the selected failed recipient and preserves all other records', async () => {
    const otherId = randomUUID();
    await pool.query("INSERT INTO campaign_recipients (id,campaign_id,selected,status,rendered_body) VALUES ($1,$2,true,'failed','Other failed message')", [otherId, campaignId]);
    const before = (await pool.query('SELECT * FROM campaign_recipients ORDER BY id')).rows;
    const failedId = before.find(row => row.status === 'failed' && row.id !== otherId).id;
    const response = await retry([failedId]);
    expect(response.status).toBe(200);
    expect((await response.json()).sendResult).toContain('1 recipient');
    const after = (await pool.query('SELECT * FROM campaign_recipients ORDER BY id')).rows;
    after.forEach((row, index) => {
      if (row.id !== failedId) expect(row).toEqual(before[index]);
      else { expect(row.status).toBe('pending'); expect(row.rendered_body).toBe(before[index].rendered_body); }
    });
  });
  it('keeps halted recipients resumable after a failed delivery is retried successfully', async () => {
    expect((await retry()).status).toBe(200);
    const result = await processCampaignQueue(campaignId, 'owner');
    expect(result.processedCount).toBe(1);
    expect(result.campaign.status).toBe('halted');
    expect((await resume()).status).toBe(200);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM campaign_recipients WHERE status='pending'")).rows[0].count).toBe(19);
  });
  it.each(['halted', 'sending'])('does not duplicate concurrent retries while campaign is %s', async status => {
    await pool.query('UPDATE campaigns SET status=$1', [status]);
    const responses = await Promise.all([retry(), retry()]);
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM campaign_recipients WHERE status='pending'")).rows[0].count).toBe(1);
  });
  it('places retries after existing scheduled recipients without changing their schedules', async () => {
    await pool.query("UPDATE campaigns SET status='sending'");
    const pendingId = randomUUID();
    const scheduledAt = new Date(Date.now() + 60000);
    await pool.query("INSERT INTO campaign_recipients (id,campaign_id,selected,status,scheduled_at) VALUES ($1,$2,true,'pending',$3)", [pendingId, campaignId, scheduledAt]);
    expect((await retry()).status).toBe(200);
    const pending = (await pool.query("SELECT * FROM campaign_recipients WHERE status='pending'")).rows;
    expect(pending.find(row => row.id === pendingId).scheduled_at).toEqual(scheduledAt);
    expect(pending.find(row => row.id !== pendingId).scheduled_at.getTime()).toBe(scheduledAt.getTime() + 10000);
  });
  it('preserves nine sent records and requeues nineteen halted records without altering messages or unrelated outcomes', async () => {
    const before = (await pool.query('SELECT * FROM campaign_recipients ORDER BY id')).rows;
    expect((await resume()).status).toBe(200);
    const after = (await pool.query('SELECT * FROM campaign_recipients ORDER BY id')).rows;
    expect(after.filter(row => row.status === 'pending')).toHaveLength(19);
    after.forEach((row, index) => {
      if (before[index].failure_reason !== 'Campaign halted before delivery.') expect(row).toEqual(before[index]);
      else {
        expect(row.rendered_body).toBe(before[index].rendered_body);
        expect(row.failure_reason).toBe('');
        expect(row.scheduled_at).toBeInstanceOf(Date);
      }
    });
    expect((await pool.query('SELECT status, send_authorized_user_id FROM campaigns')).rows).toEqual([{ status: 'pending', send_authorized_user_id: 'owner' }]);
  });
  it('allows only one concurrent resume and leaves the queued schedules intact on a repeat', async () => {
    const responses = await Promise.all([resume(), resume()]);
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(responses.filter(response => response.status === 400 || response.status === 409)).toHaveLength(1);
    const before = (await pool.query('SELECT * FROM campaign_recipients ORDER BY id')).rows;
    expect((await resume()).status).toBe(400);
    expect((await pool.query('SELECT * FROM campaign_recipients ORDER BY id')).rows).toEqual(before);
  });
});
