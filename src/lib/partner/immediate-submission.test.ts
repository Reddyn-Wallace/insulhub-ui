import { describe, expect, it, vi } from "vitest";
import { PARTNER_DEMO_CONFIRMATION } from "./demo";
import { completePartnerSubmissionImmediately } from "./immediate-submission";
import type { PartnerSubmissionView } from "./submission-service";
import type { PartnerWorkerRunSummary } from "./submission-worker-engine";

const scope={companyId:"11111111-1111-4111-8111-111111111111",jobId:"22222222-2222-4222-8222-222222222222",requestId:"33333333-3333-4333-8333-333333333333"};
const base={checkpoint:"FROZEN",errorCode:null,createdAt:"2026-09-04T00:00:00.000Z",updatedAt:"2026-09-04T00:00:00.000Z",completedAt:null};
const view=(state:PartnerSubmissionView["state"],notification?:"PENDING"|"DELIVERED"|"DEAD"):PartnerSubmissionView=>({...base,state,...(notification?{notification}: {})} as PartnerSubmissionView);
const run=(submission:PartnerWorkerRunSummary["submission"],notification:PartnerWorkerRunSummary["notification"]):PartnerWorkerRunSummary=>({submission,notification});
const productionEnv={NODE_ENV:"production"} as NodeJS.ProcessEnv;

describe("immediate partner submission",()=>{
  it("runs the transfer and notification before returning confirmed success",async()=>{
    let current=view("QUEUED","PENDING");const ensureWorker=vi.fn(async()=>undefined);
    const runOnce=vi.fn(async()=>{current=view("SUCCEEDED","DELIVERED");return run("SUCCEEDED","DELIVERED");});
    const result=await completePartnerSubmissionImmediately(scope,async()=>current,new AbortController().signal,{env:productionEnv,ensureWorker,runOnce});
    expect(result).toEqual(current);expect(ensureWorker).toHaveBeenCalledOnce();expect(runOnce).toHaveBeenCalledOnce();
  });

  it("recovers a post-finalize crash by attempting the exact pending notification once",async()=>{
    const current=view("SUCCEEDED"),runOnce=vi.fn(async()=>run("IDLE","DELIVERED"));
    await expect(completePartnerSubmissionImmediately(scope,async()=>current,new AbortController().signal,{env:productionEnv,ensureWorker:async()=>undefined,runOnce})).resolves.toEqual(current);
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it.each(["DELIVERED","DEAD"] as const)("does not reclaim an explicitly terminal %s notification",async(notification)=>{
    const current=view("SUCCEEDED",notification),runOnce=vi.fn();
    await expect(completePartnerSubmissionImmediately(scope,async()=>current,new AbortController().signal,{env:productionEnv,ensureWorker:async()=>undefined,runOnce:runOnce as never})).resolves.toEqual(current);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("does not automatically retry a failed or reconciliation submission",async()=>{
    for(const terminal of ["FAILED_RETRYABLE","RECONCILIATION_REQUIRED"] as const){
      const current=view(terminal);const runOnce=vi.fn();
      await expect(completePartnerSubmissionImmediately(scope,async()=>current,new AbortController().signal,{env:productionEnv,ensureWorker:async()=>undefined,runOnce:runOnce as never})).resolves.toEqual(current);
      expect(runOnce).not.toHaveBeenCalled();
    }
  });

  it("never makes a second claim when the exact request is already owned elsewhere",async()=>{
    const current=view("PROCESSING","PENDING"),runOnce=vi.fn(async()=>run("IDLE","IDLE"));
    const result=await completePartnerSubmissionImmediately(scope,async()=>current,new AbortController().signal,{env:productionEnv,ensureWorker:async()=>undefined,runOnce});
    expect(result).toEqual(current);expect(runOnce).toHaveBeenCalledOnce();
  });

  it("stops before provider work when the remaining request budget is unsafe",async()=>{
    const current=view("QUEUED","PENDING"),runOnce=vi.fn();
    await expect(completePartnerSubmissionImmediately(scope,async()=>current,new AbortController().signal,{env:productionEnv,ensureWorker:async()=>undefined,runOnce:runOnce as never},7_999)).resolves.toEqual(current);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("keeps the existing fictional demo path without opening production worker access",async()=>{
    const env={NODE_ENV:"test",PARTNER_DEMO_MODE:"true",PARTNER_DEMO_CONFIRM:PARTNER_DEMO_CONFIRMATION,PARTNER_APP_ORIGIN:"http://127.0.0.1:3000"} as NodeJS.ProcessEnv;
    const current=view("SUCCEEDED","DELIVERED"),runDemo=vi.fn(async()=>undefined),ensureWorker=vi.fn(),runOnce=vi.fn();
    await expect(completePartnerSubmissionImmediately(scope,async()=>current,new AbortController().signal,{env,runDemo,ensureWorker:ensureWorker as never,runOnce:runOnce as never})).resolves.toEqual(current);
    expect(runDemo).toHaveBeenCalledWith(scope);expect(ensureWorker).not.toHaveBeenCalled();expect(runOnce).not.toHaveBeenCalled();
  });
});
