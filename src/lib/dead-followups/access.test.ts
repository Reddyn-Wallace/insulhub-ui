import {afterEach,expect,it,vi} from 'vitest';
import {readControlJob} from './access';
const id='aaaaaaaaaaaaaaaaaaaaaaaa';
const job={_id:id,stage:'QUOTE',updatedAt:'2026-01-01T00:00:00Z',lead:{leadStatus:'DEAD'},quote:{status:'DECLINED'}};
afterEach(()=>vi.unstubAllGlobals());
it('reads current job and actor using the user token with no cache',async()=>{
 const calls:RequestInit[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{calls.push(init);return Response.json({data:{job,me:{_id:'staff',firstname:'Real',lastname:'Staff'}}});}));
 expect(await readControlJob('user-token',id)).toMatchObject({actor:{id:'staff',name:'Real Staff'},job});
 expect(calls[0]).toMatchObject({cache:'no-store',headers:{'x-access-token':'user-token'}});
});
it.each([{job:null,me:{_id:'staff'}},{job:{...job,_id:'another'},me:{_id:'staff'}},{job:{...job,updatedAt:null},me:{_id:'staff'}},{job,me:null}])('rejects unavailable/inaccessible identity or job: %j',async(data)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data})));
 await expect(readControlJob('token',id)).rejects.toThrow();
});
