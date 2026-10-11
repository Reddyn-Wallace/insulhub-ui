// Run against a disposable database with CAMPAIGN_RESUME_TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/overlay-db', () => ({ ensureOverlaySchema: vi.fn(), overlaySql: (parts: TemplateStringsArray, ...values: unknown[]) => database.query(parts.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, ''), values) }));
vi.mock('@/lib/insulhub-auth', () => ({ requireInsulhubAuth: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/job-sms-access', () => ({ jobSmsIdentity: vi.fn().mockResolvedValue({ me: { _id: 'owner' } }) }));
import { PATCH } from '@/app/api/campaigns/[id]/route';
import { GET as listCampaigns } from '@/app/api/campaigns/route';
import { GET as exclusions } from '@/app/api/campaigns/exclusions/route';

describe.skipIf(!process.env.CAMPAIGN_RESUME_TEST_DATABASE_URL)('campaign audiences in PostgreSQL', () => {
  let pool: Pool;
  const schema = `audience_test_${randomUUID().replaceAll('-', '')}`;
  const currentId = randomUUID(), oldId = randomUUID();
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.CAMPAIGN_RESUME_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE campaigns (id uuid PRIMARY KEY, name text, status text, channel text, recipient_count int DEFAULT 0, archived_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE campaign_recipients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid, insulhub_job_id text, selected boolean DEFAULT true, status text DEFAULT 'pending', destination text, contact_name text, job_number int, address text, salesperson_name text, job_stage text, quote_date timestamptz, updated_at timestamptz DEFAULT now(), UNIQUE(campaign_id,insulhub_job_id));
    `);
    database.query.mockImplementation(async (sql, values) => (await pool.query(sql, values)).rows);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE campaign_recipients, campaigns');
    await pool.query("INSERT INTO campaigns (id,name,status,channel) VALUES ($1,'New campaign','draft','sms'),($2,'Archived campaign','sent','sms')", [currentId, oldId]);
    await pool.query('UPDATE campaigns SET archived_at=now() WHERE id=$1', [oldId]);
    for (const [jobId, destination, status, selected] of [
      ['sent-job', '+64 21 123 4567', 'sent', true],
      ['failed-job', '+64212222222', 'failed', true],
      ['skipped-job', '+64213333333', 'skipped', true],
      ['pending-job', '+64214444444', 'pending', true],
      ['unselected-job', '+64215555555', 'sent', false],
    ]) await pool.query('INSERT INTO campaign_recipients (campaign_id,insulhub_job_id,destination,status,selected) VALUES ($1,$2,$3,$4,$5)', [oldId, jobId, destination, status, selected]);
  });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); } });
  const patch = (body: unknown) => PATCH(new NextRequest(`http://localhost/api/campaigns/${currentId}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: currentId }) });
  it('lists active, archived, and combined campaigns with sent counts', async () => {
    for (const [query, ids] of [['', [currentId]], ['?archived=true', [oldId]], ['?includeArchived=true', [currentId, oldId]]] as const) {
      const response = await listCampaigns(new NextRequest(`http://localhost/api/campaigns${query}`));
      expect(response.status).toBe(200);
      const campaigns = (await response.json()).campaigns;
      expect(campaigns.map((row: { id: string }) => row.id).sort()).toEqual([...ids].sort());
      if (ids.includes(oldId)) expect(campaigns.find((row: { id: string }) => row.id === oldId).sentCount).toBe(1);
    }
  });
  it('uses only selected sent recipients from archived campaigns for exclusions', async () => {
    const response = await exclusions(new NextRequest(`http://localhost/api/campaigns/exclusions?campaignId=${oldId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).recipients).toEqual([{ jobId: 'sent-job', destination: '+64 21 123 4567', channel: 'sms' }]);
  });
  it('checks exclusions at save time and keeps failed and skipped people eligible', async () => {
    const response = await patch({ mode: 'add', excludedCampaignIds: [oldId], recipients: [
      { jobId: 'sent-job', destination: '+64216666666' },
      { jobId: 'different-job', destination: '021 123 4567' },
      { jobId: 'failed-job', destination: '+64212222222' },
      { jobId: 'skipped-job', destination: '+64213333333' },
      { jobId: 'new-job', destination: '+64219999999' },
    ] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.excludedCount).toBe(2);
    expect(body.recipients.map((row: { jobId: string }) => row.jobId).sort()).toEqual(['failed-job','new-job','skipped-job']);
    expect(body.campaign.recipientCount).toBe(3);
  });
  it('rejects missing exclusion campaigns before replacing any saved audience', async () => {
    await pool.query("INSERT INTO campaign_recipients (campaign_id,insulhub_job_id,destination) VALUES ($1,'keep-job','+64219999999')", [currentId]);
    expect((await patch({ mode: 'replace', excludedCampaignIds: [randomUUID()], recipients: [] })).status).toBe(400);
    expect((await pool.query('SELECT insulhub_job_id FROM campaign_recipients WHERE campaign_id=$1', [currentId])).rows).toEqual([{ insulhub_job_id: 'keep-job' }]);
  });
  it('rejects excluding the target campaign itself', async () => {
    expect((await patch({ excludedCampaignIds: [currentId], recipients: [] })).status).toBe(400);
  });
  it('allows only the name to change after a campaign has started', async () => {
    await pool.query("UPDATE campaigns SET status='sending' WHERE id=$1", [currentId]);
    expect((await patch({ name: '  Better name  ' })).status).toBe(200);
    expect((await patch({ recipients: [{ jobId: 'new-job', destination: '+64219999999' }] })).status).toBe(400);
    expect((await pool.query('SELECT name,status FROM campaigns WHERE id=$1', [currentId])).rows).toEqual([{ name: 'Better name', status: 'sending' }]);
  });
});
