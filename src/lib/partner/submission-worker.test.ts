import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PartnerSubmissionWorkerEngine } from "./submission-worker-engine";
import { PartnerSubmissionWorkerRepository, WorkerClaimIntegrityError, type ClaimedSubmissionPlan, type ClaimedSubmissionSnapshot, type NotificationLease, type SubmissionClaim, type SubmissionLease } from "./submission-worker-repository";
import type { LegacyAdapterSelection } from "./legacy/factory";
import { createPartnerWorkerDeadline } from "./worker-deadline";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";
import { normalizeSitePlanRenderInput, PARTNER_SITE_PLAN_RENDERER_VERSION, PARTNER_SITE_PLAN_TEMPLATE_SHA256, sitePlanRenderHash } from "./site-plan-hash";
import { buildPartnerSubmissionSnapshot, partnerSubmissionIdempotencyHash, type PartnerSubmissionCandidate } from "./submission";
import { createFictionalLegacyAdapterTestHarness, FictionalLegacyWorld } from "./legacy/fake";
import { createFictionalNotificationAdapterTestHarness, FictionalNotificationWorld } from "./legacy/notification";
import type { LegacyAdapterIdentity,LegacyNotificationAdapter,NotificationDeliveryContext } from "./legacy/types";
import { encryptLegacyCredential } from "./legacy-credentials";
import { INSULHUB_GRAPHQL_ENDPOINT, INSULHUB_LIVE_CONTRACT, type ActualInsulhubJob } from "./legacy/insulhub-live";

const ids = {
  company: "11111111-1111-4111-8111-111111111111",
  job: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
  snapshot: "44444444-4444-4444-8444-444444444444",
  lease: "55555555-5555-4555-8555-555555555555",
  event: "66666666-6666-4666-8666-666666666666",
} as const;

function orchestrationFixture(planCount=2){
  const quote=createQuoteDraft(PRODUCT_QUOTE_DEFAULTS,"LOCAL-READY","2026-08-30T00:00:00.000Z");quote.wall={enabled:true,areaSqm:100,rateCentsPerSqm:1000,cavityDepthCm:10};
  const siteAddress={street:"12 Māhoe Road",suburb:"Ōtāhuhu",city:"Auckland",postcode:"1062"};
  const plans=Array.from({length:planCount},(_,index)=>{const drawingId=`77777777-7777-4777-8777-${String(index+1).padStart(12,"0")}`,artifactId=`88888888-8888-4888-8888-${String(index+1).padStart(12,"0")}`;
    const document={...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:`wall-${index}`,start:{x:1,y:1},end:{x:5,y:1},style:"solid" as const}]};const name=`Floor ${index+1}`;const input=normalizeSitePlanRenderInput({drawingName:name,siteAddress,document});const bytes=Buffer.from(`%PDF-1.7\nworker plan ${index}\n%%EOF\n`);
    return{id:drawingId,name,sortOrder:index,revision:2,document,currentArtifact:{id:artifactId,drawingRevision:2,renderHash:sitePlanRenderHash(input),contentSha256:createHash("sha256").update(bytes).digest("hex"),byteSize:bytes.length,bytes,rendererVersion:PARTNER_SITE_PLAN_RENDERER_VERSION,templateVersion:input.templateVersion,templateSha256:PARTNER_SITE_PLAN_TEMPLATE_SHA256,localFileName:`${name}.pdf`}};});
  const candidate:PartnerSubmissionCandidate={companyId:ids.company,companyName:"Northwind Insulation",idempotencyKeyHash:partnerSubmissionIdempotencyHash("worker-orchestration-stable-key"),companyAdapterMode:"FICTIONAL",companyContractVersion:"fictional-v1",companyLegacyJobPrefix:"NW",jobId:ids.job,jobRevision:4,floorPlanRevision:2,submissionState:"DRAFT",clientReference:"DRAFT-1",customerName:"Hine Te Rangi",customerMobile:"021 555 0123",customerEmail:"",siteAddress,leadSources:[],notes:"Kia ora",quote,plans};
  const built=buildPartnerSubmissionSnapshot(candidate,{environment:"test"});const snapshotPlans=(JSON.parse(built.canonicalDocument) as {plans:Array<{name:string;documentSha256:string;artifact:{rendererVersion:string;templateVersion:string;templateSha256:string;localFileName:string}}>}).plans;
  const claimedSnapshot:ClaimedSubmissionSnapshot={canonicalDocument:built.canonicalDocument,snapshotSha256:built.candidateSnapshotSha256,adapterMode:"FICTIONAL",contractVersion:"fictional-v1",legacyJobPrefix:"NW",checkpoint:"FROZEN",legacyJobId:null,legacyJobNumber:null,finalQuoteNumber:null,legacyBaseUrl:null,legacyCredentialCiphertext:null,legacyCredentialNonce:null,legacyCredentialKeyVersion:null,legacyCredentialFingerprint:null,legacyCredentialUpdatedAt:null,remoteQuoteFingerprint:null};
  const claimedPlans:ClaimedSubmissionPlan[]=built.manifest.map((manifest,index)=>({ordinal:index,drawingId:manifest.drawingId,artifactId:manifest.artifactId,drawingRevision:manifest.drawingRevision,drawingName:snapshotPlans[index].name,documentSha256:snapshotPlans[index].documentSha256,renderHash:manifest.renderHash,rendererVersion:snapshotPlans[index].artifact.rendererVersion,templateVersion:snapshotPlans[index].artifact.templateVersion,templateSha256:snapshotPlans[index].artifact.templateSha256,localFileName:snapshotPlans[index].artifact.localFileName,remoteFileName:manifest.remoteFileName,contentSha256:manifest.contentSha256,byteSize:manifest.byteSize,pdfBytes:Buffer.from(plans[index].currentArtifact!.bytes),deliveryState:"PENDING",remoteStorageKey:null}));
  const lease:SubmissionLease={companyId:ids.company,jobId:ids.job,requestId:built.requestId,snapshotId:ids.snapshot,leaseToken:ids.lease,fenceToken:1,attemptNumber:1};
  const identity:LegacyAdapterIdentity={companyId:ids.company,requestId:built.requestId,adapterMode:"FICTIONAL",contractVersion:"fictional-v1",legacyJobPrefix:"NW",baseUrl:null,credentialKeyVersion:null,credentialFingerprint:null,credentialUpdatedAt:null};
  let completed=false,attempt=0;const repository={
    claimSubmission:vi.fn<()=>Promise<SubmissionClaim|null>>(async()=>completed?null:{kind:"LEASE",lease:{...lease,attemptNumber:++attempt},queueAgeBucket:"LT_1M",reclaimedLease:attempt>1}),claimNotification:vi.fn(async()=>null),heartbeatSubmission:vi.fn(async()=>true),
    claimedSnapshot:vi.fn(async()=>({...claimedSnapshot})),claimedPlans:vi.fn(async()=>claimedPlans.map(row=>({...row,pdfBytes:Buffer.from(row.pdfBytes)}))),
    checkpoint:vi.fn(async(_lease:SubmissionLease,phase:string,values:Record<string,unknown>={})=>{if(phase==="CREATE_STARTED")claimedSnapshot.checkpoint="CREATE_STARTED";if(phase==="LEAD_CREATED"){claimedSnapshot.checkpoint="LEAD_CREATED";claimedSnapshot.legacyJobId=String(values.legacyId);claimedSnapshot.legacyJobNumber=Number(values.legacyNumber);}if(phase==="PLAN_UPLOADED"){const row=claimedPlans[Number(values.ordinal)];row.deliveryState="UPLOADED";row.remoteStorageKey=String(values.remoteKey);}return true;}),
    checkpointQuoteVerified:vi.fn(async(_lease:SubmissionLease,fingerprint:string)=>{claimedSnapshot.checkpoint="QUOTE_UPDATED";claimedSnapshot.remoteQuoteFingerprint=fingerprint;claimedSnapshot.finalQuoteNumber=`NW-${claimedSnapshot.legacyJobNumber}`;return true;}),
    beginUpload:vi.fn<()=>Promise<"STARTED"|"RECONCILED"|"DENIED">>(async()=>"STARTED"),beginAttachment:vi.fn(async()=>"STARTED" as const),adoptAttachedPlan:vi.fn(async(_lease:SubmissionLease,ordinal:number,key:string)=>{claimedPlans[ordinal].deliveryState="ATTACHED";claimedPlans[ordinal].remoteStorageKey=key;return true;}),
    releaseSubmission:vi.fn<()=>Promise<"RELEASED"|"RECONCILED"|"DENIED">>(async()=>"RELEASED"),reconcileSubmission:vi.fn(async()=>{completed=true;return true;}),finalizeSubmission:vi.fn(async()=>{completed=true;claimedSnapshot.checkpoint="PLANS_ATTACHED";return true;}),
  };
  const world=new FictionalLegacyWorld();const adapter=createFictionalLegacyAdapterTestHarness(identity,world)!;
  const engine=()=>new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"test"},deadlineMs:20_000,leaseSeconds:120,resolveAdapter:()=>({kind:"AVAILABLE",adapter})});
  return{engine,repository,adapter,world,claimedSnapshot,claimedPlans,lease,isCompleted:()=>completed};
}

