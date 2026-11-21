// @vitest-environment jsdom
import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchQueue,cachedQueue,followupSnapshotPrefix,invalidateQueue,restoreQueue} from './queue-cache';
const data={items:[],readOnly:true,checkedAt:'2026-10-08T00:00:00Z'};
beforeEach(()=>{
 const storage=new Map<string,string>();
 vi.stubGlobal('localStorage',{
  getItem:(key:string)=>storage.get(key)??null,
  setItem:(key:string,value:string)=>{storage.set(key,value);},
  removeItem:(key:string)=>{storage.delete(key);},
  key:(index:number)=>[...storage.keys()][index]??null,
  get length(){return storage.size;},
 });
 invalidateQueue('test');invalidateQueue('other');
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(data)));
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('reuses a prefetched queue without a second request',async()=>{await fetchQueue('test');expect(await fetchQueue('test')).toEqual(data);expect(fetch).toHaveBeenCalledTimes(1);});
it('shares an in-flight request between the badge and queue',async()=>{let finish!:(r:Response)=>void;vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const badge=fetchQueue('test');const queue=fetchQueue('test');expect(fetch).toHaveBeenCalledTimes(1);finish(Response.json(data));expect(await queue).toEqual(await badge);});
it('expires after 30 seconds and isolates sign-ins',async()=>{vi.useFakeTimers();await fetchQueue('test');vi.advanceTimersByTime(30001);expect(cachedQueue('test')).toBeNull();await fetchQueue('test');expect(cachedQueue('other')).toBeNull();await fetchQueue('other');expect(fetch).toHaveBeenCalledTimes(3);});
it('invalidation prevents an old pending request repopulating the queue',async()=>{let finish!:(r:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=fetchQueue('test');invalidateQueue('test');const updated={...data,checkedAt:'2026-10-09T00:00:00Z'};vi.mocked(fetch).mockResolvedValueOnce(Response.json(updated));await fetchQueue('test');finish(Response.json(data));await expect(pending).rejects.toThrow('Quotes changed while loading');expect(cachedQueue('test')).toEqual(updated);});
it('does not cache failed requests and retries them',async()=>{vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:401}));await expect(fetchQueue('test')).rejects.toMatchObject({status:401});expect(cachedQueue('test')).toBeNull();await fetchQueue('test');expect(fetch).toHaveBeenCalledTimes(2);});

it('shows a recent stale snapshot while fetching an update, and clears it on access loss',async()=>{
 vi.useFakeTimers();await fetchQueue('test');vi.advanceTimersByTime(60_000);
 expect(cachedQueue('test')).toBeNull();
 expect(cachedQueue('test',true)).toEqual(data);
 const updated={...data,checkedAt:'2026-10-26T00:00:00Z'};
 vi.mocked(fetch).mockResolvedValueOnce(Response.json(updated));
 expect(await fetchQueue('test')).toEqual(updated);
 vi.advanceTimersByTime(60_000);
 vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:403}));
 await expect(fetchQueue('test')).rejects.toMatchObject({status:403});
 expect(cachedQueue('test',true)).toBeNull();
});
it('never displays a snapshot from another sign-in, after invalidation, or after the stale limit',async()=>{
 vi.useFakeTimers();await fetchQueue('test');vi.advanceTimersByTime(60_000);
 expect(cachedQueue('other',true)).toBeNull();invalidateQueue('test');expect(cachedQueue('test',true)).toBeNull();
 await fetchQueue('test');vi.advanceTimersByTime(15*60_000);expect(cachedQueue('test',true)).toBeNull();
});

it('removes the encrypted browser snapshot when the server denies access',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 localStorage.setItem('token','test');
 const summary={...data,readOnly:false,detailsDeferred:true};
 vi.mocked(fetch).mockResolvedValueOnce(Response.json(summary));
 await fetchQueue('test');
 await vi.waitFor(()=>expect(localStorage.key(1)).toContain(followupSnapshotPrefix));
 invalidateQueue('test');
 expect(await restoreQueue('test')).toEqual({...summary,readOnly:true});
 vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:403}));
 await expect(fetchQueue('test')).rejects.toMatchObject({status:403});
 expect(localStorage.key(1)).toBeNull();
 expect(await restoreQueue('test')).toBeNull();
});
