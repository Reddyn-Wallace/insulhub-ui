import "server-only";
import { createHash } from "node:crypto";
import { parseSitePlanDocument } from "../site-plan-drawings";
import { validateLeadDraft } from "./draft";
import { BoundLegacyCredential } from "./legacy/claimed-credential";
import { legacySubmissionMarker } from "./legacy/contract";
import { createLegacyAdapter, type LegacyAdapterSelection } from "./legacy/factory";
import { ActualInsulhubAdapter, INSULHUB_LIVE_CONTRACT } from "./legacy/insulhub-live";
import { deriveFinalQuoteNumber, legacyLeadCreateFingerprint, mapLegacyFullQuote } from "./legacy/graphql-adapter";
import { validateLegacyFrozenPlan, validateLegacyUploadedPlan, type LegacyAdapter, type LegacyAttachedPlan, type LegacyFrozenPlan, type LegacyLeadInput, type LegacyNotificationAdapter, type LegacyOutcome, type LegacyQuoteWrite, type LegacyUploadedPlan, type NotificationDeliveryContext } from "./legacy/types";
import { normalizeQuoteDraft, type QuoteDraft } from "./quote";
import { partnerDemoModeEnabled } from "./demo";
import { canonicalJson, normalizeSitePlanRenderInput, sitePlanRenderHash } from "./site-plan-hash";
import { WorkerClaimIntegrityError, type ClaimedSubmissionPlan, type ClaimedSubmissionSnapshot, type NotificationLease, type PartnerSubmissionWorkerStore, type SubmissionLease, type WorkerSafeErrorCode } from "./submission-worker-repository";
import { createPartnerWorkerDeadline, type MonotonicClock, type PartnerWorkerDeadline } from "./worker-deadline";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const own=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const bounded=(value:unknown,max:number)=>typeof value==="string"&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value)?value:null;
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max?Number(value):null;
const retryDelay=(identity:string,attempt:number)=>{
  const base=Math.min(5*60_000,5_000*2**Math.max(0,Math.min(attempt-1,6)));
  const jitter=createHash("sha256").update(`${identity}:${attempt}`).digest().readUInt16BE(0)%1_000;
  return base+jitter;
};

export interface ParsedWorkerSubmission {
  lead: LegacyLeadInput;
  quote: QuoteDraft;
  plans: readonly LegacyFrozenPlan[];
}

export class PartnerWorkerSnapshotError extends Error { constructor(){super("PARTNER_WORKER_SNAPSHOT_INTEGRITY");this.name="PartnerWorkerSnapshotError";} }

export function parseClaimedSubmission(lease:SubmissionLease,snapshot:ClaimedSubmissionSnapshot,rows:readonly ClaimedSubmissionPlan[],identity:LegacyAdapter["identity"]):ParsedWorkerSubmission {
  let value:unknown;try{value=JSON.parse(snapshot.canonicalDocument);}catch{throw new PartnerWorkerSnapshotError();}
  if(!own(value)||!exact(value,["schemaVersion","contract","job","plans"])||(value.schemaVersion!==1&&value.schemaVersion!==2)||!own(value.contract)||!own(value.job)||!Array.isArray(value.plans)
    ||createHash("sha256").update(snapshot.canonicalDocument).digest("hex")!==snapshot.snapshotSha256)throw new PartnerWorkerSnapshotError();
  const snapshotPlans=value.plans as unknown[];
  if(!exact(value.contract,["adapterMode","version","legacyJobPrefix"])||value.contract.adapterMode!==snapshot.adapterMode||value.contract.version!==snapshot.contractVersion||value.contract.legacyJobPrefix!==snapshot.legacyJobPrefix)throw new PartnerWorkerSnapshotError();
  const snapshotVersion=value.schemaVersion;
  const job=value.job;const expectedJobKeys=snapshotVersion===1?["id","companyId","revision","floorPlanRevision","clientReference","billingModel","customer","siteAddress","leadSources","notes","quote"]:["id","companyId","revision","floorPlanRevision","clientReference","customer","siteAddress","leadSources","notes","quote"];
  if((snapshotVersion!==1&&snapshotVersion!==2)||!exact(job,expectedJobKeys)
    ||job.id!==lease.jobId||job.companyId!==lease.companyId||!UUID.test(String(job.id))||!UUID.test(String(job.companyId))||integer(job.revision)===null||integer(job.floorPlanRevision)===null
    ||!own(job.customer)||!exact(job.customer,["name","mobile","email"])||!own(job.siteAddress)||!Array.isArray(job.leadSources)||typeof job.quote!=="object")throw new PartnerWorkerSnapshotError();
  const leadResult=validateLeadDraft({customerName:bounded(job.customer.name,160)??"",customerMobile:bounded(job.customer.mobile,40)??"",customerEmail:bounded(job.customer.email,254)??"",
    siteAddress:job.siteAddress as never,leadSources:[],notes:bounded(job.notes,4000)??""});
  const quoteResult=normalizeQuoteDraft(job.quote as QuoteDraft);const marker=legacySubmissionMarker(lease.companyId,lease.requestId);
  if(!leadResult.ok||!quoteResult.ok||!marker||rows.length!==snapshotPlans.length||rows.length<1||rows.length>20)throw new PartnerWorkerSnapshotError();
  // Schema v1 also includes historical snapshots with zero or multiple legacy sources.
  // Company-name attribution is enforced when freezing new submissions, not by rewriting old ones.
  if (job.leadSources.length > 6 || new Set(job.leadSources).size !== job.leadSources.length
    || job.leadSources.some(source => !bounded(source,160)?.trim())) throw new PartnerWorkerSnapshotError();
  const legacyBilling=snapshotVersion===1?job.billingModel:undefined;
  if(snapshotVersion===1&&legacyBilling!=="INSULHUB_BILLED"&&legacyBilling!=="PARTNER_BILLED")throw new PartnerWorkerSnapshotError();
  const leadBase={customer:{name:leadResult.value.customerName,mobile:leadResult.value.customerMobile,email:leadResult.value.customerEmail},siteAddress:leadResult.value.siteAddress,
    ...(legacyBilling?{billingModel:legacyBilling as "INSULHUB_BILLED"|"PARTNER_BILLED"}:{}),leadSources:job.leadSources as string[],notes:leadResult.value.notes};
  const lead:LegacyLeadInput={identity,marker,canonicalCreateFingerprint:legacyLeadCreateFingerprint(leadBase),...leadBase};
  const plans=rows.map((row,index):LegacyFrozenPlan=>{
    const plan=snapshotPlans[index];if(!own(plan)||!exact(plan,["ordinal","drawingId","name","drawingRevision","document","documentSha256","artifact","remoteFileName"])||!own(plan.artifact)
      ||!exact(plan.artifact,["id","renderHash","contentSha256","byteSize","rendererVersion","templateVersion","templateSha256","localFileName"])
      ||plan.ordinal!==index||plan.drawingId!==row.drawingId||plan.name!==row.drawingName||plan.drawingRevision!==row.drawingRevision||plan.documentSha256!==row.documentSha256
      ||plan.artifact.id!==row.artifactId||plan.artifact.renderHash!==row.renderHash||plan.artifact.contentSha256!==row.contentSha256||plan.artifact.byteSize!==row.byteSize
      ||plan.artifact.rendererVersion!==row.rendererVersion||plan.artifact.templateVersion!==row.templateVersion||plan.artifact.templateSha256!==row.templateSha256
      ||plan.artifact.localFileName!==row.localFileName||plan.remoteFileName!==row.remoteFileName||!SHA.test(row.contentSha256))throw new PartnerWorkerSnapshotError();
    const document=parseSitePlanDocument(plan.document);if(!document||createHash("sha256").update(canonicalJson(document)).digest("hex")!==row.documentSha256)throw new PartnerWorkerSnapshotError();
    const renderInput=normalizeSitePlanRenderInput({drawingName:row.drawingName,siteAddress:leadResult.value.siteAddress,document});
    if(sitePlanRenderHash(renderInput)!==row.renderHash||renderInput.rendererVersion!==row.rendererVersion||renderInput.templateVersion!==row.templateVersion||renderInput.templateSha256!==row.templateSha256)throw new PartnerWorkerSnapshotError();
    const frozen={ordinal:index,artifactId:row.artifactId,remoteFileName:row.remoteFileName,contentSha256:row.contentSha256,byteSize:row.byteSize,pdfBytes:new Uint8Array(row.pdfBytes),
      rendererVersion:row.rendererVersion,templateVersion:row.templateVersion,templateSha256:row.templateSha256};
    if(!validateLegacyFrozenPlan(identity,frozen))throw new PartnerWorkerSnapshotError();return frozen;
  });
  return {lead,quote:quoteResult.value,plans};
}

