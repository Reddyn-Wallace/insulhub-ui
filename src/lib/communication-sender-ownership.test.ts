import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { newDb } from 'pg-mem';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), identity: vi.fn(), test: vi.fn() }));
vi.mock('@/lib/overlay-db', () => ({ overlaySql: mocks.sql, ensureOverlaySchema: vi.fn() }));
vi.mock('@/lib/job-sms-access', () => ({ jobSmsIdentity: mocks.identity }));
vi.mock('@/lib/insulhub-auth', () => ({ requireInsulhubAuth: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/communication-delivery', () => ({ testCommunicationConnection: mocks.test }));
import { GET, POST } from '@/app/api/communication-senders/route';
import { PATCH, DELETE } from '@/app/api/communication-senders/[id]/route';
let pool: InstanceType<ReturnType<ReturnType<typeof newDb>['adapters']['createPg']>['Pool']>;
const own = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/communication-senders', { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
beforeEach(async () => {
  vi.clearAllMocks(); mocks.identity.mockResolvedValue({ me: { _id: 'reddyn' } }); mocks.test.mockResolvedValue({ ok: true });
  const db = newDb(); pool = new (db.adapters.createPg().Pool)();
  await pool.query(`CREATE TABLE communication_senders (
    id uuid DEFAULT '33333333-3333-4333-8333-333333333333' PRIMARY KEY, owner_user_id text,
    channel text, label text, sender_value text, provider text, provider_config jsonb DEFAULT '{}',
    provider_access_token text, provider_refresh_token text, provider_token_expires_at timestamp,
    connection_status text, connected_at timestamp, last_tested_at timestamp,
    is_default boolean, is_active boolean, created_at timestamp, updated_at timestamp);
    INSERT INTO communication_senders(id,owner_user_id,channel,label,sender_value,provider,is_default,is_active)
    VALUES ('${own}','reddyn','email','Reddyn','reddyn@example.com','gmail',false,true),
      ('${other}','andrew','email','Andrew','andrew@example.com','gmail',true,true);`);
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) =>
    (await pool.query(parts.reduce((q, p, i) => q + (i ? `$${i}` : '') + p, ''), values)).rows);
});
it('lists only the signed-in account’s connections', async () => {
  const body = await (await GET(req('GET'))).json(); expect(body.senders.map((s: {id:string}) => s.id)).toEqual([own]);
});
it('assigns new connections to the authenticated account, ignoring a supplied owner', async () => {
  expect((await POST(req('POST', { channel:'email',label:'New',provider:'gmail',ownerUserId:'andrew' }))).status).toBe(201);
  expect((await pool.query("SELECT owner_user_id FROM communication_senders WHERE label='New'")).rows[0].owner_user_id).toBe('reddyn');
});
it.each([{label:'Changed'}, {test:true}, {disconnect:true}, {isDefault:true}])('blocks modifying another account’s connection: %j', async body => {
  expect((await PATCH(req('PATCH', body), ctx(other))).status).toBe(404); expect(mocks.test).not.toHaveBeenCalled();
  expect((await pool.query('SELECT label FROM communication_senders WHERE id=$1',[other])).rows[0].label).toBe('Andrew');
});
it('does not delete another account’s connection', async () => {
  expect((await DELETE(req('DELETE'),ctx(other))).status).toBe(404);
  expect((await pool.query('SELECT id FROM communication_senders WHERE id=$1',[other])).rows).toHaveLength(1);
});
it('keeps another account’s default when changing your own', async () => {
  expect((await PATCH(req('PATCH',{isDefault:true}),ctx(own))).status).toBe(200);
  expect((await pool.query('SELECT is_default FROM communication_senders WHERE id=$1',[other])).rows[0].is_default).toBe(true);
});