function liveOrchestrationFixture(createOutcome:"CONFIRMED"|"AMBIGUOUS"="CONFIRMED",options:{deadlineMs?:number;advanceAfterQuoteMs?:number;advanceAfterUploadMs?:number}={}){
  const fixture=orchestrationFixture(1),key=Buffer.alloc(32,4),env:NodeJS.ProcessEnv={NODE_ENV:"production",PARTNER_CREDENTIAL_ACTIVE_KEY_VERSION:"1",PARTNER_CREDENTIAL_KEYS_JSON:JSON.stringify({1:key.toString("base64")}),PARTNER_LEGACY_ALLOWED_ORIGINS:"https://api.insulhub.nz"};
  const encrypted=encryptLegacyCredential({accessToken:"live-token"},{companyId:ids.company,endpoint:INSULHUB_GRAPHQL_ENDPOINT},{activeVersion:1,keys:new Map([[1,key]])});
  const frozen=JSON.parse(fixture.claimedSnapshot.canonicalDocument);frozen.contract={adapterMode:"LIVE",version:INSULHUB_LIVE_CONTRACT,legacyJobPrefix:"NW"};fixture.claimedSnapshot.canonicalDocument=JSON.stringify(frozen);fixture.claimedSnapshot.snapshotSha256=createHash("sha256").update(fixture.claimedSnapshot.canonicalDocument).digest("hex");
  Object.assign(fixture.claimedSnapshot,{adapterMode:"LIVE",contractVersion:INSULHUB_LIVE_CONTRACT,legacyBaseUrl:INSULHUB_GRAPHQL_ENDPOINT,legacyCredentialCiphertext:encrypted.ciphertext,legacyCredentialNonce:encrypted.nonce,legacyCredentialKeyVersion:1,legacyCredentialFingerprint:createHash("sha256").update(encrypted.ciphertext).update(encrypted.nonce).digest("hex"),legacyCredentialUpdatedAt:"2026-09-01T00:00:00.000Z"});
  let now=0,receipt:{permitId:string;legacyId:string|null;legacyNumber:number|null}|null=null,quoteWritten=false,files:string[]=[];const createLead=vi.fn(async()=>createOutcome==="CONFIRMED"?{kind:"CONFIRMED" as const,value:{id:"64abcdefabcdefabcdefabcd",jobNumber:321}}:{kind:"AMBIGUOUS" as const,code:"LEGACY_RESPONSE_AMBIGUOUS" as const});
  const current=():ActualInsulhubJob=>({id:"64abcdefabcdefabcdefabcd",jobNumber:321,stage:quoteWritten?"QUOTE":"LEAD",notes:`Kia ora\n\nPARTNER-SUBMISSION:${ids.company}:${fixture.lease.requestId}`,archived:false,leadSources:["Northwind Insulation"],contact:{name:"Hine Te Rangi",mobile:"021 555 0123",email:"",street:"12 Māhoe Road",suburb:"Ōtāhuhu",city:"Auckland",postcode:"1062"},quote:quoteWritten?{ok:true}:null,files:[...files]});
  const adapter={createLead,readJob:vi.fn(async()=>({kind:"CONFIRMED" as const,value:current()})),intendedQuote:()=>({quoteNumber:"NW-321",payload:{quote:{ok:true}},fingerprint:"a".repeat(64)}),quoteMatches:(job:ActualInsulhubJob)=>job.stage==="QUOTE"&&job.quote?.ok===true,updateQuote:vi.fn(async()=>{quoteWritten=true;now+=options.advanceAfterQuoteMs??0;return{kind:"CONFIRMED" as const,value:true as const};}),uploadPlan:vi.fn(async()=>{now+=options.advanceAfterUploadMs??0;return{kind:"CONFIRMED" as const,value:"stored-plan.pdf"};}),attachPlans:vi.fn(async(_id:string,names:readonly string[])=>{files=[...names];return{kind:"CONFIRMED" as const,value:true as const};})};
  const beginLiveCreate=vi.fn(async()=>{fixture.claimedSnapshot.checkpoint="CREATE_STARTED";receipt={permitId:"99999999-9999-4999-8999-999999999999",legacyId:null,legacyNumber:null};return receipt.permitId;});
  const recordLiveCreate=vi.fn(async(_lease:unknown,_permit:string,id:string,number:number)=>{receipt={permitId:"99999999-9999-4999-8999-999999999999",legacyId:id,legacyNumber:number};fixture.claimedSnapshot.checkpoint="LEAD_CREATED";fixture.claimedSnapshot.legacyJobId=id;fixture.claimedSnapshot.legacyJobNumber=number;return true;});
  Object.assign(fixture.repository,{beginLiveCreate,recordLiveCreate,liveCreateReceipt:vi.fn(async()=>receipt)});
  const engine=()=>new PartnerSubmissionWorkerEngine(fixture.repository as unknown as PartnerSubmissionWorkerRepository,{env,clock:{now:()=>now},deadlineMs:options.deadlineMs??60_000,leaseSeconds:120,resolveLiveAdapter:()=>adapter as never});
  return{...fixture,engine,adapter,beginLiveCreate,recordLiveCreate,setReceipt:(value:typeof receipt)=>{receipt=value;}};
}

