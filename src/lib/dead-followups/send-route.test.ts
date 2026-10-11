import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn(),tokenFromRequest:()=> 'token'}));
vi.mock('./access',()=>({readControlJob:vi.fn()}));
vi.mock('./send-repository',()=>({sendsRepository:vi.fn()}));
vi.mock('@/app/api/jobs/[id]/sms/route',()=>({POST:vi.fn(),GET:vi.fn()}));
vi.mock('@/app/api/jobs/[id]/email/route',()=>({POST:vi.fn(),GET:vi.fn()}));
import {requireInsulhubAuth} from '@/lib/insulhub-auth';
import {readControlJob} from './access';
import {sendsRepository} from './send-repository';
import {POST as smsPost} from '@/app/api/jobs/[id]/sms/route';
import {POST} from '@/app/api/jobs/[id]/dead-followup/send/route';
const id='aaaaaaaaaaaaaaaaaaaaaaaa';
const attempt={id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',jobId:id,channel:'sms',status:'unknown',noteStatus:'pending'};
const repo={claim:vi.fn(),list:vi.fn(),setOutcome:vi.fn(),messageOutcome:vi.fn(),withNoteLock:vi.fn(),verifySent:vi.fn()};
const req=(body:unknown)=>new NextRequest('http://localhost/api/send',{method:'POST',body:JSON.stringify(body)});
const ctx={params:Promise.resolve({id})};
beforeEach(()=>{vi.stubEnv('DEAD_QUOTE_FOLLOWUPS_ENABLED','true');vi.stubEnv('DEAD_QUOTE_FOLLOWUP_SEND_ENABLED','true');vi.mocked(requireInsulhubAuth).mockResolvedValue(null);vi.mocked(readControlJob).mockResolvedValue({job:{_id:id,stage:'QUOTE',updatedAt:'v',quote:{date:'2026-01-01',status:'DECLINED'}},actor:{id:'staff',name:'Staff'}});vi.mocked(sendsRepository).mockReturnValue(repo as never);repo.claim.mockResolvedValue({claimed:false,attempt});repo.list.mockResolvedValue([attempt]);repo.messageOutcome.mockResolvedValue(undefined);repo.setOutcome.mockResolvedValue(attempt);});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
it('authentication and feature flag prevent dispatch',async()=>{vi.mocked(requireInsulhubAuth).mockResolvedValue(NextResponse.json({}, {status:401}));expect((await POST(req({}),ctx)).status).toBe(401);expect(smsPost).not.toHaveBeenCalled();});
it('repeated send request returns saved attempt without dispatch',async()=>{const r=await POST(req({action:'send',requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc',jobVersion:'v'}),ctx);expect(r.status).toBe(200);expect(smsPost).not.toHaveBeenCalled();});
it('note-only retry never reaches the sender',async()=>{repo.list.mockResolvedValue([{...attempt,status:'sent'}]);repo.withNoteLock.mockRejectedValue(Error('note unavailable'));const r=await POST(req({action:'note',attemptId:attempt.id}),ctx);expect(r.status).toBe(200);expect((await r.json()).noteError).toContain('pending');expect(smsPost).not.toHaveBeenCalled();});
it('stale quote aborts reserved send before delivery',async()=>{repo.claim.mockResolvedValue({claimed:true,attempt});vi.mocked(readControlJob).mockResolvedValueOnce({job:{_id:id,stage:'QUOTE',updatedAt:'v'},actor:{id:'staff',name:'Staff'}}).mockResolvedValueOnce({job:{_id:id,stage:'LEAD',updatedAt:'v2'},actor:{id:'staff',name:'Staff'}});await POST(req({action:'send',requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc',jobVersion:'v'}),ctx);expect(smsPost).not.toHaveBeenCalled();expect(repo.setOutcome).toHaveBeenCalledWith(attempt.id,'failed',expect.any(String));});
it('a proven safe contact rejection with no message becomes failed, not permanently unknown',async()=>{
 repo.claim.mockResolvedValue({claimed:true,attempt});
 vi.mocked(smsPost).mockResolvedValue(NextResponse.json({error:'Contact changed',safeToEdit:true},{status:409}));
 const r=await POST(req({action:'send',requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc',jobVersion:'v'}),ctx);
 expect(r.status).toBe(200);expect(repo.setOutcome).toHaveBeenCalledWith(attempt.id,'failed',expect.stringContaining('not sent'));
});
it('safe rejection never overrides a durable confirmed message',async()=>{
 repo.claim.mockResolvedValue({claimed:true,attempt});
 vi.mocked(smsPost).mockResolvedValue(NextResponse.json({error:'Contact changed',safeToEdit:true},{status:409}));
 repo.messageOutcome.mockResolvedValue({status:'sent',failure_reason:''});
 await POST(req({action:'send',requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc',jobVersion:'v'}),ctx);
 expect(repo.setOutcome).toHaveBeenCalledWith(attempt.id,'sent',expect.any(String));
});

it('staff verification never invokes the sending provider and ignores forged actor data',async()=>{
 repo.verifySent.mockResolvedValue({...attempt,status:'sent',noteStatus:'saved',verification:{actorName:'Staff',evidence:'Checked sent folder'}});
 const r=await POST(req({action:'verify',attemptId:attempt.id,confirmed:true,evidence:'Verified recipient and content in sent folder.',actor:{id:'forged'}}),ctx);
 expect(r.status).toBe(200);expect(smsPost).not.toHaveBeenCalled();expect(repo.verifySent).toHaveBeenCalledWith(attempt.id,expect.any(Object),{id:'staff',name:'Staff'});
});
it('does not dispatch when the fresh date observation becomes uncertain with the same job version',async()=>{
 repo.claim.mockResolvedValue({claimed:true,attempt});
 vi.mocked(readControlJob).mockResolvedValueOnce({job:{_id:id,stage:'QUOTE',updatedAt:'v',quote:{date:'2026-01-01',status:'DECLINED'}},actor:{id:'staff',name:'Staff'}}).mockResolvedValueOnce({job:{_id:id,stage:'QUOTE',updatedAt:'v',quote:{date:'2026-01-01',status:'DECLINED'},deadDateUncertain:true},actor:{id:'staff',name:'Staff'}});
 vi.mocked(smsPost).mockResolvedValue(NextResponse.json({error:'simulated'}));
 await POST(req({action:'send',requestId:'cccccccc-cccc-4ccc-cccc-cccccccccccc',jobVersion:'v'}),ctx);
 expect(smsPost).not.toHaveBeenCalled();expect(repo.setOutcome).toHaveBeenCalledWith(attempt.id,'failed',expect.any(String));
});
