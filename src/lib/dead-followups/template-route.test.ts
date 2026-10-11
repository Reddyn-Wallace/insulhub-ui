import {afterEach,expect,it,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn(async()=>null)}));
import {requireInsulhubAuth} from '@/lib/insulhub-auth';
import {GET,PATCH} from '@/app/api/dead-followups/templates/route';
afterEach(()=>vi.clearAllMocks());
it('sends old clients to the ordinary template library instead of accepting writes to the retired store',async()=>{
 for(const handler of [GET,PATCH]){const response=await handler(new NextRequest('http://localhost/api/dead-followups/templates'));expect(response.status).toBe(410);expect((await response.json()).error).toContain('Settings');}
});
it('still requires authentication for the retired endpoint',async()=>{
 vi.mocked(requireInsulhubAuth).mockResolvedValueOnce(NextResponse.json({error:'Sign in'},{status:401}));expect((await PATCH(new NextRequest('http://localhost'))).status).toBe(401);
});