export interface PartnerWorkerMetrics { increment(name:"claimed"|"succeeded"|"released"|"reconciled"|"lease_lost"|"notification_delivered"|"notification_released"|"notification_dead",labels:{kind:"submission"|"notification";reason:string}):void }
const noMetrics:PartnerWorkerMetrics={increment:()=>undefined};
export const redactedPartnerWorkerMetrics:PartnerWorkerMetrics={increment:(name,labels)=>{
  const reason=/^[A-Za-z0-9_-]{1,48}$/.test(labels.reason)?labels.reason:"unknown";
  console.info(JSON.stringify({event:"partner_submission_worker_metric",name,kind:labels.kind,reason}));
}};
export interface PartnerSubmissionWorkerOptions {
  env?:NodeJS.ProcessEnv;clock?:MonotonicClock;deadlineMs?:number;leaseSeconds?:number;metrics?:PartnerWorkerMetrics;signal?:AbortSignal;
  processNotifications?:boolean;
  processSubmissions?:boolean;
  noRetryNotifications?:boolean;
  resolveAdapter?:(binding:BoundLegacyCredential)=>LegacyAdapterSelection;
  resolveLiveAdapter?:(binding:BoundLegacyCredential)=>ActualInsulhubAdapter|null;
  resolveNotificationAdapter?:()=>LegacyNotificationAdapter|null;
  resolveProductionNotificationAdapter?:()=>LegacyNotificationAdapter|null;
}
export interface PartnerWorkerRunSummary { submission:"IDLE"|"SUCCEEDED"|"RELEASED"|"RECONCILED"|"LEASE_LOST";notification:"IDLE"|"DELIVERED"|"RELEASED"|"DEAD"|"LEASE_LOST" }

class LeaseLost extends Error{}
class LeaseSupervisor {
  private timer:ReturnType<typeof setInterval>|null=null;private heartbeatInFlight:Promise<void>|null=null;
  constructor(readonly deadline:PartnerWorkerDeadline,private readonly heartbeat:()=>Promise<boolean>,private readonly intervalMs:number){}
  private beat():Promise<void>{
    if(this.heartbeatInFlight)return this.heartbeatInFlight;
    this.heartbeatInFlight=this.heartbeat().then(ok=>{if(!ok)throw new LeaseLost();}).catch(error=>{this.deadline.abort();throw error instanceof LeaseLost?error:new LeaseLost();}).finally(()=>{this.heartbeatInFlight=null;});
    return this.heartbeatInFlight;
  }
  start(){this.timer=setInterval(()=>{if(this.deadline.expired())return;void this.beat().catch(()=>undefined);},this.intervalMs);}
  assert(minimumMs=1){if(this.deadline.expired()||this.deadline.remainingMs()<minimumMs)throw new LeaseLost();}
  async fence(minimumMs=2_000){this.assert(minimumMs);await this.beat();this.assert(minimumMs);}
  async remote<T>(call:()=>Promise<T>):Promise<T>{
    await this.fence();let timer:ReturnType<typeof setTimeout>|null=null;
    const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{this.deadline.abort();reject(new LeaseLost());},Math.max(1,this.deadline.remainingMs()));});
    try{const value=await Promise.race([call(),expired]);await this.fence();return value;}finally{if(timer)clearTimeout(timer);}
  }
  async stop(){if(this.timer)clearInterval(this.timer);this.timer=null;try{await this.heartbeatInFlight;}catch{/* a lost fence is already reflected by the deadline */}}
}

function legacyFailureCode(outcome:Exclude<LegacyOutcome<unknown>,{kind:"CONFIRMED"}>):{terminal:boolean;code:WorkerSafeErrorCode}{
  if(outcome.kind==="AMBIGUOUS")return{terminal:true,code:"AMBIGUOUS_LEGACY_RESULT"};
  if(outcome.kind==="CONFLICT")return{terminal:true,code:"PROVIDER_REJECTED"};
  return ["LEGACY_NOT_FOUND","LEGACY_INVALID_INPUT","LEGACY_DUPLICATE_MARKER","LEGACY_ARCHIVED_MATCH","LEGACY_PAGINATION_INCOMPLETE","LEGACY_VERSION_CONFLICT","LEGACY_READBACK_MISMATCH","LEGACY_UPLOAD_INTEGRITY","LEGACY_CONTRACT_MISMATCH"].includes(outcome.code)
    ?{terminal:true,code:"PROVIDER_REJECTED"}:{terminal:false,code:"PROVIDER_UNAVAILABLE"};
}

