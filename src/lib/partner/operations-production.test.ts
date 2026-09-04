import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COMPANY_ACCESS_GATE_SIGNATURES, OPS_GATE_SIGNATURES, LINK_GATE_SIGNATURES, LIVE_CONNECTION_GATE_SIGNATURES, NOTIFICATION_SETTINGS_GATE_SIGNATURES } from "../../../scripts/partner-ops-postgres-probes.mjs";
import { PARTNER_OPS_FUNCTION_SIGNATURES, type PartnerSql } from "./db";
import { PartnerOperationsRepository } from "./operations-repository";
import { PRODUCT_QUOTE_DEFAULTS } from "./quote";
import { createPartnerTestDatabase } from "./test-db";

const actor = { userId: "internal-admin", principalType: "INTERNAL" as const, companyId: null };
const company = "11111111-1111-4111-8111-111111111111", job = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const date = "2026-08-31T00:00:00.000Z";
const trackingFixture = { id: job, billingModel: "INSULHUB_BILLED", clientReference: "ONE-1", milestones: { EBA_COMPLETED: { recordedAt: date, effectiveAt: date }, INSTALL_DATE_SET: { recordedAt: date, installDate: "2026-09-02" } }, amendments: [{ sequence: 1, description: "Scope confirmed", createdAt: date }], invoice: null, settlement: null };
const companyInput = { slug: "one", name: "One", billingModel: "INSULHUB_BILLED" as const, quoteDefaults: { wallRateCents: 9000, ceilingRateCents: 6000, depositBasisPoints: 2500, consentFeeCents: 0, extras: PRODUCT_QUOTE_DEFAULTS.extras } };

