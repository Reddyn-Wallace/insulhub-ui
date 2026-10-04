import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn(async()=>null),tokenFromRequest:()=> 'staff-token'}));
vi.mock('./access',()=>({readControlJob:vi.fn()}));
vi.mock('./date-repository',()=>({dateRepository:vi.fn(),datesEnabled:()=>process.env.DEAD_QUOTE_DATE_CAPTURE_ENABLED==='true'||process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true'}));
import {readControlJob} from './access';
import {dateRepository} from './date-repository';
import {POST} from '@/app/api/jobs/mutate/route';
const id='aaaaaaaaaaaaaaaaaaaaaaaa';
const payload={query:'mutation Update($input:UpdateJobInput!){updateJob(input:$input){_id}}',variables:{input:{_id:id,lead:{leadStatus:'DEAD'}}}};
function request(){return new NextRequest('http://localhost/api/jobs/mutate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});}
beforeEach(()=>{vi.stubEnv('DEAD_QUOTE_FOLLOWUPS_ENABLED','false');vi.stubEnv('DEAD_QUOTE_DATE_CAPTURE_ENABLED','true');vi.mocked(readControlJob).mockResolvedValue({job:{_id:id,stage:'QUOTE',quote:{date:'2026-01-01',status:'DECLINED'}},actor:{id:'real',name:'Real Staff'}} as never);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('does not dispatch if capture storage is unavailable',async()=>{
 vi.mocked(dateRepository).mockReturnValue(null);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 expect((await POST(request())).status).toBe(503);expect(fetch).not.toHaveBeenCalled();
});
it('forwards exact authenticated mutation only inside durable capture',async()=>{
 const phases:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{phases.push('dispatch');expect(options.headers['x-access-token']).toBe('staff-token');expect(JSON.parse(options.body)).toEqual(payload);return Response.json({data:{updateJob:{_id:id}}});}));
 vi.mocked(dateRepository).mockReturnValue({capture:async(jobId:string,read:()=>Promise<unknown>,dispatch:()=>Promise<unknown>,after:()=>Promise<unknown>,actor:{id:string})=>{expect(jobId).toBe(id);expect(actor.id).toBe('real');await read();phases.push('reserved');const result=await dispatch();await after();phases.push('recorded');return result;}} as never);
 const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({data:{updateJob:{_id:id}}});expect(phases).toEqual(['reserved','dispatch','recorded']);
});
it('preserves normal mutations with capture off, without claiming recorded dates',async()=>{
 vi.stubEnv('DEAD_QUOTE_DATE_CAPTURE_ENABLED','false');vi.mocked(dateRepository).mockReturnValue(null);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{updateJob:{_id:id}}})));
 expect((await POST(request())).status).toBe(200);
});
it('requires capture storage whenever follow-up preparation is enabled',async()=>{
 vi.stubEnv('DEAD_QUOTE_DATE_CAPTURE_ENABLED','false');vi.stubEnv('DEAD_QUOTE_FOLLOWUPS_ENABLED','true');vi.mocked(dateRepository).mockReturnValue(null);
 const fetch=vi.fn(async()=>Response.json({data:{updateJob:{_id:id}}}));vi.stubGlobal('fetch',fetch);
 expect((await POST(request())).status).toBe(503);expect(fetch).not.toHaveBeenCalled();
});
it('does not require follow-up storage for unrelated lead saves',async()=>{
 vi.mocked(readControlJob).mockResolvedValue({job:{_id:id,stage:'LEAD'},actor:{id:'real',name:'Staff'}} as never);
 vi.mocked(dateRepository).mockReturnValue(null);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{updateJob:{_id:id}}})));
 expect((await POST(request())).status).toBe(200);
});
