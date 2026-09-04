import { describe, expect, it, vi } from "vitest";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { createFloorPlan, deleteFloorPlan, downloadFloorPlanPdf, generateFloorPlanPdf, getFloorPlan, listFloorPlans, patchFloorPlan, reorderFloorPlans, type PartnerSitePlanRouteDependencies } from "./site-plan-routes";
import { normalizeSitePlanRenderInput, sitePlanRenderHash } from "./site-plan-hash";

const jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"; const drawingId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const partner={userId:"user-a",companyId:"11111111-1111-4111-8111-111111111111",principalType:"PARTNER" as const};
function dependencies(overrides:Record<string,unknown>={},principal:unknown=partner):PartnerSitePlanRouteDependencies{
  const repository={list:vi.fn(async()=>({revision:0,floors:[]})),create:vi.fn(),get:vi.fn(),patch:vi.fn(),remove:vi.fn(),reorder:vi.fn(),consumeRateLimit:vi.fn(async()=>true),renderSnapshot:vi.fn(),publish:vi.fn(),download:vi.fn(),...overrides};
  return{repository:repository as never,origins:new Set(["https://partner.example.test"]),getPrincipal:vi.fn(async()=>principal as never),render:vi.fn()};
}
function request(path:string,init:RequestInit={}){return new Request(`https://partner.example.test${path}`,init);}