function functionOnlySql() {
  const query = vi.fn(async (text: string) => {
    if (!/^SELECT (?:\* FROM )?public\.partner_[a-z_]+\(/.test(text)) throw new Error(`Forbidden direct SQL in production: ${text}`);
    const name = /public\.(partner_[a-z_]+)\(/.exec(text)![1];
    if (name === "partner_ops_company_list") return { rowCount: 1, rows: [{ id: company, slug: "one", name: "One", billing_model: "INSULHUB_BILLED", revision: 0, quote_defaults_revision: 0, wall_rate_cents: "9000", ceiling_rate_cents: "6000", deposit_basis_points: 2500, consent_fee_cents: "0", extras: PRODUCT_QUOTE_DEFAULTS.extras }] };
    if (name === "partner_ops_dashboard") return { rowCount: 1, rows: [{ job_id: job, company_id: company, company_name: "One", customer_name: "Fictional Customer", client_reference: "ONE-1", submission_state: "SUBMITTED", billing_model: "INSULHUB_BILLED", latest_milestone: "INSTALL_DATE_SET", settlement_status: null }] };
    if (name === "partner_ops_partner_user_list") return { rowCount: 0, rows: [] };
    if (name === "partner_ops_job_detail") return { rowCount: 1, rows: [{ [name]: { ...trackingFixture, companyId: company, customerName: "Fictional Customer", siteAddress: {}, submissionState: "SUBMITTED", revision: 0 } }] };
    if (name === "partner_partner_tracking_projection") return { rowCount: 1, rows: [{ [name]: trackingFixture }] };
    return { rowCount: 1, rows: [{ [name]: name === "partner_ops_company_create_full" ? company : name === "partner_partner_tracking_projection" ? null : true }] };
  });
  return { sql: { query: query as PartnerSql["query"] }, query };
}

describe("operations production-only boundary", () => {
  it("uses only the approved function interface, including pre-hash account authorization", async () => {
    const { sql, query } = functionOnlySql(), repository = new PartnerOperationsRepository(sql, false);
    await repository.dashboard(actor);
    await repository.listCompanies(actor);
    await repository.jobDetail(actor, job);
    await repository.createCompany(actor, companyInput);
    await repository.updateCompany(actor, company, 0, companyInput);
    await repository.listPartnerUsers(actor, company);
    await repository.createPartnerUser(actor, company, { name: "New Partner", email: "partner@example.test", initialPassword: "Fictional-Passw0rd!" });
    await repository.disablePartnerUser(actor, company, "partner-user");
    await repository.appendFact(actor, company, job, "EBA_COMPLETED", date);
    await repository.appendAmendment(actor, company, job, { description: "Scope confirmed" });
    await repository.upsertInvoice(actor, company, job, { revision: 0, reference: "INV-1", amountCents: 50000, sentAt: date });
    await repository.upsertSettlement(actor, company, job, "INSULHUB_BILLED", { revision: 0, grossCents: 50000, commissionCents: 10000, status: "PENDING" });
    await repository.partnerProjection(company, job, "partner-user");
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(13);
    expect(query.mock.calls.every(([sqlText]) => sqlText.startsWith("SELECT "))).toBe(true);
  });

  it("does not use a different company's billing snapshot for a mismatched job pair", async () => {
    const { sql } = functionOnlySql(), repository = new PartnerOperationsRepository(sql, false);
    expect(await repository.jobBillingModel(actor, "22222222-2222-4222-8222-222222222222", job)).toBeNull();
    expect(await repository.jobBillingModel(actor, company, job)).toBe("INSULHUB_BILLED");
  });

  it("returns the same full company default shape as the demo", async () => {
    const { sql } = functionOnlySql(), repository = new PartnerOperationsRepository(sql, false);
    expect((await repository.listCompanies(actor))[0]).toMatchObject({ quoteDefaults: companyInput.quoteDefaults });
  });

  it("keeps customer, optional milestone dates and absent amendment amounts consistent", async () => {
    const { sql } = functionOnlySql(), production = new PartnerOperationsRepository(sql, false);
    const { Pool } = createPartnerTestDatabase(), pool = new Pool();
    try {
      await pool.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,'one','One','INSULHUB_BILLED')", [company]);
      await pool.query("INSERT INTO partner_users(id,principal_type,name,email,ops_role) VALUES($1,'INTERNAL','Admin','admin@example.test','ADMIN')", [actor.userId]);
      await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email) VALUES('partner-user',$1,'PARTNER','Partner','p@example.test')", [company]);
      await pool.query("INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,customer_name,billing_model_snapshot,submission_state,submission_started_at,submitted_at) VALUES($1,$2,'partner-user','ONE-1','Fictional Customer','INSULHUB_BILLED','SUBMITTED',$3,$3)", [job,company,date]);
      const demo = new PartnerOperationsRepository(pool,true);
      await demo.appendFact(actor,company,job,'EBA_COMPLETED',date);
      await demo.appendFact(actor,company,job,'INSTALL_DATE_SET','2026-09-02T00:00:00Z');
      await demo.appendAmendment(actor,company,job,{description:'Scope confirmed'});
      expect(await demo.dashboard(actor)).toEqual(await production.dashboard(actor));
      const actual = await demo.partnerProjection(company,job,'partner-user');
      const expected = await production.partnerProjection(company,job,'partner-user');
      expect(Object.keys(actual!.milestones.EBA_COMPLETED).sort()).toEqual(Object.keys(expected!.milestones.EBA_COMPLETED).sort());
      expect(Object.keys(actual!.milestones.INSTALL_DATE_SET).sort()).toEqual(Object.keys(expected!.milestones.INSTALL_DATE_SET).sort());
      expect(actual!.amendments[0]).not.toHaveProperty('contractDeltaCents');
      expect(expected!.amendments[0]).not.toHaveProperty('contractDeltaCents');
      expect(actual!.milestones.INSTALL_DATE_SET.installDate).toBe(expected!.milestones.INSTALL_DATE_SET.installDate);
    } finally { await pool.end(); }
  });

  it.each(["OPS_FORBIDDEN", "OPS_CANCELLED", "OPS_TERMINAL", "OPS_JOB_NOT_ACTIONABLE", "OPS_STALE_REVISION", "OPS_INVOICE_REQUIRED", "OPS_DUPLICATE_FACT"])("normalizes only the safe PostgreSQL error token %s", async code => {
    const sql: PartnerSql = { query: async () => { throw Object.assign(new Error(code), { code: "P0001" }); } };
    await expect(new PartnerOperationsRepository(sql, false).appendFact(actor, company, job, "EBA_COMPLETED", date)).rejects.toMatchObject({ code });
  });

  it("keeps production assertion and disposable PostgreSQL gate on the same exact neutral signatures", () => {
    expect([...COMPANY_ACCESS_GATE_SIGNATURES,...NOTIFICATION_SETTINGS_GATE_SIGNATURES,...LINK_GATE_SIGNATURES, ...LIVE_CONNECTION_GATE_SIGNATURES, ...OPS_GATE_SIGNATURES]).toEqual(PARTNER_OPS_FUNCTION_SIGNATURES);
    const gate = readFileSync("scripts/partner-postgres-gate.mjs", "utf8");
    expect(gate).toContain("await probePartnerOperations(pool)");
    expect(gate).toContain("await assertPartnerOperationsRemoved(pool)");
    expect(gate).toContain("opsInitialDown.version === \"007_partner_operations\"");
    expect(gate).toContain("finalOpsUp.version === \"007_partner_operations\"");
    expect(gate).toContain("PARTNER_MIGRATION_TEST_DATABASE_URL is required");
  });
});
