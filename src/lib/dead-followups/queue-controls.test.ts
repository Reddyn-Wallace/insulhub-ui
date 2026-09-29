import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('./repository',()=>({controlsRepository:vi.fn(),emptyRecord:()=>({revision:0,state:emptyControls(),updatedAt:null,actorName:''})}));
vi.mock('./send-repository',()=>({sendsRepository:vi.fn(()=>null)}));
import {sendsRepository} from './send-repository';
import {controlsRepository} from './repository';
import {emptyControls} from './controls';
import {decorateQueue} from './queue-controls';
import type {QueueResponse} from './types';
const queue:QueueResponse={items:[{job:{_id:'a',stage:'QUOTE',updatedAt:'v1',quote:{status:'DECLINED'}},eligibility:{state:'review',reason:'Unknown'},suggestion:null,earliestFirstApproach:null}],checkedAt:'2026-09-30T00:00:00Z',readOnly:true,historyAvailable:false};
const state={...emptyControls(),deadDate:'2026-01-01T00:00:00Z',dateEvidence:'Dated notes',reviewedVersion:'v1'};
beforeEach(()=>vi.stubEnv('DEAD_QUOTE_FOLLOWUPS_ENABLED','true'));
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
it('uses stored reviewed history for eligibility',async()=>{
 vi.mocked(controlsRepository).mockReturnValue({list:async()=>({a:{revision:1,state,actorName:'Staff',updatedAt:null}})} as never);
 const result=await decorateQueue(queue);expect(result.readOnly).toBe(false);expect(result.items[0].eligibility.state).toBe('due');
});
it('does not trust review after the canonical quote version changes',async()=>{
 vi.mocked(controlsRepository).mockReturnValue({list:async()=>({a:{revision:1,state:{...state,reviewedVersion:'old'},actorName:'Staff',updatedAt:null}})} as never);
 expect((await decorateQueue(queue)).items[0].eligibility.state).toBe('review');
});
it('keeps shared exclusion visible and out of due status',async()=>{
 vi.mocked(controlsRepository).mockReturnValue({list:async()=>({a:{revision:1,state:{...state,exclusionReason:'Not suitable'},actorName:'Staff',updatedAt:null}})} as never);
 expect((await decorateQueue(queue)).items[0].eligibility.state).toBe('excluded');
});
it('does not silently discard exclusions on database failure',async()=>{
 vi.mocked(controlsRepository).mockReturnValue({list:async()=>{throw Error('database unavailable');}} as never);
 await expect(decorateQueue(queue)).rejects.toThrow();
});
it('only missing migration falls back to explicitly read-only review',async()=>{
 vi.mocked(controlsRepository).mockReturnValue({list:async()=>{throw {code:'42P01'};}} as never);
 expect(await decorateQueue(queue)).toEqual(queue);
});

it('pending sends are attention items even while sending is switched off',async()=>{
 vi.mocked(controlsRepository).mockReturnValue({list:async()=>({a:{revision:1,state,actorName:'Staff',updatedAt:null}})} as never);
 vi.mocked(sendsRepository).mockReturnValue({summaries:async()=>[{insulhub_job_id:'a',status:'unknown',note_status:'pending'}]} as never);
 const result=await decorateQueue(queue);expect(result.items[0].eligibility.state).toBe('attention');expect(result.items[0].sendAvailable).toBe(true);expect(result.items[0].sendEnabled).toBe(false);
});
