import { describe, expect, it, vi } from "vitest";
import { getPartnerSubmissionStatus, resumePartnerDemoSubmission, submitPartnerJob, type PartnerSubmissionRouteDependencies } from "./submission-routes";
import type { PartnerSubmissionService } from "./submission-service";

const origin="https://portal.example.test";
const jobId="11111111-1111-4111-8111-111111111111";
const idempotencyKey="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId="33333333-3333-4333-8333-333333333333";
const principal={userId:"partner-a",companyId:"company-a",principalType:"PARTNER" as const};
const status={state:"QUEUED" as const,checkpoint:"FROZEN",errorCode:null,createdAt:"2026-08-30T00:00:00.000Z",updatedAt:"2026-08-30T00:00:00.000Z",completedAt:null};

function deps(overrides:Partial<{submit:PartnerSubmissionService["submit"];status:PartnerSubmissionService["status"];statusAllowed:PartnerSubmissionService["statusAllowed"];getPrincipal:PartnerSubmissionRouteDependencies["getPrincipal"];ensureRuntime:()=>Promise<void>;resumeDemo:()=>Promise<unknown>;completeImmediately:NonNullable<PartnerSubmissionRouteDependencies["completeImmediately"]>} >={}):PartnerSubmissionRouteDependencies{
  return {
    origins:new Set([origin]),
    getPrincipal:overrides.getPrincipal??vi.fn(async()=>principal),
    ensureRuntime:overrides.ensureRuntime??vi.fn(async()=>undefined),
    resumeDemo:overrides.resumeDemo,
    completeImmediately:overrides.completeImmediately,
    service:{submit:overrides.submit??vi.fn(async()=>({outcome:"accepted" as const,status,replayed:false,requestId})),status:overrides.status??vi.fn(async()=>status),statusAllowed:overrides.statusAllowed??vi.fn(async()=>true)} as unknown as PartnerSubmissionService,
  };
}
function post(body:unknown,headers:Record<string,string>={}){return new Request(`${origin}/api/partner/jobs/${jobId}/submission`,{method:"POST",headers:{origin,"content-type":"application/json",...headers},body:JSON.stringify(body)});}
const validBody={jobRevision:2,floorPlanRevision:3,idempotencyKey};

