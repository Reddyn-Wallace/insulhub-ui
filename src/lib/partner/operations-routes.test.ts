import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPartnerAuth, getAuthenticatedPrincipalWith } from "./auth";
import { partnerLogin } from "./auth-route";
import { PartnerOperationsRepository } from "./operations-repository";
import { deleteOpsPartnerUser, getOpsCompanies, getOpsDashboard, getOpsJob, getOpsPartnerUsers, postOpsAmendment, postOpsCompany, postOpsFact, postOpsPartnerUser, putOpsCompany, putOpsInvoice, putOpsSettlement, type OpsRouteDependencies } from "./operations-routes";
import { parseCompany, parseInvoice, parseOpsFact, parsePartnerUser, parseSettlement, requiredRole } from "./operations";
import { PRODUCT_QUOTE_DEFAULTS } from "./quote";
import type { AuthenticatedPrincipal } from "./repository";
import { createPartnerTestDatabase } from "./test-db";
import { getPartnerTracking } from "./tracking-routes";

const origin = "https://ops.example.test";
const companyA = "11111111-1111-4111-8111-111111111111";
const companyB = "22222222-2222-4222-8222-222222222222";
const jobA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const jobB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const draftId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const timestamp = "2026-08-31T01:00:00.000Z";
const companyInput = { slug: "new-company", name: "New Company", billingModel: "INSULHUB_BILLED", quoteDefaults: { wallRateCents: 9500, ceilingRateCents: 6500, depositBasisPoints: 2500, consentFeeCents: 0, extras: PRODUCT_QUOTE_DEFAULTS.extras } };
const userInput = { name: "New Partner", email: "new.partner@example.test", initialPassword: "Fictional-Passw0rd!" };
const invoiceInput = { revision: 0, reference: "INV-100", amountCents: 50000, sentAt: timestamp };
const settlementInput = { revision: 0, grossCents: 50000, commissionCents: 10000, status: "PENDING" };

function request(actor = "admin", body?: unknown, options: { method?: string; headers?: Record<string, string>; raw?: BodyInit } = {}) {
  const headers = new Headers({ origin, "x-test-user": actor, ...options.headers });
  if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`${origin}/api/partner-ops/test`, { method: options.method ?? (body === undefined ? "GET" : "POST"), headers, ...(body === undefined && !options.raw ? {} : { body: options.raw ?? JSON.stringify(body) }) });
}

async function fixture() {
  const { Pool } = createPartnerTestDatabase();
  const pool = new Pool();
  await pool.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,'a','Company A','INSULHUB_BILLED'),($2,'b','Company B','PARTNER_BILLED')", [companyA, companyB]);
  for (const role of ["ADMIN", "OPERATIONS", "FINANCE", "VIEWER"]) await pool.query("INSERT INTO partner_users(id,principal_type,name,email,ops_role) VALUES($1,'INTERNAL',$1,$2,$3)", [role.toLowerCase(), `${role.toLowerCase()}@example.test`, role]);
  await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email,ops_role) VALUES('partner-a',$1,'PARTNER','Partner A','a@example.test',NULL),('partner-b',$2,'PARTNER','Partner B','b@example.test',NULL)", [companyA, companyB]);
  await pool.query("INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,submission_state,billing_model_snapshot,submission_started_at,submitted_at) VALUES($1,$2,'partner-a','A-1','SUBMITTED','INSULHUB_BILLED',now(),now()),($3,$4,'partner-b','B-1','SUBMITTED','PARTNER_BILLED',now(),now())", [jobA, companyA, jobB, companyB]);
  await pool.query("INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,billing_model_snapshot) VALUES($1,$2,'partner-a','DRAFT-1','INSULHUB_BILLED')", [draftId, companyA]);
  const repository = new PartnerOperationsRepository(pool, true);
  const getPrincipal = async (headers: Headers): Promise<AuthenticatedPrincipal | null> => {
    const id = headers.get("x-test-user");
    if (!id) return null;
    if (id === "partner-a" || id === "partner-b") return { userId: id, principalType: "PARTNER", companyId: id === "partner-a" ? companyA : companyB };
    if (["admin", "operations", "finance", "viewer"].includes(id)) return { userId: id, principalType: "INTERNAL", companyId: null };
    return null;
  };
  const deps: OpsRouteDependencies = { repository, origins: new Set([origin]), getPrincipal };
  return { pool, repository, deps, getPrincipal };
}