function attachedSubset(remote:readonly LegacyAttachedPlan[],plans:readonly LegacyFrozenPlan[]):Map<number,LegacyUploadedPlan>|null{
  const byName=new Map(plans.map((plan,index)=>[plan.remoteFileName,{plan,index}]));const found=new Map<number,LegacyUploadedPlan>(),storageKeys=new Set<string>();
  for(const item of remote){const match=byName.get(item.remoteFileName);if(!match||found.has(match.index)||storageKeys.has(item.storageKey)||item.contentSha256!==match.plan.contentSha256||item.byteSize!==match.plan.byteSize||!validateLegacyUploadedPlan({remoteFileName:item.remoteFileName,storageKey:item.storageKey,contentSha256:item.contentSha256??"",byteSize:item.byteSize??0}))return null;
    storageKeys.add(item.storageKey);
    found.set(match.index,{remoteFileName:item.remoteFileName,storageKey:item.storageKey,contentSha256:item.contentSha256!,byteSize:item.byteSize!});}
  return found;
}

export class PartnerSubmissionWorkerEngine {
  private readonly env:NodeJS.ProcessEnv;private readonly leaseSeconds:number;private readonly deadlineMs:number;private readonly metrics:PartnerWorkerMetrics;
  constructor(private readonly repository:PartnerSubmissionWorkerStore,private readonly options:PartnerSubmissionWorkerOptions={}){
    this.env=options.env??process.env;this.leaseSeconds=options.leaseSeconds??120;this.deadlineMs=options.deadlineMs??50_000;this.metrics=options.metrics??noMetrics;
    if(!Number.isInteger(this.leaseSeconds)||this.leaseSeconds<30||this.leaseSeconds>900||!Number.isFinite(this.deadlineMs)||this.deadlineMs<1||this.deadlineMs>15*60_000
      ||this.leaseSeconds*1000<=this.deadlineMs+10_000)throw new Error("PARTNER_WORKER_UNSAFE_LEASE_BUDGET");
  }

  private fictionalExecutionAllowed():boolean{
    if(this.env.NODE_ENV==="test")return true;
    try{return partnerDemoModeEnabled(this.env);}catch{return false;}
  }

  private resolveAdapter(snapshot:ClaimedSubmissionSnapshot,lease:SubmissionLease):LegacyAdapterSelection{
    // E4 deliberately has no approved LIVE provider contract. This guard is
    // before the injectable resolver so tests or wiring cannot bypass it.
    if(snapshot.adapterMode==="LIVE"||!this.fictionalExecutionAllowed())return{kind:"UNAVAILABLE",code:"LEGACY_CONTRACT_MISMATCH"};
    const binding=BoundLegacyCredential.bind({companyId:lease.companyId,requestId:lease.requestId,adapterMode:snapshot.adapterMode,contractVersion:snapshot.contractVersion,legacyJobPrefix:snapshot.legacyJobPrefix,
      legacyBaseUrl:snapshot.legacyBaseUrl,legacyCredentialCiphertext:snapshot.legacyCredentialCiphertext,legacyCredentialNonce:snapshot.legacyCredentialNonce,
      legacyCredentialKeyVersion:snapshot.legacyCredentialKeyVersion,legacyCredentialFingerprint:snapshot.legacyCredentialFingerprint,legacyCredentialUpdatedAt:snapshot.legacyCredentialUpdatedAt},{env:this.env});
    return binding?(this.options.resolveAdapter?.(binding)??createLegacyAdapter(binding,{env:this.env})):{kind:"UNAVAILABLE",code:"LEGACY_CONTRACT_MISMATCH"};
  }

  private async settle(lease:SubmissionLease,outcome:Exclude<LegacyOutcome<unknown>,{kind:"CONFIRMED"}>):Promise<"RELEASED"|"RECONCILED"|"LEASE_LOST">{
    const mapped=legacyFailureCode(outcome);if(mapped.terminal){const ok=await this.repository.reconcileSubmission(lease,mapped.code);if(!ok){this.metrics.increment("lease_lost",{kind:"submission",reason:"fence"});return"LEASE_LOST";}this.metrics.increment("reconciled",{kind:"submission",reason:mapped.code});return"RECONCILED";}
    const result=await this.repository.releaseSubmission(lease,mapped.code,retryDelay(lease.requestId,lease.attemptNumber));
    if(result==="DENIED"){this.metrics.increment("lease_lost",{kind:"submission",reason:"fence"});return"LEASE_LOST";}
    this.metrics.increment(result==="RECONCILED"?"reconciled":"released",{kind:"submission",reason:mapped.code});return result;
  }

  private async releaseRead(lease:SubmissionLease,reason:WorkerSafeErrorCode="PROVIDER_TIMEOUT"):Promise<"RELEASED"|"RECONCILED"|"LEASE_LOST">{
    const result=await this.repository.releaseSubmission(lease,reason,retryDelay(lease.requestId,lease.attemptNumber));
    this.metrics.increment(result==="DENIED"?"lease_lost":result==="RECONCILED"?"reconciled":"released",{kind:"submission",reason:result==="DENIED"?"fence":reason});return result==="DENIED"?"LEASE_LOST":result;
  }

  private async reconcile(lease:SubmissionLease,reason:WorkerSafeErrorCode):Promise<"RECONCILED"|"LEASE_LOST">{
    const ok=await this.repository.reconcileSubmission(lease,reason);
    this.metrics.increment(ok?"reconciled":"lease_lost",{kind:"submission",reason:ok?reason:"fence"});return ok?"RECONCILED":"LEASE_LOST";
  }