describe("submission worker repository claim boundary", () => {
  it("strictly parses safe claim telemetry from the same claimed row", async () => {
    const query = vi.fn(async () => ({ rows: [{ company_id: ids.company, job_id: ids.job, request_id: ids.request, snapshot_id: ids.snapshot,
      lease_token: ids.lease, fence_token: "3", attempt_number: 2, claim_status: "CLAIMED", queue_age_bucket: "LT_5M", reclaimed_lease: true }] }));
    const repository = new PartnerSubmissionWorkerRepository({ query } as never);
    await expect(repository.claimSubmission("worker-a")).resolves.toEqual({ kind: "LEASE", queueAgeBucket: "LT_5M", reclaimedLease: true,
      lease: { companyId: ids.company, jobId: ids.job, requestId: ids.request, snapshotId: ids.snapshot, leaseToken: ids.lease, fenceToken: 3, attemptNumber: 2 } });
  });

  it("rejects malformed telemetry and corrupt PDF projections instead of coercing them", async () => {
    const malformedClaim = new PartnerSubmissionWorkerRepository({ query: vi.fn(async () => ({ rows: [{ claim_status: "RECONCILED", queue_age_bucket: "customer@example.test", reclaimed_lease: false }] })) } as never);
    await expect(malformedClaim.claimSubmission("worker-a")).rejects.toBeInstanceOf(WorkerClaimIntegrityError);

    const malformedPdf = new PartnerSubmissionWorkerRepository({ query: vi.fn(async () => ({ rows: [{ ordinal: 0, drawing_id: ids.job, artifact_id: ids.snapshot,
      drawing_revision: 0, drawing_name: "Ground", document_sha256: "a".repeat(64), render_hash: "b".repeat(64), renderer_version: "renderer-v1",
      template_version: "template-v1", template_sha256: "c".repeat(64), local_file_name: "Ground.pdf", remote_file_name: "safe.pdf",
      content_sha256: "d".repeat(64), byte_size: 20, pdf_bytes: "not-bytea", delivery_state: "PENDING", remote_storage_key: null }] })) } as never);
    await expect(malformedPdf.claimedPlans({ companyId: ids.company, jobId: ids.job, requestId: ids.request, leaseToken: ids.lease, fenceToken: 1 })).rejects.toBeInstanceOf(WorkerClaimIntegrityError);
  });

  it("uses the atomic exact-request claim for the one-shot live test repository",async()=>{
    const query=vi.fn(async()=>({rows:[]}));
    const repository=new PartnerSubmissionWorkerRepository({query} as never,{liveTestRequestId:ids.request});
    await expect(repository.claimSubmission("live-test",300)).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith("SELECT * FROM partner_claim_live_test_request($1,$2,$3)",[ids.request,"live-test",300]);
    expect(()=>new PartnerSubmissionWorkerRepository({query} as never,{liveTestRequestId:"wrong"})).toThrow("PARTNER_LIVE_TEST_REQUEST_INVALID");
  });

  it("scopes immediate submission and notification claims to one frozen request",async()=>{
    const query=vi.fn(async()=>({rows:[]}));
    const repository=new PartnerSubmissionWorkerRepository({query} as never,{immediateScope:{companyId:ids.company,jobId:ids.job,requestId:ids.request}});
    await repository.claimSubmission("immediate",300);await repository.claimNotification("immediate",300);
    expect(query.mock.calls[0]).toEqual(["SELECT * FROM partner_claim_submission_exact($1,$2,$3,$4,$5)",[ids.company,ids.job,ids.request,"immediate",300]]);
    expect(query.mock.calls[1]).toEqual(["SELECT * FROM partner_claim_submission_notification_exact($1,$2,$3,$4,$5)",[ids.company,ids.job,ids.request,"immediate",300]]);
  });
});

