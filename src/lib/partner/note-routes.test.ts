import { expect,it,vi } from 'vitest';
import {partnerNotesRoute,type NoteRouteDependencies} from './note-routes';
const job='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
it('takes identity only from the session and rejects cross-origin and expanded receipt bodies',async()=>{
 const principal={userId:'user',companyId:'company',principalType:'PARTNER' as const};
 const feed=vi.fn().mockResolvedValue({updates:[],latestSequence:2,readSequence:1});
 const deps:NoteRouteDependencies={repository:{feed,summaries:vi.fn()},getPrincipal:async()=>principal,origins:new Set(['https://partner.test'])};
 const request=(body:unknown,origin='https://partner.test')=>new Request(`https://partner.test/api/partner/jobs/${job}/updates`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 expect((await partnerNotesRoute(request({seenSequence:1},'https://other.test'),job,deps)).status).toBe(403);
 expect((await partnerNotesRoute(request({seenSequence:1,userId:'other'}),job,deps)).status).toBe(400);
 expect(feed).not.toHaveBeenCalled();
 const response=await partnerNotesRoute(request({seenSequence:1}),job,deps);
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(feed).toHaveBeenCalledWith(principal,job,1);
 expect((await partnerNotesRoute(request({seenSequence:1}),job,{...deps,getPrincipal:async()=>null})).status).toBe(404);
});
