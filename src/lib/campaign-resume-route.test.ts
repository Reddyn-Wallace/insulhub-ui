import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), activate: vi.fn() }));
vi.mock('@/lib/overlay-db', () => ({ overlaySql: mocks.sql, ensureOverlaySchema: vi.fn() }));
vi.mock('@/lib/insulhub-auth', () => ({ requireInsulhubAuth: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/job-sms-access', () => ({ jobSmsIdentity: vi.fn().mockResolvedValue({ me: { _id: 'owner' } }) }));
vi.mock('@/lib/campaign-scheduler', () => ({ activateCampaignScheduler: mocks.activate }));
vi.mock('@/lib/communication-settings', async importOriginal => ({
  ...await importOriginal<typeof import('./communication-settings')>(),
  loadCommunicationSettings: vi.fn().mockResolvedValue({ campaignSendWindowEnabled: false, campaignSmsPerMinute: 6, campaignEmailDailyLimit: 100 }),
}));
import { PATCH } from '@/app/api/campaigns/[id]/route';
let status: string;
let sender: Record<string, unknown> | null;
let recipients: Record<string, unknown>[];
let queued: { id: string; scheduled_at: string }[];
let conflict: boolean;
beforeEach(() => {
  vi.clearAllMocks(); status = 'halted'; conflict = false; queued = [];
  sender = { id: 'sender', channel: 'sms', provider: 'smsgate', connection_status: 'connected' };
  recipients = [
    { id: 'sent', selected: true, status: 'sent', sent_at: '2026-10-01', provider_message_id: 'existing-id' },
    { id: 'resume-1', selected: true, status: 'skipped', failure_reason: 'Campaign halted before delivery.', rendered_body: 'Original personalised message' },
    { id: 'resume-2', selected: true, status: 'skipped', failure_reason: 'Campaign halted before delivery.' },
    { id: 'failed', selected: true, status: 'failed' },
    { id: 'other-skip', selected: true, status: 'skipped', failure_reason: 'Invalid destination' },
  ];
  mocks.activate.mockResolvedValue({ activated: true });
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?');
    if (query.includes('WITH incoming')) {
      queued = JSON.parse(values.find(v => typeof v === 'string' && v.startsWith('[')) as string);
      return conflict ? [] : [{ id: 'campaign', status: 'pending', channel: 'sms', sender_id: 'sender', requeued_count: queued.length }];
    }
    if (query.includes('FROM communication_senders')) return sender ? [sender] : [];
    if (query.includes('FROM campaigns') && query.includes('LIMIT 1')) return [{ id: 'campaign', status, channel: 'sms', sender_id: 'sender' }];
    if (query.includes('FROM campaign_recipients') && !query.includes('COUNT')) return recipients;
    return [{ pending_count: 2, next_run_at: new Date().toISOString() }];
  });
});
const resume = () => PATCH(new NextRequest('http://localhost/api/campaigns/campaign', { method: 'PATCH', body: JSON.stringify({ resumeCampaign: true }) }), { params: Promise.resolve({ id: 'campaign' }) });
it('requeues only halted recipients with fresh staggered schedules and activates delivery', async () => {
  const response = await resume();
  expect(response.status).toBe(200);
  expect((await response.json()).campaign.status).toBe('pending');
  expect(queued.map(r => r.id)).toEqual(['resume-1', 'resume-2']);
  expect(Date.parse(queued[1].scheduled_at) - Date.parse(queued[0].scheduled_at)).toBe(10000);
  expect(mocks.activate).toHaveBeenCalled();
});
it.each(['draft', 'pending', 'sending', 'sent', 'failed'])('rejects resume for %s campaigns', async value => {
  status = value; expect((await resume()).status).toBe(400); expect(queued).toEqual([]);
});
it('rejects a sender belonging to someone else', async () => {
  sender = null; expect((await resume()).status).toBe(403); expect(queued).toEqual([]);
});
it('rejects a disconnected sender', async () => {
  sender!.connection_status = 'disconnected'; expect((await resume()).status).toBe(400); expect(queued).toEqual([]);
});
it('rejects a halted campaign with no remaining halted recipients', async () => {
  recipients = [recipients[0]]; expect((await resume()).status).toBe(400); expect(queued).toEqual([]);
});
it('does not activate delivery when another request has already resumed the campaign', async () => {
  conflict = true; expect((await resume()).status).toBe(409); expect(mocks.activate).not.toHaveBeenCalled();
});
it('reports scheduler failures while retaining the resumed campaign', async () => {
  mocks.activate.mockResolvedValue({ activated: false });
  const response = await resume();
  expect(response.status).toBe(200); expect((await response.json()).sendResult).toMatch(/Process Due/);
});

const retry = (recipientIds?: unknown) => PATCH(new NextRequest('http://localhost/api/campaigns/campaign', { method: 'PATCH', body: JSON.stringify({ retryFailed: true, ...(recipientIds === undefined ? {} : { recipientIds }) }) }), { params: Promise.resolve({ id: 'campaign' }) });
it('retries all failed recipients without requeuing sent or halted recipients', async () => {
  status = 'sent';
  expect((await retry()).status).toBe(200);
  expect(queued.map(row => row.id)).toEqual(['failed']);
});
it('retries only the selected failures', async () => {
  status = 'failed'; recipients.push({ id: 'failed-2', selected: true, status: 'failed' });
  expect((await retry(['failed-2'])).status).toBe(200);
  expect(queued.map(row => row.id)).toEqual(['failed-2']);
});
it.each([[], ['sent'], ['foreign-id'], 'failed'])('rejects invalid retry selection %j', async selection => {
  expect((await retry(selection)).status).toBe(400); expect(queued).toEqual([]);
});
it('does not retry a failure with recorded delivery evidence', async () => {
  recipients = [{ id: 'failed', selected: true, status: 'failed', provider_message_id: 'accepted-id' }];
  expect((await retry()).status).toBe(400); expect(queued).toEqual([]);
});
it('rejects retry by someone other than the sender owner', async () => {
  sender = null; expect((await retry()).status).toBe(403); expect(queued).toEqual([]);
});
it('rejects retry on a draft campaign', async () => {
  status = 'draft'; expect((await retry()).status).toBe(400); expect(queued).toEqual([]);
});