describe("partner submission HTTP boundary",()=>{
  it("rejects Origin before session, role, body, or submission work",async()=>{
    const getPrincipal=vi.fn(async()=>principal);const submit=vi.fn();const ensureRuntime=vi.fn();const injected=deps({getPrincipal,submit:submit as never,ensureRuntime:ensureRuntime as never});
    const request=post(validBody);request.headers.set("origin","https://evil.example.test");
    const response=await submitPartnerJob(request,jobId,injected);
    expect(response.status).toBe(403);expect(getPrincipal).not.toHaveBeenCalled();expect(ensureRuntime).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("enforces session, exact media/body shape, and generic guessed-job handling",async()=>{
    expect((await submitPartnerJob(post(validBody),jobId,deps({getPrincipal:async()=>null}))).status).toBe(401);
    expect((await submitPartnerJob(post(validBody),jobId,deps({getPrincipal:async()=>({userId:"ops",companyId:null,principalType:"INTERNAL"})}))).status).toBe(401);
    expect((await submitPartnerJob(new Request(`${origin}/api/partner/jobs/${jobId}/submission`,{method:"POST",headers:{origin,"content-type":"text/plain"},body:"{}"}),jobId,deps())).status).toBe(415);
    expect((await submitPartnerJob(post({...validBody,companyId:"other"}),jobId,deps())).status).toBe(400);
    expect((await submitPartnerJob(post({...validBody,idempotencyKey:"not-a-uuid"}),jobId,deps())).status).toBe(400);
    expect((await submitPartnerJob(post(validBody),"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",deps({submit:async()=>({outcome:"not_found"})}))).status).toBe(404);
  });

  it("caps streamed bodies and rejects malformed declared lengths before service work",async()=>{
    const submit=vi.fn();const injected=deps({submit:submit as never});
    const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("x".repeat(4_097)));controller.close();}});
    const streamed=new Request(`${origin}/api/partner/jobs/${jobId}/submission`,{method:"POST",headers:{origin,"content-type":"application/json"},body:stream,duplex:"half"} as RequestInit);
    expect((await submitPartnerJob(streamed,jobId,injected)).status).toBe(400);expect(submit).not.toHaveBeenCalled();
    expect((await submitPartnerJob(post(validBody,{"content-length":"invalid"}),jobId,injected)).status).toBe(400);expect(submit).not.toHaveBeenCalled();
  });

  it("returns only bounded no-store public status after acceptance",async()=>{
    const response=await submitPartnerJob(post(validBody),jobId,deps());const body=await response.json();
    expect(response.status).toBe(202);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({status,replayed:false,destination:`/partner/jobs/${jobId}`});expect(JSON.stringify(body)).not.toContain(idempotencyKey);
  });

  it("completes an accepted submission in the request and returns confirmed success",async()=>{
    const completeImmediately=vi.fn(async()=>({...status,state:"SUCCEEDED" as const,checkpoint:"COMPLETED",notification:"DELIVERED" as const}));
    const response=await submitPartnerJob(post(validBody),jobId,deps({completeImmediately}));
    expect(response.status).toBe(200);expect(completeImmediately).toHaveBeenCalledWith({companyId:"company-a",jobId,requestId},expect.any(Function),expect.any(AbortSignal));
    expect(await response.json()).toMatchObject({status:{state:"SUCCEEDED",notification:"DELIVERED"},destination:`/partner/jobs/${jobId}`});
  });

  it("returns accepted-in-progress without claiming unrelated work when the exact lease is already held",async()=>{
    const completeImmediately=vi.fn(async()=>({...status,state:"PROCESSING" as const}));
    const response=await submitPartnerJob(post(validBody),jobId,deps({completeImmediately}));
    expect(response.status).toBe(202);expect(await response.json()).toMatchObject({status:{state:"PROCESSING"},destination:`/partner/jobs/${jobId}`});
  });

  it("freezes the job and returns only a generic contact message when immediate transfer does not complete",async()=>{
    const sentinel="private.person+sentinel@example.test";
    const completeImmediately=vi.fn(async()=>{throw new Error(sentinel);});
    const statusRead=vi.fn(async()=>({...status,state:"FAILED_RETRYABLE" as const,errorCode:null}));
    const response=await submitPartnerJob(post(validBody),jobId,deps({completeImmediately,status:statusRead}));const body=await response.json();
    expect(response.status).toBe(502);expect(body).toMatchObject({code:"SUBMISSION_FAILED",error:"Submission unsuccessful. Contact the Insulmax team directly.",status:{state:"FAILED_RETRYABLE"}});expect(JSON.stringify(body)).not.toContain(sentinel);
  });

  it("maps stale, readiness, rate, preflight, and post-freeze ambiguity distinctly",async()=>{
    const cases=[
      [{outcome:"stale" as const,currentJobRevision:8,currentFloorPlanRevision:9},409,"STALE_REVISION"],
      [{outcome:"not_ready" as const,code:"SUBMISSION_PDF_STALE" as const},422,"SUBMISSION_PDF_STALE"],
      [{outcome:"rate_limited" as const},429,"RATE_LIMITED"],
      [{outcome:"unavailable" as const},503,"SUBMISSION_UNAVAILABLE"],
      [{outcome:"ambiguous" as const},503,"SUBMISSION_STATUS_UNAVAILABLE"],
    ] as const;
    for(const [result,expectedStatus,code] of cases){const response=await submitPartnerJob(post(validBody),jobId,deps({submit:async()=>result}));expect(response.status).toBe(expectedStatus);expect(await response.json()).toMatchObject({code});expect(response.headers.get("cache-control")).toBe("private, no-store");}
  });

  it("turns session, runtime, service, and status outages into redacted no-store 503s",async()=>{
    const sentinel="private.person+sentinel@example.test";
    const failures=[
      deps({getPrincipal:async()=>{throw new Error(sentinel);}}),
      deps({ensureRuntime:async()=>{throw new Error(sentinel);}}),
      deps({submit:async()=>{throw new Error(sentinel);}}),
    ];
    for(const injected of failures){const response=await submitPartnerJob(post(validBody),jobId,injected);expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(JSON.stringify(await response.json())).not.toContain(sentinel);}
    const get=await getPartnerSubmissionStatus(new Request(`${origin}/api/partner/jobs/${jobId}/submission`),jobId,deps({status:async()=>{throw new Error(sentinel);}}));
    expect(get.status).toBe(503);expect(get.headers.get("cache-control")).toBe("private, no-store");expect(JSON.stringify(await get.json())).not.toContain(sentinel);
  });

  it("authenticates GET before rejecting query parameters and never exposes internal IDs",async()=>{
    const unauth=await getPartnerSubmissionStatus(new Request(`${origin}/api/partner/jobs/${jobId}/submission?requestId=secret`),jobId,deps({getPrincipal:async()=>null}));expect(unauth.status).toBe(401);
    const invalid=await getPartnerSubmissionStatus(new Request(`${origin}/api/partner/jobs/${jobId}/submission?requestId=secret`),jobId,deps());expect(invalid.status).toBe(400);
    const response=await getPartnerSubmissionStatus(new Request(`${origin}/api/partner/jobs/${jobId}/submission`),jobId,deps());expect(response.status).toBe(200);expect(await response.json()).toEqual({status});
  });

  it("meters GET status separately and returns a bounded no-store retry response",async()=>{
    const statusRead=vi.fn(async()=>status);const response=await getPartnerSubmissionStatus(new Request(`${origin}/api/partner/jobs/${jobId}/submission`),jobId,deps({status:statusRead,statusAllowed:async()=>false}));expect(response.status).toBe(429);expect(response.headers.get("retry-after")).toBe("15");expect(response.headers.get("cache-control")).toBe("private, no-store");expect(await response.json()).toEqual({error:"Too many status checks. Wait briefly and try again.",code:"RATE_LIMITED"});expect(statusRead).not.toHaveBeenCalled();
  });

  it("keeps GET read-only and permits only an exact-origin empty same-tenant demo recovery POST",async()=>{
    const demoOrigin="http://127.0.0.1:3000",demoEnv={...process.env,NODE_ENV:"test" as const,PARTNER_DEMO_MODE:"true",PARTNER_DEMO_CONFIRM:"LOCAL_FICTIONAL_DATA_ONLY",PARTNER_APP_ORIGIN:`${demoOrigin}/`} as NodeJS.ProcessEnv;const resumeDemo=vi.fn(async()=>undefined),statusRead=vi.fn(async()=>({...status,notification:"PENDING" as const}));const injected=deps({resumeDemo,status:statusRead});injected.origins=new Set([demoOrigin]);
    await getPartnerSubmissionStatus(new Request(`${origin}/api/partner/jobs/${jobId}/submission`),jobId,injected);expect(resumeDemo).not.toHaveBeenCalled();
    const browserEmptyStream=new ReadableStream<Uint8Array>({start(controller){controller.close();}});
    const browserShapedRequest=new Request(`${demoOrigin}/api/partner/jobs/${jobId}/submission/resume`,{method:"POST",headers:{origin:demoOrigin,"content-length":"0"},body:browserEmptyStream,duplex:"half"} as RequestInit);
    const recovered=await resumePartnerDemoSubmission(browserShapedRequest,jobId,injected,demoEnv);expect(recovered.status).toBe(200);expect(resumeDemo).toHaveBeenCalledWith({companyId:"company-a",jobId});expect(await recovered.json()).toMatchObject({status:{state:"QUEUED",notification:"PENDING"}});
    const lyingBody=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode("x"));controller.close();}});
    for(const request of [new Request(`${demoOrigin}/api/partner/jobs/${jobId}/submission/resume`,{method:"GET",headers:{origin:demoOrigin}}),new Request(`${demoOrigin}/api/partner/jobs/${jobId}/submission/resume?mode=fast`,{method:"POST",headers:{origin:demoOrigin}}),new Request(`${demoOrigin}/api/partner/jobs/${jobId}/submission/resume`,{method:"POST",headers:{origin:"https://evil.example.test"}}),new Request(`${demoOrigin}/api/partner/jobs/${jobId}/submission/resume`,{method:"POST",headers:{origin:demoOrigin,"content-type":"application/json"},body:"{}"}),new Request(`${demoOrigin}/api/partner/jobs/${jobId}/submission/resume`,{method:"POST",headers:{origin:demoOrigin,"content-length":"0"},body:lyingBody,duplex:"half"} as RequestInit)])expect((await resumePartnerDemoSubmission(request,jobId,injected,demoEnv)).status).toBeGreaterThanOrEqual(400);
    expect(resumeDemo).toHaveBeenCalledOnce();
  });

  it("denies cross-tenant/unknown jobs before scheduling demo recovery",async()=>{const resumeDemo=vi.fn(),demoEnv={...process.env,NODE_ENV:"test" as const,PARTNER_DEMO_MODE:"true",PARTNER_DEMO_CONFIRM:"LOCAL_FICTIONAL_DATA_ONLY",PARTNER_APP_ORIGIN:`${origin}/`} as NodeJS.ProcessEnv;const response=await resumePartnerDemoSubmission(new Request(`${origin}/api/partner/jobs/${jobId}/submission/resume`,{method:"POST",headers:{origin}}),jobId,deps({resumeDemo:resumeDemo as never,status:async()=>null}),demoEnv);expect(response.status).toBe(404);expect(resumeDemo).not.toHaveBeenCalled();});
  it("rate limits manual demo recovery by user, tenant, and job without spending submit allowance",async()=>{const loopback="http://127.0.0.1:3000",resumeDemo=vi.fn(async()=>undefined),demoEnv={...process.env,NODE_ENV:"test" as const,PARTNER_DEMO_MODE:"true",PARTNER_DEMO_CONFIRM:"LOCAL_FICTIONAL_DATA_ONLY",PARTNER_APP_ORIGIN:`${loopback}/`} as NodeJS.ProcessEnv,injected=deps({resumeDemo,getPrincipal:async()=>({...principal,userId:"recovery-rate-user"})});injected.origins=new Set([loopback]);let last:Response|null=null;for(let count=0;count<7;count++)last=await resumePartnerDemoSubmission(new Request(`${loopback}/api/partner/jobs/${jobId}/submission/resume`,{method:"POST",headers:{origin:loopback}}),jobId,injected,demoEnv);expect(last?.status).toBe(429);expect(last?.headers.get("retry-after")).toBe("30");expect(resumeDemo).toHaveBeenCalledTimes(6);});
});
