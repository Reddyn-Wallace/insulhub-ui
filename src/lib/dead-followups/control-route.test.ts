import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn(),tokenFromRequest:()=> 'token'}));
vi.mock('./access',()=>({readControlJob:vi.fn()}));
vi.mock('./repository',()=>({controlsRepository:vi.fn(),emptyRecord:()=>({revision:0})}));
import {requireInsulhubAuth} from '@/lib/insulhub-auth';
import {readControlJob} from './access';
import {controlsRepository} from './repository';
import {POST,GET} from '@/app/api/jobs/[id]/dead-followup/route';
const id='aaaaaaaaaaaaaaaaaaaaaaaa';const change=vi.fn();
const request=(body:unknown)=>new NextRequest(`http://localhost/api/jobs/${id}/dead-followup`,{method:'POST',body:JSON.stringify(body)});
const context={params:Promise.resolve({id})};
beforeEach(()=>{vi.stubEnv('DEAD_QUOTE_FOLLOWUPS_ENABLED','true');vi.mocked(requireInsulhubAuth).mockResolvedValue(null);vi.mocked(readControlJob).mockResolvedValue({job:{_id:id,stage:'QUOTE',updatedAt:'version'},actor:{id:'real-staff',name:'Real Staff'}});vi.mocked(controlsRepository).mockReturnValue({change,list:vi.fn(async()=>({})),events:vi.fn(async()=>[])} as never);change.mockResolvedValue({revision:1});});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
it('checks auth before reading a quote or writing',async()=>{
 vi.mocked(requireInsulhubAuth).mockResolvedValue(NextResponse.json({error:'Unauthorized'},{status:401}));
 expect((await POST(request({}),context)).status).toBe(401);expect(readControlJob).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
});
it('rejects a changed canonical version before persistence',async()=>{
 expect((await POST(request({revision:0,jobVersion:'old',command:{action:'discount',amount:'100'}}),context)).status).toBe(409);expect(change).not.toHaveBeenCalled();
});
it('uses verified actor, not caller supplied actor; returns saved revision',async()=>{
 const res=await POST(request({revision:0,jobVersion:'version',actor:{id:'forged'},command:{action:'discount',amount:'100'}}),context);
 expect(res.status).toBe(200);expect((await res.json()).record.revision).toBe(1);expect(change.mock.calls[0][3]).toEqual({id:'real-staff',name:'Real Staff'});
});
it('feature switch blocks writes but retains history reads',async()=>{
 vi.stubEnv('DEAD_QUOTE_FOLLOWUPS_ENABLED','false');expect((await POST(request({}),context)).status).toBe(503);expect(change).not.toHaveBeenCalled();
 expect((await GET(new NextRequest(`http://localhost/api/jobs/${id}/dead-followup`),context)).status).toBe(200);
});
it('does not disclose database errors',async()=>{change.mockRejectedValue(Error('private connection string'));
 const res=await POST(request({revision:0,jobVersion:'version',command:{action:'discount',amount:'100'}}),context);
 expect(res.status).toBe(503);expect(JSON.stringify(await res.json())).not.toContain('private');
});
