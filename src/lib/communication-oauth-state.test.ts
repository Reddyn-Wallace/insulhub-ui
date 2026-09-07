import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m=vi.hoisted(()=>({sql:vi.fn(),identity:vi.fn()}));
vi.mock('@/lib/overlay-db',()=>({overlaySql:m.sql,ensureOverlaySchema:vi.fn()}));
vi.mock('@/lib/job-sms-access',()=>({jobSmsIdentity:m.identity}));
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn().mockResolvedValue(null)}));
import { GET as callback } from '@/app/api/communication-senders/gmail/callback/route';
import { GET as connect } from '@/app/api/communication-senders/[id]/gmail/connect/route';
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',vi.fn());m.identity.mockResolvedValue({me:{_id:'reddyn'}});m.sql.mockResolvedValue([]);});
it('rejects the old forgeable sender-ID state before any provider request',async()=>{
 const state=Buffer.from(JSON.stringify({senderId:'other-person'})).toString('base64url');
 const result=await callback(new NextRequest(`https://example.com/api/communication-senders/gmail/callback?code=fake&state=${state}`));
 expect(result.headers.get('location')).toContain('invalid_state');expect(fetch).not.toHaveBeenCalled();
});
it('cannot initiate OAuth for another account’s sender',async()=>{
 await connect(new NextRequest('https://example.com/api/communication-senders/other/gmail/connect'),{params:Promise.resolve({id:'other'})});
 const [parts,...values]=m.sql.mock.calls[0];expect(parts.join('')).toContain('owner_user_id');expect(values).toContain('reddyn');
});