  private async processLiveSubmission(lease:SubmissionLease,snapshot:ClaimedSubmissionSnapshot,rows:readonly ClaimedSubmissionPlan[],supervisor:LeaseSupervisor,deadline:PartnerWorkerDeadline):Promise<PartnerWorkerRunSummary["submission"]>{
    if(snapshot.contractVersion!==INSULHUB_LIVE_CONTRACT||!this.repository.beginLiveCreate||!this.repository.recordLiveCreate||!this.repository.liveCreateReceipt)return this.reconcile(lease,"PROVIDER_REJECTED");
    const binding=BoundLegacyCredential.bind({companyId:lease.companyId,requestId:lease.requestId,adapterMode:snapshot.adapterMode,contractVersion:snapshot.contractVersion,legacyJobPrefix:snapshot.legacyJobPrefix,
      legacyBaseUrl:snapshot.legacyBaseUrl,legacyCredentialCiphertext:snapshot.legacyCredentialCiphertext,legacyCredentialNonce:snapshot.legacyCredentialNonce,legacyCredentialKeyVersion:snapshot.legacyCredentialKeyVersion,
      legacyCredentialFingerprint:snapshot.legacyCredentialFingerprint,legacyCredentialUpdatedAt:snapshot.legacyCredentialUpdatedAt},{env:this.env});
    const adapter=binding?(this.options.resolveLiveAdapter?.(binding)??ActualInsulhubAdapter.from(binding)):null;if(!binding||!adapter)return this.reconcile(lease,"CREDENTIAL_ROTATED");
    let parsed:ParsedWorkerSubmission;try{parsed=parseClaimedSubmission(lease,snapshot,rows,binding.identity);}catch{return this.reconcile(lease,"MALFORMED_FROZEN_STATE");}
    let legacyId=snapshot.legacyJobId,legacyNumber=snapshot.legacyJobNumber,checkpoint=snapshot.checkpoint;
    const receipt=await this.repository.liveCreateReceipt(lease);supervisor.assert();
    if(receipt?.legacyId&&receipt.legacyNumber){
      if((legacyId&&legacyId!==receipt.legacyId)||(legacyNumber&&legacyNumber!==receipt.legacyNumber))return this.reconcile(lease,"PROVIDER_REJECTED");
      legacyId=receipt.legacyId;legacyNumber=receipt.legacyNumber;
      checkpoint="LEAD_CREATED";
    }
    if(!legacyId||!legacyNumber){
      if(snapshot.checkpoint!=="FROZEN")return this.reconcile(lease,"AMBIGUOUS_LEGACY_RESULT");
      if(deadline.remainingMs()<18_000)return this.releaseRead(lease,"PROVIDER_TIMEOUT");
      await supervisor.fence(18_000);
      const permit=await this.repository.beginLiveCreate(lease);if(!permit)throw new LeaseLost();
      // The full create budget is fenced before the durable permit is armed.
      // A confirmed response is still written through the permit if the
      // execution lease expires while InsulHub responds.
      const created=await adapter.createLead(parsed.lead,deadline);
      if(created.kind!=="CONFIRMED")return this.reconcile(lease,created.kind==="DEFINITE_FAILURE"?"PROVIDER_REJECTED":"AMBIGUOUS_LEGACY_RESULT");
      let recorded=false;for(let attempt=0;attempt<3&&!recorded;attempt+=1)recorded=await this.repository.recordLiveCreate(lease,permit,created.value.id,created.value.jobNumber).catch(()=>false);
      if(!recorded){this.metrics.increment("lease_lost",{kind:"submission",reason:"identity_receipt"});return"LEASE_LOST";}
      legacyId=created.value.id;legacyNumber=created.value.jobNumber;
      checkpoint="LEAD_CREATED";
    }
    const expectedNotes=[parsed.lead.notes.trim(),parsed.lead.marker].filter(Boolean).join("\n\n");
    const read=await supervisor.remote(()=>adapter.readJob(legacyId!,deadline));if(read.kind!=="CONFIRMED")return this.reconcile(lease,read.kind==="DEFINITE_FAILURE"?"PROVIDER_REJECTED":"PROVIDER_UNAVAILABLE");
    const job=read.value,contact=parsed.lead.customer,address=parsed.lead.siteAddress;
    if(job.id!==legacyId||job.jobNumber!==legacyNumber||job.archived||job.notes!==expectedNotes||canonicalJson(job.leadSources)!==canonicalJson(parsed.lead.leadSources)
      ||job.contact.name!==contact.name||job.contact.mobile!==contact.mobile||job.contact.email!==contact.email||job.contact.street!==address.street||job.contact.suburb!==address.suburb||job.contact.city!==address.city||job.contact.postcode!==address.postcode)return this.reconcile(lease,"PROVIDER_REJECTED");
    const intended=adapter.intendedQuote(legacyNumber,parsed.quote,job.files);
    if(snapshot.finalQuoteNumber&&snapshot.finalQuoteNumber!==intended.quoteNumber)return this.reconcile(lease,"PROVIDER_REJECTED");
    if(!adapter.quoteMatches(job,intended)){
      if(checkpoint==="QUOTE_UPDATED"||checkpoint==="PLANS_ATTACHED"||job.stage!=="LEAD")return this.reconcile(lease,"PROVIDER_REJECTED");
      if(deadline.remainingMs()<18_000)return this.releaseRead(lease,"PROVIDER_TIMEOUT");
      await supervisor.fence(18_000);
      const updated=await supervisor.remote(()=>adapter.updateQuote(legacyId!,intended,deadline));
      if(updated.kind!=="CONFIRMED"){
        const recovered=await supervisor.remote(()=>adapter.readJob(legacyId!,deadline));
        if(recovered.kind!=="CONFIRMED"||!adapter.quoteMatches(recovered.value,intended))return this.reconcile(lease,updated.kind==="DEFINITE_FAILURE"?"PROVIDER_REJECTED":"AMBIGUOUS_LEGACY_RESULT");
      }
    }
    const quoteRead=await supervisor.remote(()=>adapter.readJob(legacyId!,deadline));if(quoteRead.kind!=="CONFIRMED"||!adapter.quoteMatches(quoteRead.value,intended))return this.reconcile(lease,"PROVIDER_REJECTED");
    if(checkpoint==="LEAD_CREATED"&&!await this.repository.checkpointQuoteVerified(lease,intended.fingerprint))throw new LeaseLost();
    const uploaded=new Map<number,string>();
    for(const row of rows){
      if(row.remoteStorageKey){uploaded.set(row.ordinal,row.remoteStorageKey);continue;}
      if(row.deliveryState==="UPLOADING"||row.deliveryState==="RECONCILIATION_REQUIRED"||row.deliveryState==="ATTACHED")return this.reconcile(lease,"AMBIGUOUS_LEGACY_RESULT");
      if(quoteRead.value.files.includes(row.remoteFileName)){if(!await this.repository.adoptAttachedPlan(lease,row.ordinal,row.remoteFileName))throw new LeaseLost();uploaded.set(row.ordinal,row.remoteFileName);continue;}
      if(deadline.remainingMs()<23_000)return this.releaseRead(lease,"PROVIDER_TIMEOUT");
      await supervisor.fence(23_000);
      const started=await this.repository.beginUpload(lease,row.ordinal);if(started!=="STARTED")return started==="RECONCILED"?"RECONCILED":"LEASE_LOST";
      const result=await supervisor.remote(()=>adapter.uploadPlan(parsed.plans[row.ordinal],deadline));
      if(result.kind!=="CONFIRMED")return this.reconcile(lease,result.kind==="DEFINITE_FAILURE"?"PROVIDER_REJECTED":"AMBIGUOUS_LEGACY_RESULT");
      if(!await this.repository.checkpoint(lease,"PLAN_UPLOADED",{ordinal:row.ordinal,remoteKey:result.value}))throw new LeaseLost();uploaded.set(row.ordinal,result.value);
    }
    const fileNames=rows.map(row=>uploaded.get(row.ordinal)!);const beforeAttach=await supervisor.remote(()=>adapter.readJob(legacyId!,deadline));
    if(beforeAttach.kind!=="CONFIRMED")return this.reconcile(lease,"PROVIDER_UNAVAILABLE");
    if(!fileNames.every(name=>beforeAttach.value.files.includes(name))){
      if(deadline.remainingMs()<18_000)return this.releaseRead(lease,"PROVIDER_TIMEOUT");
      await supervisor.fence(18_000);
      const started=await this.repository.beginAttachment(lease);if(started!=="STARTED")return started==="RECONCILED"?"RECONCILED":"LEASE_LOST";
      const attached=await supervisor.remote(()=>adapter.attachPlans(legacyId!,fileNames,deadline));
      if(attached.kind!=="CONFIRMED"){
        const recovered=await supervisor.remote(()=>adapter.readJob(legacyId!,deadline));
        if(recovered.kind!=="CONFIRMED"||!fileNames.every(name=>recovered.value.files.includes(name)))return this.reconcile(lease,attached.kind==="DEFINITE_FAILURE"?"PROVIDER_REJECTED":"AMBIGUOUS_LEGACY_RESULT");
      }
    }
    const finalJob=await supervisor.remote(()=>adapter.readJob(legacyId!,deadline));if(finalJob.kind!=="CONFIRMED"||!adapter.quoteMatches(finalJob.value,intended)||!fileNames.every(name=>finalJob.value.files.includes(name)))return this.reconcile(lease,"PROVIDER_REJECTED");
    for(const row of rows)if(row.deliveryState!=="ATTACHED"&&!await this.repository.adoptAttachedPlan(lease,row.ordinal,uploaded.get(row.ordinal)!))throw new LeaseLost();
    if(!await this.repository.finalizeSubmission(lease,rows.length))throw new LeaseLost();this.metrics.increment("succeeded",{kind:"submission",reason:"verified_live"});return"SUCCEEDED";
  }