describe("partner floor-plan routes",()=>{
  it("keeps list responses private/no-store and excludes internal principals",async()=>{
    const ok=await listFloorPlans(request(`/api/partner/jobs/${jobId}/floor-plans`),jobId,dependencies());expect(ok.status).toBe(200);expect(ok.headers.get("cache-control")).toBe("private, no-store");expect(await ok.json()).toEqual({floorPlans:{revision:0,floors:[]}});
    const internal=await listFloorPlans(request(`/api/partner/jobs/${jobId}/floor-plans`),jobId,dependencies({}, {userId:"ops",companyId:null,principalType:"INTERNAL"}));expect(internal.status).toBe(401);
  });
  it("omits artifact identity and render hashes from browser floor views",async()=>{
    const floor={id:drawingId,jobId,name:"Ground",sortOrder:0,document:EMPTY_SITE_PLAN_DOCUMENT,revision:1,pdfReady:true,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",currentPdf:{artifactId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",drawingRevision:1,renderHash:"private-render-hash",fileName:"Ground.pdf",generatedAt:"2026-01-01T00:00:00.000Z"}};
    const response=await getFloorPlan(request("/get"),jobId,drawingId,dependencies({get:vi.fn(async()=>floor)}));const serialized=JSON.stringify(await response.json());expect(serialized).not.toContain("artifactId");expect(serialized).not.toContain("renderHash");expect(serialized).toContain("Ground.pdf");
  });
  it("returns a generic nested 404 for malformed UUIDs without touching storage",async()=>{const d=dependencies();const response=await listFloorPlans(request("/api/partner/jobs/not-a-uuid/floor-plans"),"not-a-uuid",d);expect(response.status).toBe(404);expect((d.repository.list as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();});
  it("requires exact mutation Origin and recursive request allowlists",async()=>{
    const missing=await createFloorPlan(request(`/api/partner/jobs/${jobId}/floor-plans`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),jobId,dependencies());expect(missing.status).toBe(403);
    const unknown=await createFloorPlan(request(`/api/partner/jobs/${jobId}/floor-plans`,{method:"POST",headers:{origin:"https://partner.example.test","content-type":"application/json"},body:JSON.stringify({revision:0,name:"Ground",document:EMPTY_SITE_PLAN_DOCUMENT,companyId:"forged"})}),jobId,dependencies());expect(unknown.status).toBe(400);
  });
  it("covers PATCH, DELETE and reorder CAS outcomes without leaking storage details",async()=>{
    const headers={origin:"https://partner.example.test","content-type":"application/json"};
    const floor={id:drawingId,jobId,name:"Ground",sortOrder:0,document:EMPTY_SITE_PLAN_DOCUMENT,revision:1,currentPdf:null,pdfReady:false,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"};
    const patched=await patchFloorPlan(request("/patch",{method:"PATCH",headers,body:JSON.stringify({revision:0,name:"Ground floor"})}),jobId,drawingId,dependencies({patch:vi.fn(async()=>({outcome:"updated",floor}))}));
    expect(patched.status).toBe(200);expect(patched.headers.get("cache-control")).toBe("private, no-store");
    const locked=await deleteFloorPlan(request("/delete",{method:"DELETE",headers,body:JSON.stringify({revision:2})}),jobId,drawingId,dependencies({remove:vi.fn(async()=>({outcome:"not_draft"}))}));
    expect(locked.status).toBe(409);expect(await locked.json()).toMatchObject({code:"DRAFT_LOCKED"});
    const stale=await reorderFloorPlans(request("/order",{method:"PATCH",headers,body:JSON.stringify({revision:1,drawingIds:[drawingId]})}),jobId,dependencies({reorder:vi.fn(async()=>({outcome:"stale",currentRevision:2}))}));
    expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({code:"STALE_REVISION",currentRevision:2});
    const missing=await getFloorPlan(request("/get"),jobId,drawingId,dependencies({get:vi.fn(async()=>null)}));
    expect(missing.status).toBe(404);expect(JSON.stringify(await missing.json())).not.toContain(partner.companyId);
  });
  it("rejects malformed nested IDs and oversized or PII-bearing failures generically",async()=>{
    const errorLog=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    const d=dependencies({create:vi.fn(async()=>{throw new Error("victim@example.test in company secret-tenant");})});
    const invalid=await getFloorPlan(request("/bad"),jobId,"not-a-uuid",d);expect(invalid.status).toBe(404);expect((d.repository.get as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    const headers={origin:"https://partner.example.test","content-type":"application/json"};
    const failed=await createFloorPlan(request("/create",{method:"POST",headers,body:JSON.stringify({revision:0,name:"Ground",document:EMPTY_SITE_PLAN_DOCUMENT})}),jobId,d);expect(failed.status).toBe(500);expect(JSON.stringify(await failed.json())).not.toMatch(/victim|secret-tenant/);expect(errorLog).toHaveBeenCalledWith("[partner:floor-plans] request failed",{name:"Error",code:"UNKNOWN"});errorLog.mockRestore();
    const oversized=await createFloorPlan(request("/create",{method:"POST",headers:{...headers,"content-length":String(256*1024+1)},body:"{}"}),jobId,dependencies());expect(oversized.status).toBe(413);
  });
  it("commits both generation limits before rendering and preserves the prior PDF on failure",async()=>{
    const document={...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:"wall-1",start:{x:1,y:1},end:{x:2,y:2},style:"solid" as const}]};
    const input=normalizeSitePlanRenderInput({drawingName:"Ground",siteAddress:null,document});
    const snapshot={jobRevision:0,collectionRevision:0,drawingRevision:0,currentArtifactId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",input,renderHash:sitePlanRenderHash(input)};
    const consumeRateLimit=vi.fn(async()=>true);const render=vi.fn(async()=>{throw new Error("unsupported glyph for private address")});const publish=vi.fn();
    const injected=dependencies({consumeRateLimit,renderSnapshot:vi.fn(async()=>snapshot),publish});injected.render=render as never;
    const failed=await generateFloorPlanPdf(request("/pdf",{method:"POST",headers:{origin:"https://partner.example.test"},body:JSON.stringify({revision:0})}),jobId,drawingId,injected);
    expect(failed.status).toBe(422);expect(consumeRateLimit).toHaveBeenCalledTimes(2);expect(render).toHaveBeenCalledOnce();expect(publish).not.toHaveBeenCalled();expect(JSON.stringify(await failed.json())).toContain("saved drawing remains a draft");
  });
  it("binds completion to the revision just saved, rejecting a newer draft before rendering",async()=>{
    const document={...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:"wall-1",start:{x:1,y:1},end:{x:2,y:2},style:"solid" as const}]};
    const input=normalizeSitePlanRenderInput({drawingName:"Ground",siteAddress:null,document});
    const render=vi.fn(),publish=vi.fn();
    const injected=dependencies({consumeRateLimit:vi.fn(async()=>true),renderSnapshot:vi.fn(async()=>({jobRevision:0,collectionRevision:0,drawingRevision:2,currentArtifactId:null,input,renderHash:sitePlanRenderHash(input)})),publish}); injected.render=render;
    const stale=await generateFloorPlanPdf(request("/pdf",{method:"POST",headers:{origin:"https://partner.example.test"},body:JSON.stringify({revision:1})}),jobId,drawingId,injected);
    expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({code:"STALE_REVISION"});expect(render).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();
    const missing=await generateFloorPlanPdf(request("/pdf",{method:"POST",headers:{origin:"https://partner.example.test"}}),jobId,drawingId,injected);expect(missing.status).toBe(400);
  });
  it("serves only verified current bytes with hardened Unicode disposition",async()=>{
    const bytes=Buffer.from("%PDF-safe");const sha=(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    const response=await downloadFloorPlanPdf(request(`/api/partner/jobs/${jobId}/floor-plans/${drawingId}/pdf`),jobId,drawingId,dependencies({download:vi.fn(async()=>({bytes,fileName:"Māori plan.pdf",sha256:sha}))}));
    expect(response.status).toBe(200);expect(response.headers.get("content-type")).toBe("application/pdf");expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''M%C4%81ori%20plan.pdf");expect(response.headers.get("x-content-type-options")).toBe("nosniff");expect(response.headers.get("cache-control")).toBe("private, no-store");
    const boundaryName=`${"a".repeat(175)}😀tail.pdf`;const boundary=await downloadFloorPlanPdf(request("/boundary"),jobId,drawingId,dependencies({download:vi.fn(async()=>({bytes,fileName:boundaryName,sha256:sha}))}));expect(boundary.status).toBe(200);expect(boundary.headers.get("content-disposition")).toContain(`${"a".repeat(175)}%F0%9F%98%80.pdf`);
    const unpaired=await downloadFloorPlanPdf(request("/unpaired"),jobId,drawingId,dependencies({download:vi.fn(async()=>({bytes,fileName:"bad\ud83dname.pdf",sha256:sha}))}));expect(unpaired.status).toBe(200);expect(unpaired.headers.get("content-disposition")).toContain("filename*=UTF-8''bad_name.pdf");
  });
  it("maps rate-limit storage failures without leaking their details",async()=>{const consumeRateLimit=vi.fn(async()=>{throw new Error("private-user@example.test");});const generate=await generateFloorPlanPdf(request("/pdf",{method:"POST",headers:{origin:"https://partner.example.test"},body:JSON.stringify({revision:0})}),jobId,drawingId,dependencies({consumeRateLimit}));expect(generate.status).toBe(503);expect(JSON.stringify(await generate.json())).not.toContain("private-user");const download=await downloadFloorPlanPdf(request("/pdf"),jobId,drawingId,dependencies({consumeRateLimit}));expect(download.status).toBe(503);expect(JSON.stringify(await download.json())).not.toContain("private-user");});
});
