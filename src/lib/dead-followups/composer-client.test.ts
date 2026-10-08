// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cachedComposerDetails,clearComposerDetails,loadComposerDetails} from './composer-client';
import type {QueueItem} from './types';
const item={job:{_id:'job',updatedAt:'v1'},controls:{revision:1}} as QueueItem;
const data={enabled:true,attempts:[],contact:{},sms:{senders:[]},email:{senders:[]}};
let token='one';
beforeEach(()=>{token='one';clearComposerDetails();vi.stubGlobal('localStorage',{getItem:()=>token});vi.stubGlobal('fetch',vi.fn(async()=>Response.json(data)));});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('shares prefetch in flight and reuses fresh results',async()=>{const first=loadComposerDetails(item);expect(loadComposerDetails(item)).toBe(first);await first;expect(cachedComposerDetails(item)).toEqual(data);await loadComposerDetails(item);expect(fetch).toHaveBeenCalledTimes(1);});
it('isolates accounts and refreshes changed quotes, revisions and expired entries',async()=>{vi.useFakeTimers();await loadComposerDetails(item);token='two';expect(cachedComposerDetails(item)).toBeUndefined();await loadComposerDetails(item);await loadComposerDetails({...item,job:{...item.job,updatedAt:'v2'}});await loadComposerDetails({...item,controls:{...item.controls!,revision:2}});vi.advanceTimersByTime(300001);expect(cachedComposerDetails(item)).toBeUndefined();await loadComposerDetails(item);expect(fetch).toHaveBeenCalledTimes(5);});
it('evicts failures so reopening retries',async()=>{vi.mocked(fetch).mockRejectedValueOnce(Error('offline'));await expect(loadComposerDetails(item)).rejects.toThrow('offline');await loadComposerDetails(item);expect(fetch).toHaveBeenCalledTimes(2);});
it('invalidates prefetched details before writes',async()=>{await loadComposerDetails(item);clearComposerDetails();expect(cachedComposerDetails(item)).toBeUndefined();await loadComposerDetails(item);expect(fetch).toHaveBeenCalledTimes(2);});