  private async processSubmission(lease:SubmissionLease,deadline:PartnerWorkerDeadline):Promise<PartnerWorkerRunSummary["submission"]>{
    const supervisor=new LeaseSupervisor(deadline,()=>this.repository.heartbeatSubmission(lease,this.leaseSeconds),Math.max(5_000,Math.floor(this.leaseSeconds*1000/3)));supervisor.start();
    const readFailure=async(outcome:Exclude<LegacyOutcome<unknown>,{kind:"CONFIRMED"}>)=>outcome.kind==="AMBIGUOUS"?this.releaseRead(lease,"PROVIDER_TIMEOUT")
      :outcome.kind==="DEFINITE_FAILURE"&&outcome.code==="LEGACY_REMOTE_NO_EFFECT"?this.releaseRead(lease,"PROVIDER_UNAVAILABLE"):this.settle(lease,outcome);
    try{
      await supervisor.fence();const snapshot=await this.repository.claimedSnapshot(lease);supervisor.assert();
      if(!snapshot)return await this.reconcile(lease,"CREDENTIAL_ROTATED");
      const rows=await this.repository.claimedPlans(lease);supervisor.assert();
      if(snapshot.adapterMode==="LIVE")return await this.processLiveSubmission(lease,snapshot,rows,supervisor,deadline);
      const selection=this.resolveAdapter(snapshot,lease);if(selection.kind!=="AVAILABLE")return await this.settle(lease,{kind:"DEFINITE_FAILURE",code:selection.code,noEffect:true});
      let parsed:ParsedWorkerSubmission;try{parsed=parseClaimedSubmission(lease,snapshot,rows,selection.adapter.identity);}catch{return await this.reconcile(lease,"MALFORMED_FROZEN_STATE");}
      const adapter=selection.adapter;
      const found=await supervisor.remote(()=>adapter.findLeadByMarker(parsed.lead.marker,parsed.lead.canonicalCreateFingerprint,deadline));
      if(found.kind!=="CONFIRMED")return await readFailure(found);let lead=found.value;
      if(lead&&snapshot.legacyJobId&&(lead.id!==snapshot.legacyJobId||lead.jobNumber!==snapshot.legacyJobNumber))return await this.reconcile(lease,"PROVIDER_REJECTED");
      if(!lead){
        if(snapshot.checkpoint!=="FROZEN"||snapshot.legacyJobId||snapshot.legacyJobNumber)return await this.reconcile(lease,"AMBIGUOUS_LEGACY_RESULT");
        if(!await this.repository.checkpoint(lease,"CREATE_STARTED"))throw new LeaseLost();
        const created=await supervisor.remote(()=>adapter.createLead(parsed.lead,deadline));
        if(created.kind==="CONFIRMED")lead=created.value;
        else if(created.kind==="AMBIGUOUS"){
          const recovered=await supervisor.remote(()=>adapter.findLeadByMarker(parsed.lead.marker,parsed.lead.canonicalCreateFingerprint,deadline));
          if(recovered.kind!=="CONFIRMED"||!recovered.value)return await this.reconcile(lease,"AMBIGUOUS_LEGACY_RESULT");lead=recovered.value;
        }else return await this.settle(lease,created);
      }
      if(!snapshot.legacyJobId||snapshot.checkpoint==="FROZEN"||snapshot.checkpoint==="CREATE_STARTED"){
        if(!await this.repository.checkpoint(lease,"LEAD_CREATED",{legacyId:lead.id,legacyNumber:lead.jobNumber}))throw new LeaseLost();
      }

      const current=await supervisor.remote(()=>adapter.getJob(lead!.id,deadline));if(current.kind!=="CONFIRMED")return await readFailure(current);
      const identityMatches=current.value.id===lead.id&&current.value.jobNumber===lead.jobNumber&&current.value.marker===parsed.lead.marker
        &&current.value.canonicalCreateFingerprint===parsed.lead.canonicalCreateFingerprint&&!current.value.archived;
      const finalQuote=deriveFinalQuoteNumber(snapshot.legacyJobPrefix,current.value.jobNumber);
      if(!identityMatches||!finalQuote||(snapshot.finalQuoteNumber!==null&&snapshot.finalQuoteNumber!==finalQuote))return await this.reconcile(lease,"PROVIDER_REJECTED");
      const quoteInput:LegacyQuoteWrite={identity:adapter.identity,legacyJobId:lead.id,expectedVersion:current.value.version,expectedCurrentFingerprint:current.value.quoteFingerprint,finalQuoteNumber:finalQuote,quote:parsed.quote};
      const mapped=mapLegacyFullQuote(quoteInput,current.value.preservation);if(!mapped)return await this.reconcile(lease,"MALFORMED_FROZEN_STATE");
      let intendedQuoteFingerprint:string;
      if(snapshot.checkpoint==="QUOTE_UPDATED"||snapshot.checkpoint==="PLANS_ATTACHED"){
        intendedQuoteFingerprint=snapshot.remoteQuoteFingerprint??"";
        if(!SHA.test(intendedQuoteFingerprint)||mapped.fingerprint!==intendedQuoteFingerprint||current.value.stage!=="QUOTE"||current.value.status!=="UNSET"||current.value.quoteFingerprint!==intendedQuoteFingerprint)return await this.reconcile(lease,"PROVIDER_REJECTED");
        const quoteRead=await supervisor.remote(()=>adapter.readQuote(lead!.id,deadline));if(quoteRead.kind!=="CONFIRMED")return await readFailure(quoteRead);
        if(quoteRead.value.fingerprint!==intendedQuoteFingerprint)return await this.reconcile(lease,"PROVIDER_REJECTED");
      }else{
        intendedQuoteFingerprint=mapped.fingerprint;
        if(current.value.quoteFingerprint===intendedQuoteFingerprint&&current.value.stage==="QUOTE"&&current.value.status==="UNSET"){
          if(!await this.repository.checkpointQuoteVerified(lease,intendedQuoteFingerprint))throw new LeaseLost();
        }else{
          if(current.value.stage!=="LEAD"||current.value.status!=="UNSET"||current.value.quoteFingerprint!==null)return await this.reconcile(lease,"PROVIDER_REJECTED");
          const quote=await supervisor.remote(()=>adapter.updateFullQuote(quoteInput,deadline));
          if(quote.kind==="AMBIGUOUS"){
            const recovered=await supervisor.remote(()=>adapter.getJob(lead!.id,deadline));
            if(recovered.kind!=="CONFIRMED")return await readFailure(recovered);
            if(recovered.value.quoteFingerprint===null&&recovered.value.stage==="LEAD")return await this.releaseRead(lease,"PROVIDER_TIMEOUT");
            if(recovered.value.quoteFingerprint!==intendedQuoteFingerprint||recovered.value.stage!=="QUOTE")return await this.reconcile(lease,"PROVIDER_REJECTED");
          }else if(quote.kind!=="CONFIRMED")return await this.settle(lease,quote);
          else if(quote.value.fingerprint!==intendedQuoteFingerprint)return await this.reconcile(lease,"PROVIDER_REJECTED");
          if(!await this.repository.checkpointQuoteVerified(lease,intendedQuoteFingerprint))throw new LeaseLost();
        }
      }

      const initialAttached=await supervisor.remote(()=>adapter.readAttachedPlans(lead!.id,deadline));if(initialAttached.kind!=="CONFIRMED")return await readFailure(initialAttached);
      const adopted=attachedSubset(initialAttached.value,parsed.plans);if(!adopted)return await this.reconcile(lease,"PROVIDER_REJECTED");
      for(const row of rows)if(row.deliveryState==="ATTACHED"&&!adopted.has(row.ordinal))return await this.reconcile(lease,"PROVIDER_REJECTED");
      const uploads=new Map<number,LegacyUploadedPlan>();
      for(const [ordinal,uploaded] of adopted){const row=rows[ordinal];if(row.remoteStorageKey&&row.remoteStorageKey!==uploaded.storageKey)return await this.reconcile(lease,"PROVIDER_REJECTED");
        if(row.deliveryState!=="ATTACHED"&&!await this.repository.adoptAttachedPlan(lease,ordinal,uploaded.storageKey))throw new LeaseLost();uploads.set(ordinal,uploaded);}
      for(const plan of parsed.plans){if(uploads.has(plan.ordinal))continue;const row=rows[plan.ordinal];
        if(row.deliveryState==="UPLOADED"){
          if(!row.remoteStorageKey)return await this.reconcile(lease,"MALFORMED_FROZEN_STATE");
          uploads.set(plan.ordinal,{remoteFileName:plan.remoteFileName,storageKey:row.remoteStorageKey,contentSha256:plan.contentSha256,byteSize:plan.byteSize});continue;
        }
        if(row.deliveryState==="ATTACHED"||row.deliveryState==="RECONCILIATION_REQUIRED")return await this.reconcile(lease,"PROVIDER_REJECTED");
        const uploadStart=await this.repository.beginUpload(lease,plan.ordinal);if(uploadStart==="RECONCILED"){this.metrics.increment("reconciled",{kind:"submission",reason:"UPLOAD_FAILED"});return"RECONCILED";}if(uploadStart!=="STARTED")throw new LeaseLost();
        const uploaded=await supervisor.remote(()=>adapter.uploadFrozenPlan(lead!.id,plan,deadline));
        if(uploaded.kind==="AMBIGUOUS")return await this.releaseRead(lease,"PROVIDER_TIMEOUT");
        if(uploaded.kind!=="CONFIRMED")return await this.settle(lease,uploaded);
        if(uploaded.value.remoteFileName!==plan.remoteFileName||uploaded.value.contentSha256!==plan.contentSha256||uploaded.value.byteSize!==plan.byteSize||!validateLegacyUploadedPlan(uploaded.value))return await this.reconcile(lease,"PROVIDER_REJECTED");
        if(!await this.repository.checkpoint(lease,"PLAN_UPLOADED",{ordinal:plan.ordinal,remoteKey:uploaded.value.storageKey}))throw new LeaseLost();uploads.set(plan.ordinal,uploaded.value);
      }

      const complete=parsed.plans.map(plan=>uploads.get(plan.ordinal)!);
      const beforeAttach=await supervisor.remote(()=>adapter.getJob(lead!.id,deadline));if(beforeAttach.kind!=="CONFIRMED")return await readFailure(beforeAttach);
      if(beforeAttach.value.id!==lead.id||beforeAttach.value.jobNumber!==lead.jobNumber||beforeAttach.value.marker!==parsed.lead.marker||beforeAttach.value.canonicalCreateFingerprint!==parsed.lead.canonicalCreateFingerprint
        ||beforeAttach.value.archived||beforeAttach.value.stage!=="QUOTE"||beforeAttach.value.status!=="UNSET"||beforeAttach.value.quoteFingerprint!==intendedQuoteFingerprint)return await this.reconcile(lease,"PROVIDER_REJECTED");
      const remoteBefore=await supervisor.remote(()=>adapter.readAttachedPlans(lead!.id,deadline));if(remoteBefore.kind!=="CONFIRMED")return await readFailure(remoteBefore);
      let subset=attachedSubset(remoteBefore.value,parsed.plans);if(!subset)return await this.reconcile(lease,"PROVIDER_REJECTED");
      if(subset.size!==parsed.plans.length){
        const attachStart=await this.repository.beginAttachment(lease);if(attachStart==="RECONCILED"){this.metrics.increment("reconciled",{kind:"submission",reason:"ATTACH_FAILED"});return"RECONCILED";}if(attachStart!=="STARTED")throw new LeaseLost();
        const attached=await supervisor.remote(()=>adapter.attachPlans(lead!.id,beforeAttach.value.version,complete,deadline));
        if(attached.kind==="DEFINITE_FAILURE")return await this.settle(lease,attached);
        const recovered=await supervisor.remote(()=>adapter.readAttachedPlans(lead!.id,deadline));
        if(recovered.kind!=="CONFIRMED")return await readFailure(recovered);subset=attachedSubset(recovered.value,parsed.plans);
        if(!subset)return await this.reconcile(lease,"PROVIDER_REJECTED");if(subset.size!==parsed.plans.length)return await this.releaseRead(lease,"PROVIDER_TIMEOUT");
        if(complete.some((uploaded,ordinal)=>subset!.get(ordinal)?.storageKey!==uploaded.storageKey))return await this.reconcile(lease,"PROVIDER_REJECTED");
      }

      const finalJob=await supervisor.remote(()=>adapter.getJob(lead!.id,deadline));if(finalJob.kind!=="CONFIRMED")return await readFailure(finalJob);
      const finalQuoteRead=await supervisor.remote(()=>adapter.readQuote(lead!.id,deadline));if(finalQuoteRead.kind!=="CONFIRMED")return await readFailure(finalQuoteRead);
      const finalPlans=await supervisor.remote(()=>adapter.readAttachedPlans(lead!.id,deadline));if(finalPlans.kind!=="CONFIRMED")return await readFailure(finalPlans);
      const exactFinal=attachedSubset(finalPlans.value,parsed.plans);const finalIdentity=finalJob.value.id===lead.id&&finalJob.value.jobNumber===lead.jobNumber&&finalJob.value.marker===parsed.lead.marker
        &&finalJob.value.canonicalCreateFingerprint===parsed.lead.canonicalCreateFingerprint&&!finalJob.value.archived&&finalJob.value.stage==="QUOTE"&&finalJob.value.status==="UNSET"
        &&deriveFinalQuoteNumber(snapshot.legacyJobPrefix,finalJob.value.jobNumber)===finalQuote;
      if(!finalIdentity||!exactFinal||exactFinal.size!==parsed.plans.length||complete.some((uploaded,ordinal)=>exactFinal.get(ordinal)?.storageKey!==uploaded.storageKey)||finalQuoteRead.value.fingerprint!==intendedQuoteFingerprint||finalJob.value.quoteFingerprint!==intendedQuoteFingerprint)return await this.reconcile(lease,"PROVIDER_REJECTED");
      for(const plan of parsed.plans){const uploaded=exactFinal.get(plan.ordinal)!;if(rows[plan.ordinal].deliveryState!=="ATTACHED"&&!await this.repository.adoptAttachedPlan(lease,plan.ordinal,uploaded.storageKey))throw new LeaseLost();}
      if(!await this.repository.finalizeSubmission(lease,parsed.plans.length))throw new LeaseLost();this.metrics.increment("succeeded",{kind:"submission",reason:"verified"});return"SUCCEEDED";
    }catch(error){
      if(error instanceof LeaseLost||deadline.expired()){this.metrics.increment("lease_lost",{kind:"submission",reason:"fence"});return"LEASE_LOST";}
      if(error instanceof WorkerClaimIntegrityError){const ok=await this.repository.reconcileSubmission(lease,"MALFORMED_FROZEN_STATE").catch(()=>false);this.metrics.increment(ok?"reconciled":"lease_lost",{kind:"submission",reason:ok?"MALFORMED_FROZEN_STATE":"fence"});return ok?"RECONCILED":"LEASE_LOST";}
      const result=await this.repository.releaseSubmission(lease,"NETWORK_ERROR",retryDelay(lease.requestId,lease.attemptNumber)).catch(()=>"DENIED" as const);this.metrics.increment(result==="DENIED"?"lease_lost":result==="RECONCILED"?"reconciled":"released",{kind:"submission",reason:result==="DENIED"?"fence":"NETWORK_ERROR"});return result==="DENIED"?"LEASE_LOST":result;
    }finally{await supervisor.stop();}
  }

