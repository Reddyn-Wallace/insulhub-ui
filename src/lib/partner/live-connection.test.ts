import {beforeEach,describe,expect,it,vi} from "vitest";
import {PartnerLiveConnectionRepository} from "./live-connection";
import {partnerLiveConnectionRoute} from "./live-connection-route";
import type {PartnerSql} from "./db";

const origin="https://portal.example.test",companyId="11111111-1111-4111-8111-111111111111";
describe("partner live connection",()=>{
  beforeEach(()=>{vi.stubEnv("PARTNER_CREDENTIAL_ACTIVE_KEY_VERSION","1");vi.stubEnv("PARTNER_CREDENTIAL_KEYS_JSON",JSON.stringify({1:Buffer.alloc(32,9).toString("base64")}));});
  it("stores only the encrypted token envelope and derived prefix",async()=>{
    const calls:Array<{text:string;values:readonly unknown[]}>=[];const sql={query:async(text:string,values:readonly unknown[]=[])=>{calls.push({text,values});return{rows:[{partner_ops_legacy_connection_set:true}],rowCount:1};}} as unknown as PartnerSql;
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:{loginUser:{token:"secret-company-token",user:{_id:"64abcdefabcdefabcdefabcd",firstname:"Reddyn",lastname:"Wallace"}}}}),{status:200,headers:{"content-type":"application/json"}}));
    await expect(new PartnerLiveConnectionRepository(sql).connect({companyId,revision:3,email:"login@example.com",password:"secret-password"},fetcher as typeof fetch)).resolves.toBe("CONNECTED");
    const values=calls[0].values;expect(values).toContain("RW");expect(values).not.toContain("secret-password");expect(values).not.toContain("secret-company-token");expect(values).not.toContain("login@example.com");expect(values.some(Buffer.isBuffer)).toBe(true);
  });
  it("requires normal InsulHub auth and exact mutation origin",async()=>{
    const repository={status:vi.fn(),connect:vi.fn(),allowAttempt:vi.fn(async()=>true)} as unknown as PartnerLiveConnectionRepository;
    const deps={repository,origins:new Set([origin]),verify:async()=>null,ensure:async()=>undefined};
    const denied=await partnerLiveConnectionRoute(new Request(`${origin}/api/settings/partners/${companyId}/connection`,{method:"POST",headers:{origin:"https://evil.test","content-type":"application/json"},body:JSON.stringify({revision:0,email:"a@b.co",password:"x"})}),companyId,deps);
    expect(denied.status).toBe(403);expect(repository.connect).not.toHaveBeenCalled();
    const auth=await partnerLiveConnectionRoute(new Request(`${origin}/api/settings/partners/${companyId}/connection`),companyId,{...deps,verify:async()=>new Response("denied",{status:401})});expect(auth.status).toBe(401);
  });
  it("never returns credentials after a successful connection",async()=>{
    const repository={connect:vi.fn(async()=>"CONNECTED" as const),allowAttempt:vi.fn(async()=>true)} as unknown as PartnerLiveConnectionRepository;
    const response=await partnerLiveConnectionRoute(new Request(`${origin}/api/settings/partners/${companyId}/connection`,{method:"POST",headers:{origin,"content-type":"application/json","x-access-token":"staff-token"},body:JSON.stringify({revision:0,email:"login@example.com",password:"secret-password"})}),companyId,{repository,origins:new Set([origin]),verify:async()=>null,ensure:async()=>undefined});
    expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});
  });
  it("durably throttles password checks before calling the legacy login",async()=>{
    const repository={connect:vi.fn(),allowAttempt:vi.fn(async()=>false)} as unknown as PartnerLiveConnectionRepository;
    const response=await partnerLiveConnectionRoute(new Request(`${origin}/api/settings/partners/${companyId}/connection`,{method:"POST",headers:{origin,"content-type":"application/json","x-access-token":"staff-token"},body:JSON.stringify({revision:0,email:"login@example.com",password:"secret-password"})}),companyId,{repository,origins:new Set([origin]),verify:async()=>null,ensure:async()=>undefined});
    expect(response.status).toBe(429);expect(repository.connect).not.toHaveBeenCalled();
  });
});