describe("strict operations domain", () => {
  it("uses exactly the quote draft defaults contract, including extras", () => {
    expect(parseCompany(companyInput)?.quoteDefaults).toEqual(companyInput.quoteDefaults);
    for (const changed of [{ wallRateCents: 0 }, { wallRateCents: 10_000_001 }, { extras: undefined }, { revision: 42 }, { secrets: "private" }, { extras: [{ id: "x", name: "x", priceCents: 1, companyId: companyB }] }]) expect(parseCompany({ ...companyInput, quoteDefaults: { ...companyInput.quoteDefaults, ...changed } })).toBeNull();
  });
  it("rejects impossible and timezone-ambiguous dates and unsafe revisions", () => {
    for (const sentAt of ["2026-02-30T00:00:00Z", "2026-08-31", "2026-08-31T00:00:00", "tomorrow", "2026-08-31T24:00:00Z"]) expect(parseInvoice({ ...invoiceInput, sentAt })).toBeNull();
    for (const revision of [-1, 0.5, 2_147_483_648, Infinity]) expect(parseInvoice({ ...invoiceInput, revision })).toBeNull();
    expect(parseOpsFact({ factType: "INSTALL_DATE_SET", at: "2026-09-01" })).toEqual({ factType: "INSTALL_DATE_SET", at: "2026-09-01T00:00:00.000Z" });
    expect(parseOpsFact({ factType: "INSTALL_DATE_SET", at: "2026-02-30" })).toBeNull();
    expect(parseOpsFact({ factType: "COMMISSION_PAID", at: timestamp })).toBeNull();
  });
  it("keeps financial statuses model-specific and grants invoice access to finance", () => {
    expect(requiredRole("invoice")).toContain("FINANCE");
    expect(parseSettlement({ ...settlementInput, status: "PAID", settledAt: timestamp }, "PARTNER_BILLED")).toBeNull();
    expect(parseSettlement({ ...settlementInput, status: "RECEIVED", settledAt: timestamp }, "INSULHUB_BILLED")).toBeNull();
    expect(parseSettlement({ ...settlementInput, settledAt: timestamp }, "INSULHUB_BILLED")).toBeNull();
    expect(parseSettlement({ ...settlementInput, commissionCents: 50001 }, "INSULHUB_BILLED")).toBeNull();
  });
  it("accepts only bounded lowercase partner accounts and never role injection", () => {
    expect(parsePartnerUser(userInput)).toEqual(userInput);
    for (const changed of [{ email: "CAPS@example.test" }, { initialPassword: "short" }, { initialPassword: "a".repeat(129) }, { principalType: "INTERNAL" }, { companyId: companyB }, { opsRole: "ADMIN" }]) expect(parsePartnerUser({ ...userInput, ...changed })).toBeNull();
  });
});