  private async settleNotification(lease:NotificationLease,code:WorkerSafeErrorCode):Promise<"RELEASED"|"DEAD"|"LEASE_LOST">{
    if(this.options.noRetryNotifications)return await this.repository.reconcileNotification(lease,code).catch(()=>false)?"DEAD":"LEASE_LOST";
    const transition=await this.repository.releaseNotification(lease,code,retryDelay(lease.eventId,lease.attemptNumber)).catch(()=>"DENIED" as const);
    return transition==="DENIED"?"LEASE_LOST":transition;
  }

  private async processNotification(lease:NotificationLease,deadline:PartnerWorkerDeadline):Promise<PartnerWorkerRunSummary["notification"]>{
    const supervisor=new LeaseSupervisor(deadline,()=>this.repository.heartbeatNotification(lease,this.leaseSeconds),Math.max(5_000,Math.floor(this.leaseSeconds*1000/3)));supervisor.start();let deliveryStarted=false,providerReceipt:string|null=null,providerDelivered=false;
    try{const fictional=this.fictionalExecutionAllowed();const adapter=fictional?(this.options.resolveNotificationAdapter?.()??null):(this.options.resolveProductionNotificationAdapter?.()??null);if(!adapter)return this.settleNotification(lease,"PROVIDER_UNAVAILABLE");
      let delivery:NotificationDeliveryContext|undefined;
      if(!fictional&&lease.phase==="READY"){
        const origin=this.env.PARTNER_INSULHUB_APP_ORIGIN?.trim()??"";
        delivery=await this.repository.notificationDeliveryContext?.(lease,origin)??undefined;
        if(!delivery||!this.repository.beginNotificationDispatch||!await this.repository.beginNotificationDispatch(lease,delivery))throw new LeaseLost();
      }
      const result=lease.phase==="ACCEPTED_PENDING"&&lease.receipt
        ?await supervisor.remote(()=>adapter.lookup(lease.receipt!,deadline))
        :(deliveryStarted=true,await supervisor.remote(()=>adapter.deliver({eventId:lease.eventId,companyId:lease.companyId,jobId:lease.jobId,requestId:lease.requestId,
          fictionalSummary:lease.topic==="PARTNER_SUBMISSION_COMPLETED"?"SUBMISSION_COMPLETED":"RECONCILIATION_REQUIRED",...(delivery?{delivery}:{})},deadline)));
      if(result.kind==="DELIVERED"){
        const receipt="receipt" in result?result.receipt:lease.receipt;if(!receipt)return (await this.repository.reconcileNotification(lease,"NOTIFICATION_REJECTED"))?"DEAD":"LEASE_LOST";providerReceipt=receipt;providerDelivered=true;
        if(!await this.repository.checkpointNotificationAccepted(lease,receipt)||!await this.repository.finalizeNotification(lease,receipt))throw new LeaseLost();this.metrics.increment("notification_delivered",{kind:"notification",reason:"confirmed"});return"DELIVERED";
      }
      if(result.kind==="ENQUEUED"){
        providerReceipt=result.receipt;if(!await this.repository.checkpointNotificationAccepted(lease,result.receipt))throw new LeaseLost();const transition=await this.settleNotification(lease,"PROVIDER_TIMEOUT");
        if(transition==="LEASE_LOST")throw new LeaseLost();this.metrics.increment(transition==="DEAD"?"notification_dead":"notification_released",{kind:"notification",reason:"accepted_pending"});return transition;
      }
      if(result.kind==="PERMANENT"||result.kind==="AMBIGUOUS"){
        const ok=await this.repository.reconcileNotification(lease,result.kind==="PERMANENT"?"NOTIFICATION_REJECTED":"AMBIGUOUS_LEGACY_RESULT");if(!ok)throw new LeaseLost();this.metrics.increment("notification_dead",{kind:"notification",reason:result.kind.toLowerCase()});return"DEAD";
      }
      const transition=await this.settleNotification(lease,result.kind==="PENDING"?"PROVIDER_TIMEOUT":"PROVIDER_UNAVAILABLE");if(transition==="LEASE_LOST")throw new LeaseLost();
      this.metrics.increment(transition==="DEAD"?"notification_dead":"notification_released",{kind:"notification",reason:result.kind.toLowerCase()});return transition;
    }catch(error){
      if(error instanceof LeaseLost||deadline.expired()){this.metrics.increment("lease_lost",{kind:"notification",reason:"fence"});return"LEASE_LOST";}
      if(providerReceipt){
        try{if(!await this.repository.checkpointNotificationAccepted(lease,providerReceipt))throw new LeaseLost();if(providerDelivered){if(!await this.repository.finalizeNotification(lease,providerReceipt))throw new LeaseLost();this.metrics.increment("notification_delivered",{kind:"notification",reason:"receipt_recovered"});return"DELIVERED";}
          const transition=await this.settleNotification(lease,"PROVIDER_TIMEOUT");if(transition==="LEASE_LOST")throw new LeaseLost();return transition;
        }catch{this.metrics.increment("lease_lost",{kind:"notification",reason:"receipt_checkpoint"});return"LEASE_LOST";}
      }
      const transition=deliveryStarted&&lease.phase==="READY"
        ?await this.repository.reconcileNotification(lease,"AMBIGUOUS_LEGACY_RESULT").catch(()=>false)
        :await this.settleNotification(lease,"NETWORK_ERROR");
      if(transition===false||transition==="LEASE_LOST"){this.metrics.increment("lease_lost",{kind:"notification",reason:"fence"});return"LEASE_LOST";}
      const result: "DEAD"|"RELEASED"=deliveryStarted&&lease.phase==="READY"||transition==="DEAD"?"DEAD":"RELEASED";this.metrics.increment(result==="DEAD"?"notification_dead":"notification_released",{kind:"notification",reason:"exception"});return result;
    }finally{await supervisor.stop();}
  }

