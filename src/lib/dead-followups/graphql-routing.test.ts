// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {gql} from '@/lib/graphql';
import {UPDATE_JOB_LEAD,UPDATE_JOB_QUOTE,UPDATE_JOB_STAGE,ARCHIVE_JOB} from '@/lib/mutations';
beforeEach(()=>vi.stubGlobal('localStorage',{getItem:()=>null}));
afterEach(()=>vi.unstubAllGlobals());
it.each([UPDATE_JOB_LEAD,UPDATE_JOB_QUOTE,UPDATE_JOB_STAGE,ARCHIVE_JOB])('routes all existing status mutation shapes through capture',async query=>{
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url)=>{calls.push(url);return Response.json({data:{saved:true}});}));
 await gql(query,{input:{_id:'aaaaaaaaaaaaaaaaaaaaaaaa'},_id:'aaaaaaaaaaaaaaaaaaaaaaaa'});
 expect(calls).toEqual(['/api/jobs/mutate']);
});
it('does not treat non-GraphQL HTTP error responses as saved jobs',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Storage unavailable'},{status:503})));
 await expect(gql(UPDATE_JOB_LEAD,{input:{_id:'aaaaaaaaaaaaaaaaaaaaaaaa'}})).rejects.toThrow('Storage unavailable');
});
