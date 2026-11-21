import {NextRequest,NextResponse} from 'next/server';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn(),tokenFromRequest:()=> 'token'}));
vi.mock('./date-repository',()=>({attachDeadDates:vi.fn(async jobs=>jobs),attachDeadDate:vi.fn()}));
vi.mock('./repository',()=>({controlsRepository:()=>null}));

import {requireInsulhubAuth} from '@/lib/insulhub-auth';
import {attachDeadDates} from './date-repository';
import {GET} from '@/app/api/dead-followups/route';

const id='a'.repeat(24);
const checkedAt='2026-11-21T00:00:00Z';
const job={_id:id,stage:'QUOTE',jobNumber:9,updatedAt:'2026-11-01T00:00:00Z',notes:'01/07/26 - customer called',lead:{leadStatus:'DEAD'},quote:{status:'DECLINED',date:'2026-06-01'}};
const read=(query='')=>GET(new NextRequest('http://localhost/api/dead-followups'+query));
const jobs=(...results:unknown[])=>Response.json({data:{jobs:{total:results.length,results}}});

beforeEach(()=>{
  vi.setSystemTime(new Date(checkedAt));
  vi.mocked(requireInsulhubAuth).mockResolvedValue(null);
  vi.stubGlobal('fetch',vi.fn(async()=>jobs()));
});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it('does not load customer data when access is denied',async()=>{
  vi.mocked(requireInsulhubAuth).mockResolvedValue(NextResponse.json({error:'Unauthorized'},{status:401}));
  expect((await read('?view=queue')).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

it('returns no-store data only after authentication',async()=>{
  const response=await read();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await response.json()).readOnly).toBe(true);
});

it('does not leak upstream errors or return an empty queue on failure',async()=>{
  vi.mocked(fetch).mockRejectedValue(Error('secret backend detail'));
  const response=await read();
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('secret');
});

it.each([401,403])('preserves upstream HTTP access refusal after initial authentication (%s)',async status=>{
  vi.mocked(fetch).mockResolvedValue(new Response('',{status}));
  expect((await read('?view=queue')).status).toBe(status);
  expect((await read('?jobId='+id)).status).toBe(status);
});

it('preserves upstream GraphQL access refusal when loading cards',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(jobs(job)).mockResolvedValueOnce(Response.json({
    errors:[{extensions:{exception:{statusCode:'403'}}}],
  }));
  expect((await read('?view=queue')).status).toBe(403);
});

it('skips all card reads when recent notes make an old quote ineligible',async()=>{
  vi.mocked(fetch).mockImplementation(async(_url,init)=>{
    const {query,variables}=JSON.parse(String(init?.body));
    expect(query).toContain('notes');
    expect(query).not.toMatch(/allocatedTo|quoteNote|extras|contactDetails/);
    expect(variables).toMatchObject({skip:0,limit:2500});
    return jobs({...job,notes:'18/11/26 - customer called'});
  });
  const response=await read('?view=queue');
  expect(response.status).toBe(200);
  expect(response.headers.get('server-timing')).toMatch(/auth;dur=.*index;dur=.*history;dur=/);
  expect(await response.json()).toMatchObject({items:[],quoteCounts:{DEAD:1},detailsDeferred:true});
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('hydrates only due cards and keeps private notes and scope out of the list',async()=>{
  const contact={contactDetails:{name:'Example Customer',streetAddress:'1 Sample Road'}};
  vi.mocked(fetch).mockResolvedValueOnce(jobs(job,{...job,_id:'b'.repeat(24),notes:'18/11/26 - customer called'}));
  vi.mocked(fetch).mockImplementationOnce(async(_url,init)=>{
    const {query,variables}=JSON.parse(String(init?.body));
    expect(query).toContain('contactDetails');
    expect(query).not.toMatch(/\bnotes\b|quoteNote/);
    expect(Object.values(variables)).toEqual([id]);
    return Response.json({data:{row0:{...job,notes:undefined,client:contact,quote:{...job.quote,c_total:5432}}}});
  });
  const response=await read('?view=queue');
  expect(response.status).toBe(200);
  const body=await response.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({job:{_id:id,client:contact,quote:{c_total:5432}},suggestion:null});
  expect(body.items[0].job).not.toHaveProperty('notes');
  expect(JSON.stringify(body)).not.toContain('customer called');
});

it('fails closed if a quote changes during card loading',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(jobs(job)).mockResolvedValueOnce(Response.json({data:{row0:{...job,updatedAt:checkedAt}}}));
  expect((await read('?view=queue')).status).toBe(503);
});

it('loads fresh detail with scope and notes for only the selected quote',async()=>{
  vi.mocked(fetch).mockImplementation(async(_url,init)=>{
    const {query}=JSON.parse(String(init?.body));
    expect(query).toMatch(/quoteNote.*wall.*SQM/);
    return Response.json({data:{me:{_id:'staff'},job:{...job,quote:{...job.quote,quoteNote:'Scope',wall:{SQM:12}}}}});
  });
  const response=await read('?jobId='+id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({items:[{job:{notes:job.notes,quote:{quoteNote:'Scope',wall:{SQM:12}}}}]});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(attachDeadDates).toHaveBeenCalledWith(expect.any(Array),false);
});

it('rejects details for a quote that is no longer due',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({data:{me:{_id:'staff'},job:{...job,notes:'18/11/26 - customer called'}}}));
  expect((await read('?jobId='+id)).status).toBe(409);
});

it('does not initialise stored Dead dates when a selected quote has moved to Jobs',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({data:{me:{_id:'staff'},job:{...job,stage:'JOB'}}}));
  expect((await read('?jobId='+id)).status).toBe(409);
  expect(attachDeadDates).not.toHaveBeenCalled();
});