describe("submission worker hard execution boundaries", () => {
  it("uses a monotonic budget and actively aborts at its deadline", () => {
    vi.useFakeTimers();let monotonic=100;const deadline=createPartnerWorkerDeadline(500,{clock:{now:()=>monotonic}});
    const wallClock=Date.now();vi.setSystemTime(wallClock+24*60*60_000);expect(deadline.remainingMs()).toBe(500);
    monotonic=350;expect(deadline.remainingMs()).toBe(250);vi.advanceTimersByTime(500);expect(deadline.signal.aborted).toBe(true);deadline.dispose();vi.useRealTimers();
  });
  it("does not import customer or partner communication delivery code", () => {
    const imports=["src/lib/partner/submission-worker-engine.ts","src/lib/partner/immediate-submission.ts"]
      .flatMap(file=>readFileSync(resolve(file),"utf8").split("\n").filter(line=>line.startsWith("import "))).join("\n");
    expect(imports).not.toMatch(/(?:email|sms|campaign|communication-delivery|resend|twilio)/i);
  });
  it("can run the exact live submission without claiming any notification",async()=>{
    const repository={claimSubmission:vi.fn(async()=>null),claimNotification:vi.fn(async()=>null)};
    const engine=new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"test"},deadlineMs:20_000,leaseSeconds:120,processNotifications:false});
    await expect(engine.runOnce("live-test-only")).resolves.toEqual({submission:"IDLE",notification:"IDLE"});
    expect(repository.claimNotification).not.toHaveBeenCalled();
  });
  it("can run an exact notification without claiming or creating any submission",async()=>{
    const repository={claimSubmission:vi.fn(async()=>null),claimNotification:vi.fn(async()=>null)};
    const engine=new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"development"},deadlineMs:20_000,leaseSeconds:120,processSubmissions:false});
    await expect(engine.runOnce("notification-only")).resolves.toEqual({submission:"IDLE",notification:"IDLE"});expect(repository.claimSubmission).not.toHaveBeenCalled();expect(repository.claimNotification).toHaveBeenCalledOnce();
  });
  it("rejects a lease budget that cannot preserve remote-call headroom", () => {
    expect(() => new PartnerSubmissionWorkerEngine({} as PartnerSubmissionWorkerRepository, { leaseSeconds: 30, deadlineMs: 25_000 })).toThrow("PARTNER_WORKER_UNSAFE_LEASE_BUDGET");
  });

  it("never invokes injected fictional resolvers in production", async () => {
    const lease: NotificationLease = { eventId: ids.event, companyId: ids.company, jobId: ids.job, requestId: ids.request,
      topic: "PARTNER_SUBMISSION_COMPLETED", phase: "READY", receipt: null, leaseToken: ids.lease, fenceToken: 1, attemptNumber: 1 };
    const resolveNotificationAdapter = vi.fn();const resolveAdapter = vi.fn();
    const repository = {
      claimSubmission: vi.fn(async () => null),
      claimNotification: vi.fn(async () => ({ kind: "LEASE" as const, lease, queueAgeBucket: "LT_1M" as const, reclaimedLease: false })),
      releaseNotification: vi.fn(async () => "RELEASED" as const),
      heartbeatNotification: vi.fn(async () => true),
    };
    const engine = new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository, {
      env: { NODE_ENV: "production", PARTNER_DEMO_MODE: "true" }, resolveAdapter, resolveNotificationAdapter, deadlineMs: 20_000, leaseSeconds: 120,
    });
    const snapshot={adapterMode:"FICTIONAL",contractVersion:"fictional-v1",legacyJobPrefix:"NW"} as ClaimedSubmissionSnapshot;
    const submissionLease={companyId:ids.company,jobId:ids.job,requestId:ids.request} as SubmissionLease;
    const selection=(engine as unknown as {resolveAdapter(snapshot:ClaimedSubmissionSnapshot,lease:SubmissionLease):LegacyAdapterSelection}).resolveAdapter(snapshot,submissionLease);
    expect(selection.kind).toBe("UNAVAILABLE");expect(resolveAdapter).not.toHaveBeenCalled();
    await expect(engine.runOnce("worker-production")).resolves.toEqual({ submission: "IDLE", notification: "RELEASED" });
    expect(resolveNotificationAdapter).not.toHaveBeenCalled();
  });
  it("commits the production SEND_STARTED fence before Gmail delivery and finalizes its receipt",async()=>{
    const lease:NotificationLease={eventId:ids.event,companyId:ids.company,jobId:ids.job,requestId:ids.request,topic:"PARTNER_SUBMISSION_COMPLETED",phase:"READY",receipt:null,leaseToken:ids.lease,fenceToken:1,attemptNumber:1};
    const delivery:NotificationDeliveryContext={recipientEmail:"reddyn.wallace@gmail.com",companyName:"Northwind Insulation",customerName:"Hine Te Rangi",propertyAddress:{street:"14 Rimu Street",suburb:"Te Aro",city:"Wellington",postcode:"6011"},quoteTotalCents:152950,legacyJobId:"6a979ecce193712a011df66d",legacyJobNumber:28859,jobUrl:"http://127.0.0.1:3000/jobs/6a979ecce193712a011df66d"};let done=false;
    const adapter:LegacyNotificationAdapter={deliver:vi.fn(async()=>({kind:"DELIVERED",receipt:"gmail:message_1"} as const)),lookup:vi.fn()};
    const repository={claimSubmission:vi.fn(),claimNotification:vi.fn(async()=>done?null:{kind:"LEASE" as const,lease,queueAgeBucket:"LT_1M" as const,reclaimedLease:false}),notificationDeliveryContext:vi.fn(async()=>delivery),beginNotificationDispatch:vi.fn(async()=>true),heartbeatNotification:vi.fn(async()=>true),checkpointNotificationAccepted:vi.fn(async()=>true),finalizeNotification:vi.fn(async()=>{done=true;return true;}),releaseNotification:vi.fn(),reconcileNotification:vi.fn()};
    const fictional=vi.fn(),production=vi.fn(()=>adapter);const engine=new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"development",PARTNER_INSULHUB_APP_ORIGIN:"http://127.0.0.1:3000"},deadlineMs:20_000,leaseSeconds:120,processSubmissions:false,resolveNotificationAdapter:fictional,resolveProductionNotificationAdapter:production});
    await expect(engine.runOnce("production-notification")).resolves.toEqual({submission:"IDLE",notification:"DELIVERED"});expect(fictional).not.toHaveBeenCalled();expect(production).toHaveBeenCalledOnce();expect(repository.beginNotificationDispatch).toHaveBeenCalledWith(lease,delivery);expect(adapter.deliver).toHaveBeenCalledWith(expect.objectContaining({delivery}),expect.anything());
    expect(repository.beginNotificationDispatch.mock.invocationCallOrder[0]).toBeLessThan((adapter.deliver as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);expect(repository.checkpointNotificationAccepted).toHaveBeenCalledWith(lease,"gmail:message_1");expect(repository.finalizeNotification).toHaveBeenCalledWith(lease,"gmail:message_1");
  });
  it("dead-letters an ambiguous post-fence production result and never retries in the engine",async()=>{
    const lease:NotificationLease={eventId:ids.event,companyId:ids.company,jobId:ids.job,requestId:ids.request,topic:"PARTNER_SUBMISSION_COMPLETED",phase:"READY",receipt:null,leaseToken:ids.lease,fenceToken:1,attemptNumber:1};
    const delivery:NotificationDeliveryContext={recipientEmail:"reddyn.wallace@gmail.com",companyName:"Northwind",customerName:"Hine Te Rangi",propertyAddress:{street:"14 Rimu Street",suburb:"Te Aro",city:"Wellington",postcode:"6011"},quoteTotalCents:152950,legacyJobId:"6a979ecce193712a011df66d",legacyJobNumber:28859,jobUrl:"http://127.0.0.1:3000/jobs/6a979ecce193712a011df66d"};const adapter:LegacyNotificationAdapter={deliver:vi.fn(async()=>({kind:"AMBIGUOUS"} as const)),lookup:vi.fn()};
    const repository={claimSubmission:vi.fn(),claimNotification:vi.fn(async()=>({kind:"LEASE" as const,lease,queueAgeBucket:"LT_1M" as const,reclaimedLease:false})),notificationDeliveryContext:vi.fn(async()=>delivery),beginNotificationDispatch:vi.fn(async()=>true),heartbeatNotification:vi.fn(async()=>true),reconcileNotification:vi.fn(async()=>true)};
    const engine=new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"development",PARTNER_INSULHUB_APP_ORIGIN:"http://127.0.0.1:3000"},deadlineMs:20_000,leaseSeconds:120,processSubmissions:false,resolveProductionNotificationAdapter:()=>adapter});
    await expect(engine.runOnce("ambiguous-production-notification")).resolves.toEqual({submission:"IDLE",notification:"DEAD"});expect(repository.reconcileNotification).toHaveBeenCalledWith(lease,"AMBIGUOUS_LEGACY_RESULT");expect(adapter.deliver).toHaveBeenCalledOnce();
  });
  it.each(["UNAVAILABLE","ENQUEUED","SHORT_BUDGET"] as const)("terminalizes an immediate %s notification instead of leaving retry work",async(outcome)=>{
    const lease:NotificationLease={eventId:ids.event,companyId:ids.company,jobId:ids.job,requestId:ids.request,topic:"PARTNER_SUBMISSION_COMPLETED",phase:"READY",receipt:null,leaseToken:ids.lease,fenceToken:1,attemptNumber:1};
    const repository={claimSubmission:vi.fn(async()=>null),claimNotification:vi.fn(async()=>({kind:"LEASE" as const,lease,queueAgeBucket:"LT_1M" as const,reclaimedLease:false})),heartbeatNotification:vi.fn(async()=>true),checkpointNotificationAccepted:vi.fn(async()=>true),reconcileNotification:vi.fn(async()=>true),releaseNotification:vi.fn()};
    const adapter:LegacyNotificationAdapter={deliver:vi.fn(async()=>({kind:"ENQUEUED" as const,receipt:"fictional:queued"})),lookup:vi.fn()};
    const engine=new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"test"},deadlineMs:outcome==="SHORT_BUDGET"?2_000:20_000,leaseSeconds:120,processSubmissions:false,noRetryNotifications:true,resolveNotificationAdapter:()=>outcome==="UNAVAILABLE"?null:adapter});
    await expect(engine.runOnce("immediate-notification")).resolves.toEqual({submission:"IDLE",notification:"DEAD"});expect(repository.reconcileNotification).toHaveBeenCalledOnce();expect(repository.releaseNotification).not.toHaveBeenCalled();
  });
  it("hard-disables a production LIVE claim before credential binding, resolver selection, or remote fetch",async()=>{const fixture=orchestrationFixture(1);fixture.claimedSnapshot.adapterMode="LIVE";fixture.claimedSnapshot.legacyBaseUrl="https://legacy.example.test";fixture.claimedSnapshot.legacyCredentialCiphertext=Buffer.from("ciphertext");fixture.claimedSnapshot.legacyCredentialNonce=Buffer.alloc(12,1);fixture.claimedSnapshot.legacyCredentialKeyVersion=1;fixture.claimedSnapshot.legacyCredentialFingerprint="a".repeat(64);fixture.claimedSnapshot.legacyCredentialUpdatedAt="2026-08-30T00:00:00.000Z";const resolveAdapter=vi.fn();
    const engine=new PartnerSubmissionWorkerEngine(fixture.repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"production"},deadlineMs:20_000,leaseSeconds:120,resolveAdapter});await expect(engine.runOnce("worker-live-disabled")).resolves.toMatchObject({submission:"RECONCILED"});expect(resolveAdapter).not.toHaveBeenCalled();expect(Object.values(fixture.adapter.callCounts).every(count=>count===0)).toBe(true);});
});

