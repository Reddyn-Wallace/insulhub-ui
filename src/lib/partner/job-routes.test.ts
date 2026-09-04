import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createPartnerAuth, getAuthenticatedPrincipalWith } from "./auth";
import { partnerLogin } from "./auth-route";
import { EMPTY_LEAD_DRAFT } from "./draft";
import { deletePartnerDraft, createPartnerDraft, getPartnerJob, listPartnerJobs, updatePartnerDraft, type PartnerJobRouteDependencies } from "./job-routes";
import { PartnerRepository } from "./repository";
import { createPartnerTestDatabase } from "./test-db";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS, setQuoteProductEnabled } from "./quote";

const origin = "https://portal.example.test";
const password = "correct horse battery staple";

async function fixture() {
  const { Pool } = createPartnerTestDatabase();
  const pool = new Pool();
  const companyA = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('route-a', 'Route A', 'INSULHUB_BILLED') RETURNING id")).rows[0].id;
  const companyB = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('route-b', 'Route B', 'PARTNER_BILLED') RETURNING id")).rows[0].id;
  const hash = await hashPassword(password);
  const users = [
    { id: "route-a1", companyId: companyA, type: "PARTNER", email: "a1@route.test" },
    { id: "route-a2", companyId: companyA, type: "PARTNER", email: "a2@route.test" },
    { id: "route-b1", companyId: companyB, type: "PARTNER", email: "b1@route.test" },
    { id: "route-ops", companyId: null, type: "INTERNAL", email: "ops@route.test" },
  ];
  for (const user of users) {
    await pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email, ops_role) VALUES ($1, $2, $3, $4, $5, $6)", [user.id, user.companyId, user.type, user.id, user.email, user.type === "INTERNAL" ? "ADMIN" : null]);
    await pool.query("INSERT INTO partner_accounts (id, account_id, provider_id, user_id, password) VALUES ($1, $2, 'credential', $2, $3)", [randomUUID(), user.id, hash]);
  }
  const auth = createPartnerAuth({ database: pool as never, baseURL: origin, secret: "job-route-test-secret-that-is-long-enough" });
  const authDependencies = { auth, sql: pool, origins: new Set([origin]), getPrincipal: (headers: Headers) => getAuthenticatedPrincipalWith(auth, pool, headers) };
  const dependencies: PartnerJobRouteDependencies = { repository: new PartnerRepository(pool), origins: new Set([origin]), getPrincipal: authDependencies.getPrincipal };

  async function login(email: string, surface: "partner" | "ops" = "partner") {
    const route = surface === "ops" ? "partner-ops" : "partner";
    const response = await partnerLogin(new Request(`${origin}/api/${route}/auth/login`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${users.findIndex((user) => user.email === email) + 20}` }, body: JSON.stringify({ email, password }) }), surface, authDependencies);
    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) throw new Error("Expected route test session cookie");
    return setCookie.split(";")[0];
  }
  return { pool, companyA, companyB, dependencies, login };
}

function request(path: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  if (cookie) headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`${origin}${path}`, { ...init, headers });
}

describe("authenticated partner job route composition", () => {
  let test: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { test = await fixture(); });

  it("deletes only same-company drafts with exact Origin, valid revision, and partner authentication", async () => {
    const a1 = await test.login("a1@route.test"), a2 = await test.login("a2@route.test"), b1 = await test.login("b1@route.test"), ops = await test.login("ops@route.test","ops");
    const create = await createPartnerDraft(request("/api/partner/jobs",a1,{method:"POST",body:JSON.stringify(EMPTY_LEAD_DRAFT)}),test.dependencies);
    const id = (await create.json()).job.id, path = `/api/partner/jobs/${id}`;
    const remove = (cookie?:string, body:unknown={revision:0}) => deletePartnerDraft(request(path,cookie,{method:"DELETE",body:JSON.stringify(body)}),id,test.dependencies);
    expect((await remove()).status).toBe(401);
    expect((await remove(ops)).status).toBe(401);
    expect((await remove(b1)).status).toBe(404);
    for(const originValue of ["https://evil.test",origin+"/path","null",""]) {
      const r=request(path,a1,{method:"DELETE",body:JSON.stringify({revision:0})});r.headers.set("origin",originValue);
      expect((await deletePartnerDraft(r,id,test.dependencies)).status).toBe(403);
    }
    for(const body of [{revision:-1},{revision:0.5},{revision:"0"},{revision:0,companyId:test.companyB},{},null])expect((await remove(a1,body)).status).toBe(400);
    expect((await remove(a1,{revision:9})).status).toBe(409);
    const deleted=await remove(a2);
    expect(deleted.status).toBe(200);expect(deleted.headers.get("cache-control")).toBe("private, no-store");expect(await deleted.json()).toEqual({deleted:true});
    expect((await remove(a1)).status).toBe(404);
    expect((await getPartnerJob(request(path,a1),id,test.dependencies)).status).toBe(404);
    expect((await updatePartnerDraft(request(path,a1,{method:"PATCH",body:JSON.stringify({revision:0,draft:EMPTY_LEAD_DRAFT})}),id,test.dependencies)).status).toBe(404);
    expect((await (await listPartnerJobs(request("/api/partner/jobs",a1),test.dependencies)).json()).jobs).toHaveLength(0);
  });
  it("blocks submitted deletion and reports uncertain failures without claiming success",async()=>{
    const a=await test.login("a1@route.test");
    const id=(await (await createPartnerDraft(request("/api/partner/jobs",a,{method:"POST",body:JSON.stringify(EMPTY_LEAD_DRAFT)}),test.dependencies)).json()).job.id;
    await test.pool.query("UPDATE partner_jobs SET submission_state='SUBMITTED',submission_started_at=now(),submitted_at=now() WHERE id=$1",[id]);
    const r=()=>request(`/api/partner/jobs/${id}`,a,{method:"DELETE",body:JSON.stringify({revision:0})});
    const result=await deletePartnerDraft(r(),id,test.dependencies);
    expect(result.status).toBe(409);expect(await result.json()).toMatchObject({code:"DRAFT_LOCKED"});
    const broken={...test.dependencies,repository:{deleteDraft:async()=>{throw Error("private database details");}} as unknown as PartnerRepository};
    const failed=await deletePartnerDraft(r(),id,broken);expect(failed.status).toBe(503);expect(JSON.stringify(await failed.json())).not.toContain("private database details");
  });
  it("binds concurrent/lost-response create retries to one company job and rejects changed payloads", async () => {
    const a = await test.login("a1@route.test"), b = await test.login("b1@route.test");
    const key = randomUUID(), draft = { ...EMPTY_LEAD_DRAFT, customerName: "Created once" };
    const create = (cookie: string, body = draft) => createPartnerDraft(request("/api/partner/jobs", cookie, { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify(body) }), test.dependencies);
    const first = await create(a); const id = (await first.json()).job.id;
    const replays = await Promise.all([create(a), create(a)]);
    for (const replay of replays) { expect(replay.status).toBe(201); expect((await replay.json()).job.id).toBe(id); }
    expect((await create(a, { ...draft, customerName: "Different original request" })).status).toBe(409);
    const other = await create(b); expect((await other.json()).job.id).not.toBe(id);
    expect((await test.pool.query("SELECT id FROM partner_jobs WHERE company_id=$1", [test.companyA])).rows).toHaveLength(1);
    const record = (await test.pool.query("SELECT draft_create_key_hash,draft_create_payload_hash FROM partner_jobs WHERE id=$1", [id])).rows[0];
    expect(record.draft_create_key_hash).toMatch(/^[0-9a-f]{64}$/); expect(record.draft_create_payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.draft_create_key_hash).not.toBe(key);
  });

  it("lets same-company users create and share a draft without accepting tenant input", async () => {
    const a1 = await test.login("a1@route.test");
    const a2 = await test.login("a2@route.test");
    const create = await createPartnerDraft(request("/api/partner/jobs", a1, { method: "POST", body: JSON.stringify({ ...EMPTY_LEAD_DRAFT, customerName: "Fictional Shared Lead" }) }), test.dependencies);
    expect(create.status).toBe(201);
    expect(create.headers.get("cache-control")).toBe("private, no-store");
    const created = await create.json() as { job: { id: string; companyId?: string } };
    expect(created.job.companyId).toBeUndefined();
    const list = await listPartnerJobs(request("/api/partner/jobs?search=fictional", a2), test.dependencies);
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    expect((await list.json() as { jobs: Array<{ id: string }> }).jobs.map((job) => job.id)).toContain(created.job.id);

    const injection = await createPartnerDraft(request("/api/partner/jobs", a1, { method: "POST", body: JSON.stringify({ ...EMPTY_LEAD_DRAFT, companyId: test.companyB }) }), test.dependencies);
    expect(injection.status).toBe(400);
  });

  it("returns not found for second-tenant guessed detail and update IDs", async () => {
    const a1 = await test.login("a1@route.test");
    const b1 = await test.login("b1@route.test");
    const created = await (await createPartnerDraft(request("/api/partner/jobs", a1, { method: "POST", body: JSON.stringify(EMPTY_LEAD_DRAFT) }), test.dependencies)).json() as { job: { id: string } };
    const detail = await getPartnerJob(request(`/api/partner/jobs/${created.job.id}`, b1), created.job.id, test.dependencies);
    expect(detail.status).toBe(404);
    expect(detail.headers.get("cache-control")).toBe("private, no-store");
    const update = await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, b1, { method: "PATCH", body: JSON.stringify({ revision: 0, draft: EMPTY_LEAD_DRAFT }) }), created.job.id, test.dependencies);
    expect(update.status).toBe(404);
    expect(update.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await update.json())).not.toContain("Fictional");
  });

  it("enforces exact Origin, session, optimistic revision, and draft-only mutation", async () => {
    const a1 = await test.login("a1@route.test");
    const created = await (await createPartnerDraft(request("/api/partner/jobs", a1, { method: "POST", body: JSON.stringify(EMPTY_LEAD_DRAFT) }), test.dependencies)).json() as { job: { id: string } };
    const badOriginRequest = request(`/api/partner/jobs/${created.job.id}`, a1, { method: "PATCH", body: JSON.stringify({ revision: 0, draft: EMPTY_LEAD_DRAFT }) });
    badOriginRequest.headers.set("origin", "https://evil.example.test");
    expect((await updatePartnerDraft(badOriginRequest, created.job.id, test.dependencies)).status).toBe(403);
    expect((await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, undefined, { method: "PATCH", body: JSON.stringify({ revision: 0, draft: EMPTY_LEAD_DRAFT }) }), created.job.id, test.dependencies)).status).toBe(401);

    const first = await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, a1, { method: "PATCH", body: JSON.stringify({ revision: 0, draft: { ...EMPTY_LEAD_DRAFT, customerName: "Newest Value" } }) }), created.job.id, test.dependencies);
    expect(first.status).toBe(200);
    const stale = await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, a1, { method: "PATCH", body: JSON.stringify({ revision: 0, draft: EMPTY_LEAD_DRAFT }) }), created.job.id, test.dependencies);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "STALE_REVISION", currentRevision: 1 });

    await test.pool.query("UPDATE partner_jobs SET submission_state = 'SUBMITTED', submission_started_at = now(), submitted_at = now() WHERE id = $1", [created.job.id]);
    const locked = await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, a1, { method: "PATCH", body: JSON.stringify({ revision: 1, draft: EMPTY_LEAD_DRAFT }) }), created.job.id, test.dependencies);
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ code: "DRAFT_LOCKED" });
  });

  it("never grants an internal session implicit partner data access", async () => {
    const ops = await test.login("ops@route.test", "ops");
    expect((await listPartnerJobs(request("/api/partner/jobs", ops), test.dependencies)).status).toBe(401);
  });

  it("returns authoritative quote totals and rejects client-computed totals", async () => {
    const a1 = await test.login("a1@route.test");
    let quote = setQuoteProductEnabled(createQuoteDraft(PRODUCT_QUOTE_DEFAULTS), "wall", true);
    quote = { ...quote, wall: { ...quote.wall, areaSqm: 10, rateCentsPerSqm: 10000, cavityDepthCm: 10 } };
    const create = await createPartnerDraft(request("/api/partner/jobs", a1, { method: "POST", body: JSON.stringify({ ...EMPTY_LEAD_DRAFT, quote }) }), test.dependencies);
    expect(create.status).toBe(201);
    const created = await create.json() as { job: { id: string; quote: { quoteNumber: string; quoteDate: string }; quoteCalculation: { totalCents: number } } };
    expect(created.job.quote.quoteNumber).toMatch(/^LOCAL-DRAFT-/);
    expect(Date.parse(created.job.quote.quoteDate)).not.toBeNaN();
    expect(created.job.quoteCalculation.totalCents).toBe(152950);

    const tampered = await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, a1, { method: "PATCH", body: JSON.stringify({ revision: 0, draft: { ...EMPTY_LEAD_DRAFT, quote: { ...quote, totals: { totalCents: 1 } } } }) }), created.job.id, test.dependencies);
    expect(tampered.status).toBe(400);
    expect(JSON.stringify(await tampered.json())).not.toContain("100000");

    const piiSentinel = "private.person+sentinel@example.test";
    const nestedTampering = [
      { ...quote, wall: { ...quote.wall, companyId: test.companyB, calculation: { note: piiSentinel } } },
      { ...quote, extras: [{ ...quote.extras[0], tenantId: test.companyB, note: piiSentinel }] },
      { ...quote, defaultsSnapshot: { ...quote.defaultsSnapshot, totals: { note: piiSentinel } } },
    ];
    for (const unsafeQuote of nestedTampering) {
      const response = await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, a1, { method: "PATCH", body: JSON.stringify({ revision: 0, draft: { ...EMPTY_LEAD_DRAFT, quote: unsafeQuote } }) }), created.job.id, test.dependencies);
      expect(response.status).toBe(400);
      const errorBody = JSON.stringify(await response.json());
      expect(errorBody).not.toContain(piiSentinel);
      expect(errorBody).not.toContain(test.companyB);
    }

    const unsafeEnvelope = await updatePartnerDraft(request(`/api/partner/jobs/${created.job.id}`, a1, { method: "PATCH", body: JSON.stringify({ revision: 0, companyId: test.companyB, draft: EMPTY_LEAD_DRAFT }) }), created.job.id, test.dependencies);
    expect(unsafeEnvelope.status).toBe(400);
    expect(JSON.stringify(await unsafeEnvelope.json())).not.toContain(test.companyB);
  });
});
