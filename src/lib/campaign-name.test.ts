import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/overlay-db', () => ({ overlaySql: mocks.sql, ensureOverlaySchema: vi.fn() }));
vi.mock('@/lib/insulhub-auth', () => ({ requireInsulhubAuth: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/job-sms-access', () => ({ jobSmsIdentity: vi.fn().mockResolvedValue({ me: { _id: 'owner' } }) }));
import { POST } from '@/app/api/campaigns/route';
import { PATCH } from '@/app/api/campaigns/[id]/route';
let status: string;
beforeEach(() => {
  status = 'draft'; vi.clearAllMocks();
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?');
    if (query.includes('FROM campaigns')) return [{ id: 'campaign', name: 'Old name', status }];
    if (query.includes('UPDATE campaigns')) return [{ id: 'campaign', name: values[0], status }];
    if (query.includes('INSERT INTO campaigns')) return [{ id: 'campaign', name: values[0], status }];
    return [];
  });
});
const request = (body: unknown) => new NextRequest('http://localhost/api/campaigns/campaign', { method: 'POST', body: JSON.stringify(body) });
it.each([undefined, '', '  ', null, 42])('requires a real name at creation: %j', async name => {
  expect((await POST(request({ name, channel: 'sms' }))).status).toBe(400);
});
it.each(['draft','pending','sending','sent','failed','halted'])('renames a %s campaign without changing delivery status', async value => {
  status = value;
  const response = await PATCH(request({ name: '  October follow-up  ' }), { params: Promise.resolve({ id: 'campaign' }) });
  expect(response.status).toBe(200);
  expect((await response.json()).campaign).toMatchObject({ name: 'October follow-up', status: value });
});
it.each(['', '  ', null, 42])('rejects invalid replacement names: %j', async name => {
  expect((await PATCH(request({ name }), { params: Promise.resolve({ id: 'campaign' }) })).status).toBe(400);
});
