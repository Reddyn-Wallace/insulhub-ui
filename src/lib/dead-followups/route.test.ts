import { NextRequest, NextResponse } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn(),tokenFromRequest:()=> 'token'}));
vi.mock('./server',()=>({loadDeadQuoteQueue:vi.fn()}));
import { requireInsulhubAuth } from '@/lib/insulhub-auth';
import { loadDeadQuoteQueue } from './server';
import { GET } from '@/app/api/dead-followups/route';
afterEach(()=>vi.resetAllMocks());
it('does not load customer data when access is denied',async()=>{
  vi.mocked(requireInsulhubAuth).mockResolvedValue(NextResponse.json({error:'Unauthorized'},{status:401}));
  const response=await GET(new NextRequest('http://localhost/api/dead-followups'));
  expect(response.status).toBe(401);expect(loadDeadQuoteQueue).not.toHaveBeenCalled();
});
it('returns no-store data only after authentication',async()=>{
  vi.mocked(requireInsulhubAuth).mockResolvedValue(null);
  vi.mocked(loadDeadQuoteQueue).mockResolvedValue({items:[],checkedAt:'2026-09-29T00:00:00Z',readOnly:true,historyAvailable:false});
  const response=await GET(new NextRequest('http://localhost/api/dead-followups'));
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await response.json()).readOnly).toBe(true);
});
it('does not leak upstream errors or return an empty queue on failure',async()=>{
  vi.mocked(requireInsulhubAuth).mockResolvedValue(null);vi.mocked(loadDeadQuoteQueue).mockRejectedValue(Error('secret backend detail'));
  const response=await GET(new NextRequest('http://localhost/api/dead-followups'));
  expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('secret');
});
