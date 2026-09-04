import { describe, expect, it, vi } from "vitest";
import { PartnerSubmissionService } from "./submission-service";
import type { PartnerSubmissionRepository, PartnerSubmissionPreflightRecord } from "./submission-repository";
import type { PartnerPrincipal } from "./repository";
import { PARTNER_DEMO_CONFIRMATION } from "./demo";

const principal:PartnerPrincipal={userId:"user-a",companyId:"company-a",principalType:"PARTNER"};
const jobId="11111111-1111-4111-8111-111111111111";
const key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const demoEnv={NODE_ENV:"test",PARTNER_DEMO_MODE:"true",PARTNER_DEMO_CONFIRM:PARTNER_DEMO_CONFIRMATION,PARTNER_APP_ORIGIN:"http://127.0.0.1:3000"} as NodeJS.ProcessEnv;
const preflight:PartnerSubmissionPreflightRecord={jobId,state:"DRAFT",jobRevision:2,floorPlanRevision:3,adapterMode:"FICTIONAL",contractVersion:"fictional-v1",legacyJobPrefix:"NW",liveConfigurationComplete:false,checkpoint:"DRAFT",createdAt:"2026-08-30T00:00:00.000Z",updatedAt:"2026-08-30T00:00:00.000Z",submittedAt:null};
const publicStatus={state:"QUEUED" as const,checkpoint:"FROZEN",errorCode:null,createdAt:preflight.createdAt,updatedAt:preflight.updatedAt,completedAt:null};

function repository(overrides:Record<string,unknown>={}){
  return {
    preflight:vi.fn(async()=>preflight),status:vi.fn(async()=>null),requestId:vi.fn(async()=>"33333333-3333-4333-8333-333333333333"),consumeRateLimit:vi.fn(async()=>true),consumeStatusRateLimit:vi.fn(async()=>true),loadCandidate:vi.fn(async()=>null),freeze:vi.fn(),...overrides,
  } as unknown as PartnerSubmissionRepository;
}
const input={jobRevision:2,floorPlanRevision:3,idempotencyKey:key};

describe("PartnerSubmissionService",()=>{
  it("preflights unavailable production live work before rate, candidate, or freeze",async()=>{
    const repo=repository({preflight:vi.fn(async()=>({...preflight,adapterMode:"LIVE",contractVersion:"future-live-v1",liveConfigurationComplete:true}))});
    await expect(new PartnerSubmissionService(repo,{env:{NODE_ENV:"production"} as NodeJS.ProcessEnv}).submit(principal,jobId,input,"unknown")).resolves.toEqual({outcome:"unavailable"});
    expect(repo.consumeRateLimit).not.toHaveBeenCalled();expect(repo.loadCandidate).not.toHaveBeenCalled();expect(repo.freeze).not.toHaveBeenCalled();
  });

  it("returns the current immutable request for every later key instead of creating another",async()=>{
    const repo=repository({preflight:vi.fn(async()=>({...preflight,state:"QUEUED"})),status:vi.fn(async()=>publicStatus)});
    const result=await new PartnerSubmissionService(repo,{env:demoEnv}).submit(principal,jobId,{...input,idempotencyKey:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},"unknown");
    expect(result).toEqual({outcome:"accepted",status:publicStatus,replayed:true,requestId:"33333333-3333-4333-8333-333333333333"});expect(repo.consumeRateLimit).not.toHaveBeenCalled();expect(repo.freeze).not.toHaveBeenCalled();
  });

  it("returns current revisions on stale input without consuming the limiter",async()=>{
    const repo=repository();await expect(new PartnerSubmissionService(repo,{env:demoEnv}).submit(principal,jobId,{...input,jobRevision:1},"unknown")).resolves.toEqual({outcome:"stale",currentJobRevision:2,currentFloorPlanRevision:3});expect(repo.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("stops if tenant contract changes after the authoritative candidate read",async()=>{
    const candidate={jobRevision:2,floorPlanRevision:3,companyAdapterMode:"FICTIONAL",companyContractVersion:"fictional-v1",companyLegacyJobPrefix:"NW"};let reads=0;
    const repo=repository({preflight:vi.fn(async()=>reads++?{...preflight,adapterMode:"LIVE",contractVersion:"future"}:preflight),loadCandidate:vi.fn(async()=>candidate)});
    await expect(new PartnerSubmissionService(repo,{env:demoEnv}).submit(principal,jobId,input,"unknown")).resolves.toEqual({outcome:"unavailable"});expect(repo.freeze).not.toHaveBeenCalled();
  });

  it("does not invent a successful saga status for a legacy non-DRAFT row without a request",async()=>{
    const repo=repository({preflight:vi.fn(async()=>({...preflight,state:"SUBMITTED"})),status:vi.fn(async()=>null)});
    await expect(new PartnerSubmissionService(repo,{env:demoEnv}).status(principal,jobId)).resolves.toBeNull();
  });

  it("uses purpose-separated bounded hashes for status polling",async()=>{
    const consumeStatusRateLimit=vi.fn(async(...values:[PartnerPrincipal,string,string,string])=>{void values;return true;});const repo=repository({consumeStatusRateLimit});await expect(new PartnerSubmissionService(repo,{env:demoEnv}).statusAllowed(principal,"203.0.113.4")).resolves.toBe(true);const args=consumeStatusRateLimit.mock.calls[0];expect(args[0]).toBe(principal);for(const value of args.slice(1))expect(value).toMatch(/^[a-f0-9]{64}$/);expect(new Set(args.slice(1))).toHaveLength(3);expect(JSON.stringify(args)).not.toContain("203.0.113.4");
  });
});