describe("operations route security and composition", () => {
  let test: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { test = await fixture(); });
  afterEach(async () => { await test.pool.end(); });

  const calls = [
    ["dashboard", (r: Request, d: OpsRouteDependencies) => getOpsDashboard(r, d)],
    ["job", (r: Request, d: OpsRouteDependencies) => getOpsJob(r, jobA, d)],
    ["companies", (r: Request, d: OpsRouteDependencies) => getOpsCompanies(r, d)],
    ["users", (r: Request, d: OpsRouteDependencies) => getOpsPartnerUsers(r, companyA, d)],
    ["company create", (r: Request, d: OpsRouteDependencies) => postOpsCompany(r, d)],
    ["company update", (r: Request, d: OpsRouteDependencies) => putOpsCompany(r, companyA, d)],
    ["user create", (r: Request, d: OpsRouteDependencies) => postOpsPartnerUser(r, companyA, d)],
    ["user disable", (r: Request, d: OpsRouteDependencies) => deleteOpsPartnerUser(r, companyA, "partner-a", d)],
    ["fact", (r: Request, d: OpsRouteDependencies) => postOpsFact(r, companyA, jobA, d)],
    ["amendment", (r: Request, d: OpsRouteDependencies) => postOpsAmendment(r, companyA, jobA, d)],
    ["invoice", (r: Request, d: OpsRouteDependencies) => putOpsInvoice(r, companyA, jobA, d)],
    ["settlement", (r: Request, d: OpsRouteDependencies) => putOpsSettlement(r, companyA, jobA, d)],
  ] as const;
  it.each(calls)("denies missing/partner principals on %s without leaking data", async (_name, call) => {
    for (const actor of ["unknown", "partner-a", "partner-b"]) {
      const response = await call(request(actor), test.deps);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("checks exact Origin and Host before every mutation", async () => {
    for (const headers of [{ origin: "https://evil.test" }, { origin: `${origin}/path` }, { origin: "null" }, { host: "evil.test" }, { "x-forwarded-host": "evil.test" }, { "x-forwarded-host": "ops.example.test, evil.test" }] as Record<string, string>[]) {
      const response = await postOpsCompany(request("admin", companyInput, { headers }), test.deps);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await test.pool.query("SELECT count(*) count FROM partner_companies")).rows[0].count).toBe(2);
  });

  it("rejects malformed, overlarge and misleading streamed JSON before writes", async () => {
    for (const raw of ["[]", "null", "not json", JSON.stringify({ ...companyInput, privateToken: "sentinel" }), JSON.stringify({ ...companyInput, name: "x".repeat(17_000) })]) {
      const response = await postOpsCompany(request("admin", undefined, { method: "POST", raw, headers: { "content-type": "application/json" } }), test.deps);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("sentinel");
    }
    for (const headers of [{ "content-type": "text/plain" }, { "content-length": "0" }, { "content-length": "-1" }, { "content-length": "20000" }] as Record<string, string>[]) expect((await postOpsCompany(request("admin", companyInput, { headers }), test.deps)).status).toBe(400);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"name":"')); controller.enqueue(new Uint8Array(17_000).fill(65)); controller.close(); } });
    const streamed = new Request(`${origin}/api/partner-ops/companies`, { method: "POST", headers: { origin, "x-test-user": "admin", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect((await postOpsCompany(streamed, test.deps)).status).toBe(400);
    expect((await test.pool.query("SELECT count(*) count FROM partner_companies")).rows[0].count).toBe(2);
  });

  it("revalidates stored roles and disabled actors for reads and writes", async () => {
    expect((await getOpsDashboard(request("viewer"), test.deps)).status).toBe(200);
    expect((await postOpsCompany(request("operations", companyInput), test.deps)).status).toBe(403);
    expect((await postOpsPartnerUser(request("finance", userInput), companyA, test.deps)).status).toBe(403);
    expect((await postOpsFact(request("viewer", { factType: "EBA_COMPLETED", at: timestamp }), companyA, jobA, test.deps)).status).toBe(403);
    expect((await putOpsSettlement(request("operations", settlementInput), companyA, jobA, test.deps)).status).toBe(403);
    await test.pool.query("UPDATE partner_users SET disabled_at=now() WHERE id='admin'");
    expect((await getOpsDashboard(request(), test.deps)).status).toBe(403);
    expect((await postOpsCompany(request("admin", companyInput), test.deps)).status).toBe(403);
  });

  it("creates a real usable partner account, keeps its password private and revokes login on disable", async () => {
    const response = await postOpsPartnerUser(request("admin", userInput), companyA, test.deps);
    expect(response.status).toBe(201);
    const created = await response.json() as { user: { id: string } };
    expect(JSON.stringify(created)).not.toMatch(/password|hash|salt/i);
    const auth = createPartnerAuth({ database: test.pool as never, baseURL: origin, secret: "operations-real-login-test-secret-long-enough" });
    const authDeps = { auth, sql: test.pool, origins: new Set([origin]), getPrincipal: (headers: Headers) => getAuthenticatedPrincipalWith(auth, test.pool, headers) };
    const login = await partnerLogin(new Request(`${origin}/api/partner/auth/login`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": "192.0.2.110" }, body: JSON.stringify({ email: userInput.email, password: userInput.initialPassword }) }), "partner", authDeps);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    expect(await authDeps.getPrincipal(new Headers({ cookie }))).toMatchObject({ companyId: companyA, userId: created.user.id });
    expect((await deleteOpsPartnerUser(request("admin", undefined, { method: "DELETE" }), companyB, created.user.id, test.deps)).status).toBe(404);
    expect(await authDeps.getPrincipal(new Headers({ cookie }))).not.toBeNull();
    const empty = new Request(`${origin}/api/partner-ops/users`, { method: "DELETE", headers: { origin, "x-test-user": "admin", "content-length": "0" }, body: new ReadableStream({ start(c) { c.close(); } }), duplex: "half" } as RequestInit);
    expect((await deleteOpsPartnerUser(empty, companyA, created.user.id, test.deps)).status).toBe(200);
    expect(await authDeps.getPrincipal(new Headers({ cookie }))).toBeNull();
    const audit = await test.pool.query("SELECT event_type,metadata FROM partner_audit_events");
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit.rows)).not.toContain(userInput.initialPassword);
  });

  it("keeps company defaults and existing billing snapshots separate and detects stale updates", async () => {
    const response = await postOpsCompany(request("admin", companyInput), test.deps);
    expect(response.status).toBe(201);
    const created = await response.json() as { company: { id: string } };
    const input = { ...companyInput, name: "Renamed", billingModel: "PARTNER_BILLED" };
    expect((await putOpsCompany(request("admin", { revision: 0, company: input }), created.company.id, test.deps)).status).toBe(200);
    expect((await putOpsCompany(request("admin", { revision: 0, company: input }), created.company.id, test.deps)).status).toBe(409);
    const companies = await (await getOpsCompanies(request(), test.deps)).json() as { companies: Array<{ id: string; quoteDefaults: unknown }> };
    expect(companies.companies.find(company => company.id === created.company.id)?.quoteDefaults).toMatchObject(companyInput.quoteDefaults);
    expect((await test.pool.query("SELECT billing_model_snapshot FROM partner_jobs WHERE id=$1", [jobA])).rows[0].billing_model_snapshot).toBe("INSULHUB_BILLED");
    expect((await putOpsCompany(request("admin", { revision: -1, company: input }), created.company.id, test.deps)).status).toBe(400);
    expect((await putOpsCompany(request("admin", { revision: 1, company: input, companyId: companyB }), created.company.id, test.deps)).status).toBe(400);
  });

  it("denies mismatched company/job pairs and keeps partner tracking company-scoped", async () => {
    const responses = [
      await postOpsFact(request("admin", { factType: "EBA_COMPLETED", at: timestamp }), companyB, jobA, test.deps),
      await postOpsAmendment(request("admin", { version: 1, description: "change" }), companyB, jobA, test.deps),
      await putOpsInvoice(request("admin", invoiceInput), companyB, jobA, test.deps),
      await putOpsSettlement(request("admin", settlementInput), companyB, jobA, test.deps),
    ];
    for (const response of responses) expect(response.status).toBeGreaterThanOrEqual(400);
    for (const actor of ["partner-b", "admin", "unknown"]) {
      const response = await getPartnerTracking(request(actor), jobA, { repository: test.repository, getPrincipal: test.getPrincipal });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found." });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await getPartnerTracking(request("partner-a"), jobA, { repository: test.repository, getPrincipal: test.getPrincipal })).status).toBe(200);
    await test.pool.query("UPDATE partner_companies SET is_active=false WHERE id=$1", [companyA]);
    expect((await getPartnerTracking(request("partner-a"), jobA, { repository: test.repository, getPrincipal: test.getPrincipal })).status).toBe(404);
  });

  it("prevents duplicate checklist facts but preserves later install-date corrections", async () => {
    expect((await postOpsFact(request("admin", { factType: "EBA_COMPLETED", at: timestamp }), companyA, jobA, test.deps)).status).toBe(200);
    expect((await postOpsFact(request("admin", { factType: "EBA_COMPLETED", at: timestamp }), companyA, jobA, test.deps)).status).toBe(409);
    for (const at of ["2026-09-04", "2026-09-02"]) expect((await postOpsFact(request("admin", { factType: "INSTALL_DATE_SET", at }), companyA, jobA, test.deps)).status).toBe(200);
    const projection = await test.repository.partnerProjection(companyA, jobA);
    expect(String(projection?.milestones.INSTALL_DATE_SET?.installDate).slice(0, 10)).toBe("2026-09-02");
  });

  it("rejects draft operations and cancellation locks updates but permits an explanatory amendment", async () => {
    expect((await postOpsFact(request("admin", { factType: "EBA_COMPLETED", at: timestamp }), companyA, draftId, test.deps)).status).toBe(409);
    expect((await postOpsAmendment(request("admin", { version: 1, description: "change" }), companyA, draftId, test.deps)).status).toBe(409);
    expect((await putOpsInvoice(request("admin", invoiceInput), companyA, draftId, test.deps)).status).toBe(409);
    expect((await postOpsFact(request("admin", { factType: "CANCELLED", at: timestamp }), companyA, jobA, test.deps)).status).toBe(200);
    expect((await postOpsFact(request("admin", { factType: "EBA_COMPLETED", at: timestamp }), companyA, jobA, test.deps)).status).toBe(409);
    expect((await postOpsFact(request("admin", { factType: "CANCELLED", at: timestamp }), companyA, jobA, test.deps)).status).toBe(409);
    expect((await putOpsInvoice(request("admin", invoiceInput), companyA, jobA, test.deps)).status).toBe(409);
    expect((await putOpsSettlement(request("admin", settlementInput), companyA, jobA, test.deps)).status).toBe(409);
    expect((await postOpsAmendment(request("admin", { version: 1, description: "Customer requested cancellation." }), companyA, jobA, test.deps)).status).toBe(201);
  });

  it.each([[companyA, jobA, "PAID", "COMMISSION_PAID", 10000], [companyB, jobB, "RECEIVED", "REMITTANCE_RECEIVED", 40000]] as const)("records the correct financial path for %s", async (companyId, jobId, status, fact, net) => {
    expect((await putOpsSettlement(request("finance", settlementInput), companyId, jobId, test.deps)).status).toBe(409);
    expect((await putOpsInvoice(request("finance", invoiceInput), companyId, jobId, test.deps)).status).toBe(200);
    expect((await putOpsSettlement(request("finance", { ...settlementInput, grossCents: 49999 }), companyId, jobId, test.deps)).status).toBe(409);
    expect((await putOpsSettlement(request("finance", { ...settlementInput, status, settledAt: timestamp }), companyId, jobId, test.deps)).status).toBe(200);
    const projection = await test.repository.partnerProjection(companyId, jobId);
    expect(projection?.settlement).toMatchObject({ status, netDueCents: net });
    expect(projection?.milestones[fact]).toBeDefined();
    expect((await putOpsSettlement(request("finance", { ...settlementInput, status, settledAt: timestamp }), companyId, jobId, test.deps)).status).toBe(409);
    expect((await putOpsInvoice(request("finance", { ...invoiceInput, amountCents: 51000 }), companyId, jobId, test.deps)).status).toBe(409);
  });
});
