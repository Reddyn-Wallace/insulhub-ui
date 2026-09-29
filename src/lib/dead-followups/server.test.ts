import { afterEach, expect, it, vi } from 'vitest';
import { loadDeadQuoteQueue } from './server';
const quote = {_id:'1',stage:'QUOTE',lead:null,jobNumber:12,notes:'29/01/26 - Marked as Dead - Staff',quote:{status:'DECLINED',c_total:12000}};
afterEach(()=>vi.unstubAllGlobals());
it('paginates using actual page sizes, filters leads/accepted, and never assumes offer history is empty', async()=>{
  const calls: number[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
    const {query,variables}=JSON.parse(init.body); calls.push(variables.skip);
    expect(query).toContain('stages: [QUOTE]');
    expect(init.headers['x-access-token']).toBe('staff-token');
    const results=variables.skip===0?[quote,{...quote,_id:'2',stage:'LEAD'}]:[{...quote,_id:'3',quote:{status:'ACCEPTED'}},{...quote,_id:'4',notes:'too expensive'}];
    return Response.json({data:{jobs:{total:4,results}}});
  }));
  const result=await loadDeadQuoteQueue('staff-token','2026-09-29T00:00:00Z');
  expect(calls).toEqual([0,2]);
  expect(result.items.map(x=>x.job._id)).toEqual(['1','4']);
  expect(result.items.every(x=>x.eligibility.state==='review')).toBe(true);
  expect(result.items[0].suggestion?.date).toBe('2026-01-29');
  expect(result.items[1].suggestion).toBeNull();
  expect(result.historyAvailable).toBe(false);
});
it.each(['empty','duplicate','changed-total','error','malformed'])('rejects an incomplete scan (%s) instead of a false empty/complete queue',async(kind)=>{
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
    const {variables}=JSON.parse(init.body);
    if(variables.skip===0)return Response.json({data:{jobs:{total:2,results:[quote]}}});
    if(kind==='error')return Response.json({errors:[{message:'private upstream details'}]});
    if(kind==='malformed')return Response.json({data:{jobs:{total:2,results:[{_id:'2'}]}}});
    return Response.json({data:{jobs:{total:kind==='changed-total'?3:2,results:kind==='empty'?[]:[quote]}}});
  }));
  await expect(loadDeadQuoteQueue('token')).rejects.toThrow('The full quote list could not be verified. Refresh and try again.');
});
it('rejects upstream HTTP failure',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
  await expect(loadDeadQuoteQueue('token')).rejects.toThrow('The full quote list');
});
it.each([{quote:{},lead:{}},{quote:{status:'DECLINED'},lead:[]},{quote:{status:12}},{quote:{status:'DECLINED'},notes:42}])('rejects malformed status-bearing data instead of silently excluding it: %j',async(fields)=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{jobs:{total:1,results:[{...quote,...fields}]}}})));
  await expect(loadDeadQuoteQueue('token')).rejects.toThrow('The full quote list');
});
