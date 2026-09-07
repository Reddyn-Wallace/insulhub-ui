import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m=vi.hoisted(()=>({sql:vi.fn(),identity:vi.fn(),auth:vi.fn()}));
vi.mock('@/lib/overlay-db',()=>({overlaySql:m.sql,ensureOverlaySchema:vi.fn()}));
vi.mock('@/lib/job-sms-access',()=>({jobSmsIdentity:m.identity}));
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:m.auth}));
import { GET } from '@/app/api/jobs/[id]/campaign-communications/route';
const context={params:Promise.resolve({id:'abcdefabcdefabcdefabcdef'})};
const request=()=>new NextRequest('http://localhost/api/jobs/abcdefabcdefabcdefabcdef/campaign-communications');
let settings:Record<string,unknown>[];
beforeEach(()=>{
 vi.resetAllMocks();settings=[{key:'job_sms_enabled',value:'true'},{key:'job_crm_test_user',value:JSON.stringify({userId:'tester',name:'Tester'})}];
 m.auth.mockResolvedValue(null);m.identity.mockResolvedValue({me:{_id:'tester'}});
 m.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('overlay_settings')?settings:[{id:'message',source:'crm_email',channel:'email',sender_label:'Original connection',sender_name:'Original connection',sender_value:'original@example.com',actor_name:'Andrew',rendered_html:'<b>Saved signature</b>',rendered_body:'Message and signature',status:'sent',sent_at:'2026-09-07T00:00:00Z',provider_access_token:'must-not-leak'}]);
});
it('returns structured sender snapshots and saved HTML without credentials',async()=>{
 const body=await(await GET(request(),context)).json();
 expect(body.communications[0]).toMatchObject({senderName:'Original connection',senderValue:'original@example.com',actorName:'Andrew',renderedHtml:'<b>Saved signature</b>'});
 expect(JSON.stringify(body)).not.toContain('must-not-leak');
});
it('enables the new interface for colleagues as well as the former tester',async()=>{
 expect((await(await GET(request(),context)).json()).crmMessagingEnabled).toBe(true);
 m.identity.mockResolvedValue({me:{_id:'colleague'}});
 const body=await(await GET(request(),context)).json();expect(body.crmMessagingEnabled).toBe(true);expect(body.communications).toHaveLength(1);
});
it('enables history without stored rollout settings',async()=>{
 settings=[];const body=await(await GET(request(),context)).json();expect(body.crmMessagingEnabled).toBe(true);expect(body.communications).toHaveLength(1);
});
it('checks canonical job access before reading communication records',async()=>{
 m.identity.mockRejectedValue(Error('Job not found'));await GET(request(),context);expect(m.sql).not.toHaveBeenCalled();
});
