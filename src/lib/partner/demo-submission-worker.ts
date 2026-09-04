import "server-only";
import { getPartnerDemoPool, partnerDemoModeEnabled, partnerDemoSubmissionPoisoned, poisonPartnerDemoSubmission, resetPartnerDemoStorage, withPartnerDemoLock } from "./demo";
import { createPartnerDemoSubmissionWorkerRepository, type PartnerDemoWorkerScope } from "./demo-submission-worker-repository";
import { resetProcessFictionalLegacyRegistry } from "./legacy/factory";
import { createFictionalNotificationAdapter, resetProcessFictionalNotificationWorld } from "./legacy/notification";
import { PartnerSubmissionWorkerEngine, type PartnerWorkerRunSummary } from "./submission-worker-engine";

export interface PartnerDemoSignalScope{companyId:string;jobId:string}
type Coordinator={state:"IDLE"|"RUNNING";rerun:boolean;promise:Promise<PartnerDemoDrainResult>|null;signals:number;runs:number;poisoned:boolean;resetting:boolean;pending:Map<string,PartnerDemoSignalScope>;recoveryWindows:Map<string,number[]>};
type DemoRuntime=NodeJS.Process&{__insulHubPartnerDemoWorker?:Coordinator};
const runtime=process as DemoRuntime;
const fresh=():Coordinator=>({state:"IDLE",rerun:false,promise:null,signals:0,runs:0,poisoned:false,resetting:false,pending:new Map(),recoveryWindows:new Map()});
const coordinator=():Coordinator=>runtime.__insulHubPartnerDemoWorker??=fresh();
export interface PartnerDemoDrainResult{runs:number;last:PartnerWorkerRunSummary|null;state:"IDLE"|"POISONED"}

function assertDemo(env:NodeJS.ProcessEnv){if(env.NODE_ENV==="production"||!partnerDemoModeEnabled(env))throw new Error("PARTNER_DEMO_WORKER_FORBIDDEN");}
function scopeKey(scope:PartnerDemoSignalScope){return`${scope.companyId}:${scope.jobId}`;}
function validScope(scope:PartnerDemoSignalScope){return/^[0-9a-f-]{36}$/i.test(scope.companyId)&&/^[0-9a-f-]{36}$/i.test(scope.jobId);}
async function resolveScope(scope:PartnerDemoSignalScope):Promise<PartnerDemoWorkerScope|null>{const pool=getPartnerDemoPool();const result=await pool.query<{id:string}>(`SELECT id FROM partner_submission_requests WHERE company_id=$1 AND job_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[scope.companyId,scope.jobId]);return result.rows[0]?{...scope,requestId:result.rows[0].id}:null;}

async function drain(env:NodeJS.ProcessEnv):Promise<PartnerDemoDrainResult>{
  const state=coordinator();let last:PartnerWorkerRunSummary|null=null,runs=0,cycles=0;const deadline=Date.now()+45_000;
  try{return await withPartnerDemoLock("worker:coordinator",async()=>{
    while(state.pending.size){if(++cycles>24||Date.now()>=deadline){for(const scope of state.pending.values())poisonPartnerDemoSubmission(scope.companyId,scope.jobId);throw new Error("PARTNER_DEMO_DRAIN_LIMIT");}const [key,requested]=state.pending.entries().next().value as [string,PartnerDemoSignalScope];state.pending.delete(key);state.rerun=state.pending.size>0;const scope=await resolveScope(requested);if(!scope)continue;
      const pool=getPartnerDemoPool(),store=createPartnerDemoSubmissionWorkerRepository(pool,scope,env),engine=new PartnerSubmissionWorkerEngine(store,{env,leaseSeconds:120,deadlineMs:Math.max(3_000,deadline-Date.now()),resolveNotificationAdapter:()=>createFictionalNotificationAdapter(env)});
      for(let count=0;count<12&&Date.now()<deadline;count++){last=await engine.runOnce(`fictional-demo-worker-${cycles}`);runs+=1;state.runs+=1;if(last.submission==="IDLE"&&last.notification==="IDLE")break;}
    }
    return{runs,last,state:"IDLE"};
  });}catch(error){state.poisoned=true;throw error;}finally{state.state="IDLE";state.rerun=false;state.promise=null;}
}

export function signalPartnerDemoSubmissionWorker(scope:PartnerDemoSignalScope,env:NodeJS.ProcessEnv=process.env):Promise<PartnerDemoDrainResult>{
  assertDemo(env);if(!validScope(scope))throw new Error("PARTNER_DEMO_SCOPE_INVALID");const state=coordinator();if(state.resetting)throw new Error("PARTNER_DEMO_RESET_IN_PROGRESS");if(state.poisoned||partnerDemoSubmissionPoisoned(scope.companyId,scope.jobId))throw new Error("PARTNER_DEMO_RESET_REQUIRED");state.signals+=1;state.pending.set(scopeKey(scope),scope);
  if(state.state==="RUNNING"&&state.promise){state.rerun=true;return state.promise;}
  state.state="RUNNING";state.promise=drain(env);return state.promise;
}

export function consumePartnerDemoRecoveryAllowance(scope:PartnerDemoSignalScope,userId:string,now=Date.now()):boolean{const state=coordinator(),key=`${scope.companyId}:${userId}:${scope.jobId}`,recent=(state.recoveryWindows.get(key)??[]).filter(value=>now-value<30_000);if(recent.length>=6){state.recoveryWindows.set(key,recent);return false;}recent.push(now);state.recoveryWindows.set(key,recent);return true;}

export function partnerDemoWorkerState(){const value=coordinator();return{state:value.state,rerun:value.rerun,signals:value.signals,runs:value.runs,poisoned:value.poisoned,resetting:value.resetting,pending:value.pending.size};}

export async function resetPartnerDemoSubmissionRuntime(env:NodeJS.ProcessEnv=process.env):Promise<void>{
  assertDemo(env);const observed=coordinator();observed.resetting=true;if(observed.promise)await observed.promise.catch(()=>undefined);await withPartnerDemoLock("worker:coordinator",async()=>{resetProcessFictionalLegacyRegistry();resetProcessFictionalNotificationWorld();await resetPartnerDemoStorage();runtime.__insulHubPartnerDemoWorker=fresh();});
}
