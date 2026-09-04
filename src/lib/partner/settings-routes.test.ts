import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { requireInsulhubAuth } from "../insulhub-auth";
import { createPartnerAuth, getAuthenticatedPrincipalWith } from "./auth";
import { partnerSettingsRoute, type SettingsDependencies } from "./settings-routes";
import { PARTNER_SETTINGS_SERVICE_ID } from "./settings-service";
import { PartnerOperationsRepository } from "./operations-repository";
import { getOpsDashboard } from "./operations-routes";
import { createPartnerTestDatabase } from "./test-db";
import { PRODUCT_QUOTE_DEFAULTS } from "./quote";
import { PartnerNotificationSettingsRepository } from "./notification-settings";

const origin = "https://insulhub.example.test";
const companyId = "11111111-1111-4111-8111-111111111111";
const creationKey = "22222222-2222-4222-8222-222222222222";
const newCompany = { creationKey, name: "New Partner" };
const newUser = { name: "New Salesperson", email: "salesperson@example.test", initialPassword: "Fictional-New-Password1!" };
let sequence = 0;
let token: string;
function request(method = "GET", body?: unknown, headers: Record<string,string> = {}) {
  return new Request(`${origin}/api/settings/partners`, { method, headers: { origin, "x-access-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("normal InsulHub Settings partner management", () => {
  let pool: InstanceType<ReturnType<typeof createPartnerTestDatabase>["Pool"]>;
  let deps: SettingsDependencies;
  let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    token = `verified-normal-insulhub-user-${++sequence}`;
    pool = new (createPartnerTestDatabase().Pool)();
    await pool.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,'existing-partner','Existing Partner','INSULHUB_BILLED')", [companyId]);
    upstream = vi.fn<typeof fetch>(async () => Response.json({ data: { users: { results: [{ _id: "legacy-user" }] } } }));
    vi.stubGlobal("fetch", upstream);
    deps = { repository: new PartnerOperationsRepository(pool, true), origins: new Set([origin]), verify: requireInsulhubAuth,notificationRepository:new PartnerNotificationSettingsRepository(pool,true) };
  });
  afterEach(async () => { await pool.end(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const call = (req: Request, id?: string, userId?: string, users = false) => partnerSettingsRoute(req,id,userId,users,deps);
  const notifications=(req:Request)=>partnerSettingsRoute(req,undefined,undefined,false,deps,undefined,true);

  it("allows any verified normal user and returns only minimal company fields", async () => {
    const response = await call(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ companies: [{ id: companyId, name: "Existing Partner", revision: 0, isActive: true }] });
    expect(upstream).toHaveBeenCalledWith("https://api.insulhub.nz/graphql", expect.objectContaining({ redirect: "error", cache: "no-store", headers: expect.objectContaining({ "x-access-token": token }) }));
  });
  it("reads and updates one global notification email with exact auth, Origin and revision checks",async()=>{
    const read=new Request(`${origin}/api/settings/partners/notifications`,{headers:{"x-access-token":token}});const initial=await notifications(read);expect(initial.status).toBe(200);expect(await initial.json()).toMatchObject({settings:{recipientEmail:null,revision:0}});
    const update=new Request(`${origin}/api/settings/partners/notifications`,{method:"PUT",headers:{origin,"x-access-token":token,"content-type":"application/json"},body:JSON.stringify({revision:0,recipientEmail:"Reddyn.Wallace@Gmail.com"})});const saved=await notifications(update);expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({settings:{recipientEmail:"reddyn.wallace@gmail.com",revision:1}});
    expect((await notifications(new Request(`${origin}/api/settings/partners/notifications`,{method:"PUT",headers:{origin,"x-access-token":token,"content-type":"application/json"},body:JSON.stringify({revision:0,recipientEmail:"other@example.test"})}))).status).toBe(409);
    expect((await pool.query("SELECT recipient_email,revision,updated_by_user_id FROM partner_notification_settings WHERE singleton=true")).rows[0]).toEqual({recipient_email:"reddyn.wallace@gmail.com",revision:1,updated_by_user_id:PARTNER_SETTINGS_SERVICE_ID});
  });
  it("rejects notification setting body injection, bad email, wrong Origin and invalid InsulHub tokens",async()=>{
    const put=(body:unknown,headers:Record<string,string>={})=>notifications(new Request(`${origin}/api/settings/partners/notifications`,{method:"PUT",headers:{origin,"x-access-token":token,"content-type":"application/json",...headers},body:JSON.stringify(body)}));
    expect((await put({revision:0,recipientEmail:"bad"})).status).toBe(400);expect((await put({revision:0,recipientEmail:"a@example.test",companyId})).status).toBe(400);expect((await put({revision:0,recipientEmail:"a@example.test"},{origin:"https://evil.test"})).status).toBe(403);
    upstream.mockImplementation(async()=>Response.json({errors:[{message:"revoked"}]}));expect((await put({revision:0,recipientEmail:"a@example.test"},{"x-access-token":`revoked-${++sequence}`})).status).toBe(401);
    expect((await pool.query("SELECT revision FROM partner_notification_settings")).rows[0].revision).toBe(0);
  });
  it("rejects portal/ops cookies and identity headers without a verified normal token", async () => {
    for (const cookie of ["insulhub_partner.session_token=partner", "insulhub_partner.session_token=internal"]) {
      const response = await call(request("GET", undefined, { "x-access-token": "", cookie, "x-test-user": "admin", "x-partner-auth-surface": "ops" }));
      expect(response.status).toBe(401);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("fails closed on invalid normal tokens even when a portal cookie is present", async () => {
    upstream.mockImplementation(async () => Response.json({ errors: [{ message: "Unauthorized" }] }));
    expect((await call(request("POST", newCompany, { cookie: "insulhub_partner.session_token=internal" }))).status).toBe(401);
    expect((await pool.query("SELECT count(*) count FROM partner_companies")).rows[0].count).toBe(1);
  });
  it("resolves Next's internal URL only through an explicitly allowed Host for reads and streamed mutations", async () => {
    const headers={origin,host:"insulhub.example.test","x-forwarded-host":"insulhub.example.test","x-access-token":token};
    const read=new Request("http://localhost:3000/api/settings/partners",{headers});
    expect((await call(read)).status).toBe(200);
    const create=new Request("http://localhost:3000/api/settings/partners",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(newCompany)});
    expect((await call(create)).status).toBe(201);
    const users=new Request("http://localhost:3000/api/settings/partners",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(newUser)});
    expect((await call(users,companyId,undefined,true)).status).toBe(201);
    expect((await call(new Request("http://localhost:3000/api/settings/partners",{headers:{...headers,host:"evil.test"}}))).status).toBe(403);
  });
  it("checks Origin/Host before any upstream request or mutation", async () => {
    for (const headers of [{ origin: "https://evil.test" }, { origin: "null" }, { origin: "" }, { host: "evil.test" }, { "x-forwarded-host": "evil.test" }] as Record<string,string>[]) {
      expect((await call(request("POST", newCompany, headers))).status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("creates with hidden stable identity/fixed defaults, prevents duplicate retries, and audits the service actor", async () => {
    const first = await call(request("POST",newCompany)); expect(first.status).toBe(201);
    expect((await call(request("POST",newCompany))).status).toBe(409);
    const row = (await pool.query("SELECT * FROM partner_companies WHERE slug=$1",[`partner-${creationKey}`])).rows[0];
    expect(row).toMatchObject({ name: newCompany.name, billing_model: "INSULHUB_BILLED", quote_default_wall_rate_cents: PRODUCT_QUOTE_DEFAULTS.wallRateCents, quote_default_ceiling_rate_cents: PRODUCT_QUOTE_DEFAULTS.ceilingRateCents, quote_default_deposit_basis_points: 0, quote_default_consent_fee_cents: 0 });
    expect(row.quote_default_extras).toEqual(PRODUCT_QUOTE_DEFAULTS.extras);
    expect((await pool.query("SELECT actor_user_id FROM partner_audit_events WHERE event_type='OPS_COMPANY_CREATED'")).rows).toEqual([{ actor_user_id: PARTNER_SETTINGS_SERVICE_ID }]);
    expect((await pool.query("SELECT count(*) count FROM partner_companies")).rows[0].count).toBe(2);
  });
  it("updates only the company name with a revision check; slug remains hidden and unchanged", async () => {
    const body = { revision: 0, name: "Renamed Partner" };
    expect((await call(request("PUT",body),companyId)).status).toBe(200);
    expect((await call(request("PUT",body),companyId)).status).toBe(409);
    expect((await pool.query("SELECT slug,name,revision FROM partner_companies WHERE id=$1",[companyId])).rows[0]).toEqual({ slug: "existing-partner", name: "Renamed Partner", revision: 1 });
  });
  it("rejects pricing, credentials, actor, company and role injection", async () => {
    for (const extra of [{ billingModel: "PARTNER_BILLED" }, { slug: "chosen" }, { quoteDefaults: {} }, { depositBasisPoints: 2500 }, { legacyCredential: "secret" }, { actor: PARTNER_SETTINGS_SERVICE_ID }, { principalType: "INTERNAL" }, { companyId }]) {
      expect((await call(request("POST", { ...newCompany,...extra }))).status).toBe(400);
    }
    for (const extra of [{ role: "ADMIN" }, { principalType: "INTERNAL" }, { companyId: creationKey }]) expect((await call(request("POST",{ ...newUser,...extra }),companyId,undefined,true)).status).toBe(400);
  });
  it("creates a company-scoped partner with a hash, lists without secrets, disables and revokes sessions", async () => {
    const response = await call(request("POST",newUser),companyId,undefined,true); expect(response.status).toBe(201);
    const result = await response.json(); const id = result.user.id;
    expect(result).not.toHaveProperty("password");
    expect((await pool.query("SELECT principal_type,company_id FROM partner_users WHERE id=$1",[id])).rows[0]).toEqual({ principal_type: "PARTNER", company_id: companyId });
    const hash = (await pool.query("SELECT password FROM partner_accounts WHERE user_id=$1",[id])).rows[0].password;
    expect(hash).not.toBe(newUser.initialPassword); expect(await verifyPassword({ hash, password: newUser.initialPassword })).toBe(true);
    await pool.query("INSERT INTO partner_sessions(id,token,user_id,expires_at) VALUES('test-session','test-session-token',$1,now()+interval '1 day')",[id]);
    const list = await call(request(),companyId,undefined,true); expect(await list.json()).toEqual({ users: [{ id, name: newUser.name, email: newUser.email, disabledAt: null }] });
    expect((await call(request("DELETE"),companyId,id,true)).status).toBe(200);
    expect((await pool.query("SELECT disabled_at FROM partner_users WHERE id=$1",[id])).rows[0].disabled_at).toBeTruthy();
    expect((await pool.query("SELECT count(*) count FROM partner_sessions WHERE user_id=$1",[id])).rows[0].count).toBe(0);
  });
  it("cannot disable internal accounts, target a partner under the wrong company, or expose job operations", async () => {
    const created = await (await call(request("POST",newUser),companyId,undefined,true)).json();
    expect((await call(request("DELETE"),companyId,PARTNER_SETTINGS_SERVICE_ID,true)).status).toBe(404);
    expect((await call(request("DELETE"),creationKey,created.user.id,true)).status).toBe(404);
    expect((await call(request("DELETE"),companyId)).status).toBe(405);
    expect((await getOpsDashboard(request(),{ repository: deps.repository, origins: deps.origins, getPrincipal: async()=>null })).status).toBe(401);
  });
  it("does not provision a login for the service actor, preserves it on rollback, and blocks after disable", async () => {
    for (const table of ["partner_accounts","partner_sessions"]) expect((await pool.query(`SELECT count(*) count FROM ${table} WHERE user_id=$1`,[PARTNER_SETTINGS_SERVICE_ID])).rows[0].count).toBe(0);
    await call(request("POST",newCompany));
    await pool.query(readFileSync("migrations/partner/010_partner_settings_service.down.sql","utf8"));
    expect((await call(request())).status).toBe(503);
    expect((await pool.query("SELECT actor_user_id FROM partner_audit_events WHERE event_type='OPS_COMPANY_CREATED'")).rows[0].actor_user_id).toBe(PARTNER_SETTINGS_SERVICE_ID);
    const up = readFileSync("migrations/partner/010_partner_settings_service.up.sql","utf8");
    expect(up).toContain("Reserved settings service identity collision");
    for (const table of ["partner_users","partner_accounts","partner_sessions"]) expect(up).toContain(`FROM public.${table}`);
    await pool.query(up.replace(/DO \$\$[\s\S]*?END \$\$;/g,"")); // Real PG collision guard is covered by the mandatory PG gate.
    expect((await call(request())).status).toBe(200);
  });
  it("rejects the service identity in real session creation and in existing session derivation", async () => {
    const auth = createPartnerAuth({ database: pool, baseURL: origin, secret: "fictional-test-secret-more-than-32-characters" });
    const hash = await hashPassword(newUser.initialPassword);
    await pool.query("INSERT INTO partner_accounts(id,account_id,provider_id,user_id,password) VALUES('collision-account',$1,'credential',$1,$2)",[PARTNER_SETTINGS_SERVICE_ID,hash]);
    const login = await auth.handler(new Request(`${origin}/api/partner/auth/sign-in/email`,{ method:"POST",headers:{origin,"content-type":"application/json","x-partner-auth-surface":"ops"},body:JSON.stringify({email:"insulhub-settings-service@internal.invalid",password:newUser.initialPassword}) }));
    expect(login.ok).toBe(false);
    expect((await pool.query("SELECT count(*) count FROM partner_sessions WHERE user_id=$1",[PARTNER_SETTINGS_SERVICE_ID])).rows[0].count).toBe(0);
    vi.spyOn(auth.api,"getSession").mockResolvedValue({ user:{id:PARTNER_SETTINGS_SERVICE_ID} } as Awaited<ReturnType<typeof auth.api.getSession>>);
    expect(await getAuthenticatedPrincipalWith(auth,pool,new Headers())).toBeNull();
  });
});

describe("normal InsulHub auth verification is fail-closed", () => {
  afterEach(()=>{ vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each([{}, {data:null}, {data:{users:{}}}, {data:{users:{results:[{}]}}}, {data:{users:{results:[{_id:""}]}}}, {errors:[{message:"denied"}]}])("rejects malformed GraphQL success %j", async body=>{
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json(body)));
    const denied = await requireInsulhubAuth(new NextRequest(origin,{headers:{"x-access-token":`malformed-${++sequence}`}}));
    expect(denied?.status).toBe(401);
  });
  it("denies oversized credentials without sending them upstream and reports outages without accepting login", async()=>{
    const fetcher=vi.fn(async()=>{ throw new Error("offline"); });vi.stubGlobal("fetch",fetcher);
    expect((await requireInsulhubAuth(new NextRequest(origin,{headers:{"x-access-token":"x".repeat(8193)}})))?.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await requireInsulhubAuth(new NextRequest(origin,{headers:{"x-access-token":`offline-${++sequence}`}})))?.status).toBe(503);
  });
  it("reuses only successful verification for five minutes and then rechecks", async()=>{
    const now=vi.spyOn(Date,"now").mockReturnValue(1_000_000);
    const fetcher=vi.fn(async()=>Response.json({data:{users:{results:[]}}}));vi.stubGlobal("fetch",fetcher);
    const req=new NextRequest(origin,{headers:{authorization:`Bearer cache-${++sequence}`}});
    expect(await requireInsulhubAuth(req)).toBeNull();expect(await requireInsulhubAuth(req)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_300_001);fetcher.mockImplementation(async()=>Response.json({errors:[{message:"revoked"}]}));
    expect((await requireInsulhubAuth(req))?.status).toBe(401);expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