describe("submission worker persisted orchestration",()=>{
  it("dispatches one live create, records its identity, and verifies quote plus plans",async()=>{const fixture=liveOrchestrationFixture();await expect(fixture.engine().runOnce("worker-live-once")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.createLead).toHaveBeenCalledOnce();expect(fixture.beginLiveCreate).toHaveBeenCalledOnce();expect(fixture.recordLiveCreate).toHaveBeenCalledOnce();expect(fixture.repository.finalizeSubmission).toHaveBeenCalledOnce();});

  it("never retries an ambiguous live create",async()=>{const fixture=liveOrchestrationFixture("AMBIGUOUS");await expect(fixture.engine().runOnce("worker-live-ambiguous")).resolves.toMatchObject({submission:"RECONCILED"});await expect(fixture.engine().runOnce("worker-live-ambiguous-again")).resolves.toMatchObject({submission:"IDLE"});expect(fixture.adapter.createLead).toHaveBeenCalledOnce();expect(fixture.recordLiveCreate).not.toHaveBeenCalled();});

  it("reconciles CREATE_STARTED without a returned identity instead of dispatching again",async()=>{const fixture=liveOrchestrationFixture();fixture.claimedSnapshot.checkpoint="CREATE_STARTED";fixture.setReceipt({permitId:"99999999-9999-4999-8999-999999999999",legacyId:null,legacyNumber:null});await expect(fixture.engine().runOnce("worker-live-reclaimed")).resolves.toMatchObject({submission:"RECONCILED"});expect(fixture.adapter.createLead).not.toHaveBeenCalled();expect(fixture.beginLiveCreate).not.toHaveBeenCalled();});

  it("does not arm a live create when the fake clock has less than the full create budget",async()=>{const fixture=liveOrchestrationFixture("CONFIRMED",{deadlineMs:17_999});await expect(fixture.engine().runOnce("worker-live-short-create")).resolves.toMatchObject({submission:"RELEASED"});expect(fixture.beginLiveCreate).not.toHaveBeenCalled();expect(fixture.adapter.createLead).not.toHaveBeenCalled();});

  it("does not begin a plan upload when prior verified work consumes its fake-clock budget",async()=>{const fixture=liveOrchestrationFixture("CONFIRMED",{deadlineMs:40_000,advanceAfterQuoteMs:18_000});await expect(fixture.engine().runOnce("worker-live-short-upload")).resolves.toMatchObject({submission:"RELEASED"});expect(fixture.repository.beginUpload).not.toHaveBeenCalled();expect(fixture.adapter.uploadPlan).not.toHaveBeenCalled();});

  it("does not begin attachment when an uploaded plan consumes its fake-clock budget",async()=>{const fixture=liveOrchestrationFixture("CONFIRMED",{deadlineMs:60_000,advanceAfterUploadMs:45_000});await expect(fixture.engine().runOnce("worker-live-short-attach")).resolves.toMatchObject({submission:"RELEASED"});expect(fixture.repository.beginUpload).toHaveBeenCalledOnce();expect(fixture.repository.beginAttachment).not.toHaveBeenCalled();expect(fixture.adapter.attachPlans).not.toHaveBeenCalled();});

  it.each([{sources:[]},{sources:["REFERRAL","PHONE_CALL"]}])("completes historical schema-v1 snapshots with $sources without rewriting frozen terms",async({sources})=>{
    const fixture=orchestrationFixture(1);const frozen=JSON.parse(fixture.claimedSnapshot.canonicalDocument);
    frozen.job.leadSources=sources;frozen.job.quote.consentFeeCents=12300;frozen.job.quote.depositBasisPoints=2500;
    fixture.claimedSnapshot.canonicalDocument=JSON.stringify(frozen);
    fixture.claimedSnapshot.snapshotSha256=createHash("sha256").update(fixture.claimedSnapshot.canonicalDocument).digest("hex");
    const before=fixture.claimedSnapshot.canonicalDocument;
    await expect(fixture.engine().runOnce("worker-historical")).resolves.toMatchObject({submission:"SUCCEEDED"});
    expect(fixture.claimedSnapshot.canonicalDocument).toBe(before);expect(fixture.adapter.callCounts.createLead).toBe(1);
    expect(fixture.repository.finalizeSubmission).toHaveBeenCalledOnce();
  });
  it("recovers create and quote response loss without duplicating either remote mutation",async()=>{const fixture=orchestrationFixture();fixture.adapter.queue("createLead","EFFECT_THEN_RESPONSE_LOSS").queue("updateQuote","EFFECT_THEN_RESPONSE_LOSS");
    await expect(fixture.engine().runOnce("worker-crash-create")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.callCounts.createLead).toBe(1);expect(fixture.adapter.callCounts.updateQuote).toBe(1);expect(fixture.repository.finalizeSubmission).toHaveBeenCalledOnce();});

  it("re-enters a deterministic upload after response loss and checkpoints the single stored upload",async()=>{const fixture=orchestrationFixture(1);fixture.adapter.queue("uploadPlan","UPLOAD_EFFECT_THEN_LOSS");
    await expect(fixture.engine().runOnce("worker-upload-1")).resolves.toMatchObject({submission:"RELEASED"});expect(fixture.claimedPlans[0].deliveryState).toBe("PENDING");
    await expect(fixture.engine().runOnce("worker-upload-2")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.callCounts.uploadPlan).toBe(2);expect(fixture.repository.checkpoint).toHaveBeenCalledWith(expect.anything(),"PLAN_UPLOADED",expect.objectContaining({ordinal:0}));});

  it("adopts an exact partial two-plan attachment then completes the full set on the next lease",async()=>{const fixture=orchestrationFixture(2);fixture.adapter.queue("attachPlans","PARTIAL_ATTACH");
    await expect(fixture.engine().runOnce("worker-attach-1")).resolves.toMatchObject({submission:"RELEASED"});expect(fixture.adapter.callCounts.attachPlans).toBe(1);
    await expect(fixture.engine().runOnce("worker-attach-2")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.callCounts.attachPlans).toBe(2);expect(fixture.claimedPlans.every(row=>row.deliveryState==="ATTACHED")).toBe(true);});

  it("discards a post-effect result when the immediate fence heartbeat is lost",async()=>{const fixture=orchestrationFixture(1);let uploadEffect=false;const original=fixture.adapter.uploadFrozenPlan.bind(fixture.adapter);fixture.adapter.uploadFrozenPlan=vi.fn(async(id,plan,context)=>{const value=await original(id,plan,context);uploadEffect=true;return value;});fixture.repository.heartbeatSubmission.mockImplementation(async()=>!uploadEffect);
    await expect(fixture.engine().runOnce("worker-stale-fence")).resolves.toMatchObject({submission:"LEASE_LOST"});expect(fixture.adapter.callCounts.uploadPlan).toBe(1);expect(fixture.repository.checkpoint).not.toHaveBeenCalledWith(expect.anything(),"PLAN_UPLOADED",expect.anything());expect(fixture.repository.finalizeSubmission).not.toHaveBeenCalled();});

  it("reconciles remote identity drift observed by the fresh pre-final read",async()=>{const fixture=orchestrationFixture(1);const original=fixture.adapter.getJob.bind(fixture.adapter);let reads=0;fixture.adapter.getJob=vi.fn(async(id,context)=>{reads+=1;if(reads===3){const job=fixture.world.jobs.values().next().value;if(job)job.canonicalCreateFingerprint="f".repeat(64);}return original(id,context);});
    await expect(fixture.engine().runOnce("worker-final-drift")).resolves.toMatchObject({submission:"RECONCILED"});expect(fixture.repository.reconcileSubmission).toHaveBeenCalledWith(expect.anything(),"PROVIDER_REJECTED");expect(fixture.repository.finalizeSubmission).not.toHaveBeenCalled();});

  it("reports DB-owned claim and upload ceilings truthfully without starting another remote effect",async()=>{const terminal=orchestrationFixture(1);terminal.repository.claimSubmission.mockResolvedValueOnce({kind:"RECONCILED",queueAgeBucket:"LT_1H",reclaimedLease:true});await expect(terminal.engine().runOnce("worker-attempt-cap")).resolves.toMatchObject({submission:"RECONCILED"});expect(terminal.adapter.callCounts.findLead).toBe(0);
    const upload=orchestrationFixture(1);upload.repository.beginUpload.mockResolvedValueOnce("RECONCILED");await expect(upload.engine().runOnce("worker-upload-cap")).resolves.toMatchObject({submission:"RECONCILED"});expect(upload.adapter.callCounts.uploadPlan).toBe(0);});

  it("resumes after a committed lead checkpoint response is lost without a second create",async()=>{const fixture=orchestrationFixture(1);const original=fixture.repository.checkpoint.getMockImplementation()!;let lost=false;fixture.repository.checkpoint.mockImplementation(async(lease,phase,values)=>{const ok=await original(lease,phase,values);if(phase==="LEAD_CREATED"&&!lost){lost=true;throw new Error("lead checkpoint response lost");}return ok;});
    await expect(fixture.engine().runOnce("worker-lead-checkpoint-1")).resolves.toMatchObject({submission:"RELEASED"});await expect(fixture.engine().runOnce("worker-lead-checkpoint-2")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.callCounts.createLead).toBe(1);});

  it("resumes after a committed quote checkpoint response is lost without rewriting the quote",async()=>{const fixture=orchestrationFixture(1);const original=fixture.repository.checkpointQuoteVerified.getMockImplementation()!;let lost=false;fixture.repository.checkpointQuoteVerified.mockImplementation(async(lease,fingerprint)=>{const ok=await original(lease,fingerprint);if(!lost){lost=true;throw new Error("quote checkpoint response lost");}return ok;});
    await expect(fixture.engine().runOnce("worker-quote-checkpoint-1")).resolves.toMatchObject({submission:"RELEASED"});await expect(fixture.engine().runOnce("worker-quote-checkpoint-2")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.callCounts.updateQuote).toBe(1);});

  it("resumes after a committed PLAN_UPLOADED response is lost without uploading the bytes twice",async()=>{const fixture=orchestrationFixture(1);const original=fixture.repository.checkpoint.getMockImplementation()!;let lost=false;fixture.repository.checkpoint.mockImplementation(async(lease,phase,values)=>{const ok=await original(lease,phase,values);if(phase==="PLAN_UPLOADED"&&!lost){lost=true;throw new Error("upload checkpoint response lost");}return ok;});
    await expect(fixture.engine().runOnce("worker-upload-checkpoint-1")).resolves.toMatchObject({submission:"RELEASED"});await expect(fixture.engine().runOnce("worker-upload-checkpoint-2")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.callCounts.uploadPlan).toBe(1);});

  it("resumes after an attached-plan adoption response is lost without attaching the full set twice",async()=>{const fixture=orchestrationFixture(2);const original=fixture.repository.adoptAttachedPlan.getMockImplementation()!;let lost=false;fixture.repository.adoptAttachedPlan.mockImplementation(async(lease,ordinal,key)=>{const ok=await original(lease,ordinal,key);if(!lost){lost=true;throw new Error("adoption response lost");}return ok;});
    await expect(fixture.engine().runOnce("worker-adopt-checkpoint-1")).resolves.toMatchObject({submission:"RELEASED"});await expect(fixture.engine().runOnce("worker-adopt-checkpoint-2")).resolves.toMatchObject({submission:"SUCCEEDED"});expect(fixture.adapter.callCounts.attachPlans).toBe(1);});

  it("does not repeat provider effects after a committed DB finalization response is lost",async()=>{const fixture=orchestrationFixture(1);const original=fixture.repository.finalizeSubmission.getMockImplementation()!;fixture.repository.finalizeSubmission.mockImplementationOnce(async(...args)=>{await original(...args);throw new Error("finalize response lost");});fixture.repository.releaseSubmission.mockImplementation(async()=>fixture.isCompleted()?"DENIED":"RELEASED");
    await expect(fixture.engine().runOnce("worker-finalize-loss-1")).resolves.toMatchObject({submission:"LEASE_LOST"});await expect(fixture.engine().runOnce("worker-finalize-loss-2")).resolves.toMatchObject({submission:"IDLE"});expect(fixture.repository.finalizeSubmission).toHaveBeenCalledOnce();expect(fixture.adapter.callCounts.createLead).toBe(1);expect(fixture.adapter.callCounts.updateQuote).toBe(1);expect(fixture.adapter.callCounts.uploadPlan).toBe(1);expect(fixture.adapter.callCounts.attachPlans).toBe(1);});

  it("uses notification acceptance receipts for lookup-only recovery across adapter recreation",async()=>{const notificationWorld=new FictionalNotificationWorld();let phase:NotificationLease["phase"]="READY",receipt:string|null=null,attempt=0,checkpointCalls=0,delivered=false;const notificationLease=():NotificationLease=>({eventId:ids.event,companyId:ids.company,jobId:ids.job,requestId:ids.request,topic:"PARTNER_SUBMISSION_COMPLETED",phase,receipt,leaseToken:ids.lease,fenceToken:1,attemptNumber:++attempt});
    const repository={claimSubmission:vi.fn(async()=>null),claimNotification:vi.fn(async()=>delivered?null:{kind:"LEASE" as const,lease:notificationLease(),queueAgeBucket:"LT_1M" as const,reclaimedLease:false}),heartbeatNotification:vi.fn(async()=>true),checkpointNotificationAccepted:vi.fn(async(_lease:NotificationLease,value:string)=>{phase="ACCEPTED_PENDING";receipt=value;checkpointCalls+=1;if(checkpointCalls===1)throw new Error("checkpoint response lost");return true;}),releaseNotification:vi.fn(async()=>"RELEASED" as const),finalizeNotification:vi.fn(async()=>{delivered=true;return true;}),reconcileNotification:vi.fn(async()=>true)};
    let adapter=createFictionalNotificationAdapterTestHarness(["ENQUEUED"],notificationWorld)!;const engine=()=>new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"test"},deadlineMs:20_000,leaseSeconds:120,resolveNotificationAdapter:()=>adapter});
    await expect(engine().runOnce("notify-accept")).resolves.toMatchObject({notification:"RELEASED"});expect(phase).toBe("ACCEPTED_PENDING");expect(notificationWorld.enqueues).toHaveLength(1);expect(repository.checkpointNotificationAccepted).toHaveBeenCalledTimes(2);
    adapter=createFictionalNotificationAdapterTestHarness([],notificationWorld)!;adapter.queueLookup(receipt!,"ENQUEUED","DELIVERED");await expect(engine().runOnce("notify-pending")).resolves.toMatchObject({notification:"RELEASED"});await expect(engine().runOnce("notify-delivered")).resolves.toMatchObject({notification:"DELIVERED"});await expect(engine().runOnce("notify-after-terminal")).resolves.toMatchObject({notification:"IDLE"});expect(notificationWorld.enqueues).toHaveLength(1);expect(notificationWorld.deliveries).toHaveLength(1);});

  it("dead-letters an ambiguous ACCEPTED_PENDING lookup without invoking deliver",async()=>{const world=new FictionalNotificationWorld();const receipt="fictional:accepted-pending";const adapter=createFictionalNotificationAdapterTestHarness([],world)!;adapter.queueLookup(receipt,"AMBIGUOUS");const lease:NotificationLease={eventId:ids.event,companyId:ids.company,jobId:ids.job,requestId:ids.request,topic:"PARTNER_SUBMISSION_COMPLETED",phase:"ACCEPTED_PENDING",receipt,leaseToken:ids.lease,fenceToken:1,attemptNumber:2};const repository={claimSubmission:vi.fn(async()=>null),claimNotification:vi.fn(async()=>({kind:"LEASE" as const,lease,queueAgeBucket:"LT_1M" as const,reclaimedLease:false})),heartbeatNotification:vi.fn(async()=>true),reconcileNotification:vi.fn(async()=>true)};
    const engine=new PartnerSubmissionWorkerEngine(repository as unknown as PartnerSubmissionWorkerRepository,{env:{NODE_ENV:"test"},deadlineMs:20_000,leaseSeconds:120,resolveNotificationAdapter:()=>adapter});await expect(engine.runOnce("notify-ambiguous")).resolves.toMatchObject({notification:"DEAD"});expect(adapter.calls).toHaveLength(0);expect(repository.reconcileNotification).toHaveBeenCalledWith(expect.anything(),"AMBIGUOUS_LEGACY_RESULT");});
});