  async runOnce(workerId:string):Promise<PartnerWorkerRunSummary>{
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(workerId))throw new Error("PARTNER_WORKER_INVALID_ID");let submission:PartnerWorkerRunSummary["submission"]="IDLE",notification:PartnerWorkerRunSummary["notification"]="IDLE";
    const controller=new AbortController();if(this.options.signal?.aborted)controller.abort();else this.options.signal?.addEventListener("abort",()=>controller.abort(),{once:true});
    const deadline=createPartnerWorkerDeadline(this.deadlineMs,{clock:this.options.clock,controller});
    try{
    if(this.options.processSubmissions!==false)try{const claim=await this.repository.claimSubmission(workerId,this.leaseSeconds);if(claim){this.metrics.increment("claimed",{kind:"submission",reason:`queue_${claim.queueAgeBucket.toLowerCase()}`});if(claim.reclaimedLease)this.metrics.increment("claimed",{kind:"submission",reason:"reclaimed_lease"});}if(claim?.kind==="RECONCILED"){this.metrics.increment("reconciled",{kind:"submission",reason:"attempt_cap"});submission="RECONCILED";}else if(claim?.kind==="SUCCEEDED"){this.metrics.increment("succeeded",{kind:"submission",reason:"stale_execute_discarded"});submission="SUCCEEDED";}else if(claim?.kind==="LEASE"){
      if(deadline.remainingMs()<3_000){const transition=await this.repository.releaseSubmission(claim.lease,"PROVIDER_TIMEOUT",retryDelay(claim.lease.requestId,claim.lease.attemptNumber));submission=transition==="RELEASED"?"RELEASED":transition==="RECONCILED"?"RECONCILED":"LEASE_LOST";}else submission=await this.processSubmission(claim.lease,deadline);
    }}catch(error){if(!(error instanceof WorkerClaimIntegrityError))throw error;this.metrics.increment("lease_lost",{kind:"submission",reason:"claim_integrity"});submission="LEASE_LOST";}
    if(this.options.processNotifications!==false&&(deadline.remainingMs()>=15_000||this.options.noRetryNotifications))try{const claim=await this.repository.claimNotification(workerId,this.leaseSeconds);if(claim){this.metrics.increment("claimed",{kind:"notification",reason:`queue_${claim.queueAgeBucket.toLowerCase()}`});if(claim.reclaimedLease)this.metrics.increment("claimed",{kind:"notification",reason:"reclaimed_lease"});}if(claim?.kind==="DEAD"){this.metrics.increment("notification_dead",{kind:"notification",reason:"claim_terminal"});notification="DEAD";}else if(claim?.kind==="LEASE"){
      if(deadline.remainingMs()<3_000)notification=await this.settleNotification(claim.lease,"PROVIDER_TIMEOUT");else notification=await this.processNotification(claim.lease,deadline);
    }}catch(error){if(!(error instanceof WorkerClaimIntegrityError))throw error;this.metrics.increment("lease_lost",{kind:"notification",reason:"claim_integrity"});notification="LEASE_LOST";}
    return{submission,notification};
    }finally{deadline.dispose();}
  }
}
