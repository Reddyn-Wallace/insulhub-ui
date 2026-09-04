import { describe, expect, it } from "vitest";
import { EMPTY_LEAD_DRAFT } from "./draft";
import { partnerJobView, PartnerOpsRepository, PartnerRepository, type InternalPrincipal, type PartnerPrincipal } from "./repository";
import { createPartnerTestDatabase } from "./test-db";
import { setQuoteProductEnabled } from "./quote";

async function fixture() {
  const { Pool } = createPartnerTestDatabase();
  const pool = new Pool();
  const a = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('a', 'Company A', 'INSULHUB_BILLED') RETURNING id")).rows[0].id;
  const b = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('b', 'Company B', 'PARTNER_BILLED') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email, ops_role) VALUES ('a1', $1, 'PARTNER', 'A One', 'a1@test', NULL), ('a2', $1, 'PARTNER', 'A Two', 'a2@test', NULL), ('b1', $2, 'PARTNER', 'B One', 'b1@test', NULL), ('ops', NULL, 'INTERNAL', 'Ops', 'ops@test', 'ADMIN')", [a, b]);
  const aJob = (await pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot) VALUES ($1, 'a1', 'a-job', 'INSULHUB_BILLED') RETURNING id", [a])).rows[0].id;
  const bJob = (await pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot) VALUES ($1, 'b1', 'b-job', 'PARTNER_BILLED') RETURNING id", [b])).rows[0].id;
  const drawing = (await pool.query("INSERT INTO partner_site_plan_drawings (company_id, job_id, created_by_user_id) VALUES ($1, $2, 'a1') RETURNING id", [a, aJob])).rows[0].id;
  const aSubmitted = (await pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot, submission_state, submission_started_at, submitted_at) VALUES ($1, 'a1', 'a-submitted', 'INSULHUB_BILLED', 'SUBMITTED', now(), now()) RETURNING id", [a])).rows[0].id;
  return { pool, a, b, aJob, bJob, aSubmitted, drawing };
}

describe("company-scoped partner repositories", () => {
  it("returns the recorded submission date and preserves timestamps on reads", async () => {
    const {pool,a,aSubmitted}=await fixture();
    const repository=new PartnerRepository(pool);
    const principal:PartnerPrincipal={userId:"a1",companyId:a,principalType:"PARTNER"};
    await pool.query("UPDATE partner_jobs SET submission_started_at=$2,submitted_at=$2,updated_at=$3 WHERE id=$1",[aSubmitted,"2026-09-01T00:00:00.000Z","2026-09-02T00:00:00.000Z"]);
    const job=await repository.getJob(principal,aSubmitted);
    expect(partnerJobView(job!)).toMatchObject({submittedAt:"2026-09-01T00:00:00.000Z",updatedAt:"2026-09-02T00:00:00.000Z"});
    expect((await repository.getJob(principal,aSubmitted))?.updatedAt).toBe(job!.updatedAt);
    await pool.end();
  });

  it("exposes stored final references and supports searching them", async () => {
    const { pool, a, aSubmitted } = await fixture();
    const repository = new PartnerRepository(pool);
    const principal: PartnerPrincipal = { userId: "a1", companyId: a, principalType: "PARTNER" };
    await pool.query("UPDATE partner_jobs SET final_quote_number=$2,legacy_job_number=$3 WHERE id=$1", [aSubmitted, "NW-1234", 1234]);
    const job = await repository.getJob(principal, aSubmitted);
    expect(partnerJobView(job!)).toMatchObject({ finalQuoteNumber: "NW-1234", legacyJobNumber: 1234, clientReference: "a-submitted" });
    expect((await repository.listJobs(principal, { search: "nw-1234" })).map(job => job.id)).toEqual([aSubmitted]);
    expect((await repository.listJobs(principal, { search: "1234" })).map(job => job.id)).toEqual([aSubmitted]);
    await pool.end();
  });

  it("enforces zero fees on create/update and old drafts without rewriting historical submitted jobs",async()=>{
    const {pool,a,aJob,aSubmitted}=await fixture();const repository=new PartnerRepository(pool);
    const principal:PartnerPrincipal={userId:"a1",companyId:a,principalType:"PARTNER"};
    const initialized=await repository.getJob(principal,aJob);const quote={...initialized!.quote,consentFeeCents:9900,depositBasisPoints:5000};
    const created=await repository.createDraft(principal,{...EMPTY_LEAD_DRAFT,quote});
    expect(created.quote).toMatchObject({consentFeeCents:0,depositBasisPoints:0});
    const updated=await repository.updateDraft(principal,aJob,0,{...EMPTY_LEAD_DRAFT,quote});
    expect(updated).toMatchObject({outcome:"updated",job:{quote:{consentFeeCents:0,depositBasisPoints:0}}});
    await pool.query("UPDATE partner_jobs SET quote_data=$2::jsonb WHERE id=$1",[aJob,JSON.stringify(quote)]);
    expect((await repository.getJob(principal,aJob))?.quote).toMatchObject({consentFeeCents:0,depositBasisPoints:0});
    await pool.query("UPDATE partner_jobs SET quote_data=$2::jsonb,quote_initialized_at=now(),quote_defaults_revision=$3,quote_defaults_snapshot=$4::jsonb WHERE id=$1",[aSubmitted,JSON.stringify(quote),quote.defaultsSnapshot.revision,JSON.stringify(quote.defaultsSnapshot)]);
    expect((await repository.getJob(principal,aSubmitted))?.quote).toMatchObject({consentFeeCents:9900,depositBasisPoints:5000});
    await pool.end();
  });

  it("shares jobs inside a company and denies cross-company guessed IDs", async () => {
    const { pool, a, b, aJob, bJob } = await fixture();
    const repository = new PartnerRepository(pool);
    const a1: PartnerPrincipal = { userId: "a1", companyId: a, principalType: "PARTNER" };
    const a2: PartnerPrincipal = { userId: "a2", companyId: a, principalType: "PARTNER" };
    const b1: PartnerPrincipal = { userId: "b1", companyId: b, principalType: "PARTNER" };
    expect((await repository.listJobs(a1)).map((job) => job.id)).toContain(aJob);
    expect((await repository.listJobs(a2)).map((job) => job.id)).toContain(aJob);
    expect(await repository.getJob(b1, aJob)).toBeNull();
    expect(await repository.getJob(a1, bJob)).toBeNull();
    await pool.end();
  });

  it("denies nested-resource IDOR even with a real drawing ID", async () => {
    const { pool, a, b, aJob, bJob, drawing } = await fixture();
    const repository = new PartnerRepository(pool);
    expect(await repository.getDrawing({ userId: "a1", companyId: a, principalType: "PARTNER" }, aJob, drawing)).toEqual({ id: drawing, jobId: aJob, revision: 0 });
    expect(await repository.getDrawing({ userId: "b1", companyId: b, principalType: "PARTNER" }, aJob, drawing)).toBeNull();
    expect(await repository.getDrawing({ userId: "a1", companyId: a, principalType: "PARTNER" }, bJob, drawing)).toBeNull();
    await pool.end();
  });

  it("shares draft editing inside a company and enforces optimistic revision", async () => {
    const { pool, a, aJob } = await fixture();
    const repository = new PartnerRepository(pool);
    const a2: PartnerPrincipal = { userId: "a2", companyId: a, principalType: "PARTNER" };
    const first = await repository.updateDraft(a2, aJob, 0, { ...EMPTY_LEAD_DRAFT, customerName: "Shared Company Draft" });
    expect(first).toMatchObject({ outcome: "updated", job: { customerName: "Shared Company Draft", revision: 1 } });
    expect(await repository.updateDraft(a2, aJob, 0, EMPTY_LEAD_DRAFT)).toEqual({ outcome: "stale", currentRevision: 1 });
    await pool.end();
  });

  it("denies guessed cross-company updates and all non-draft mutations", async () => {
    const { pool, a, b, aJob, aSubmitted } = await fixture();
    const repository = new PartnerRepository(pool);
    const b1: PartnerPrincipal = { userId: "b1", companyId: b, principalType: "PARTNER" };
    const a1: PartnerPrincipal = { userId: "a1", companyId: a, principalType: "PARTNER" };
    expect(await repository.updateDraft(b1, aJob, 0, EMPTY_LEAD_DRAFT)).toEqual({ outcome: "not_found" });
    expect(await repository.updateDraft(a1, aSubmitted, 0, EMPTY_LEAD_DRAFT)).toEqual({ outcome: "not_draft" });
    await pool.end();
  });

  it("keeps internal operations behind a separate principal type", async () => {
    const { pool, a } = await fixture();
    const repository = new PartnerOpsRepository(pool);
    const internal: InternalPrincipal = { userId: "ops", companyId: null, principalType: "INTERNAL" };
    expect(await repository.listCompanies(internal)).toHaveLength(2);
    const forged = { userId: "a1", companyId: a, principalType: "PARTNER" } as unknown as InternalPrincipal;
    expect(await repository.listCompanies(forged)).toEqual([]);
    await pool.end();
  });

  it("initializes company defaults once and snapshots them against later changes", async () => {
    const { pool, a, aJob } = await fixture();
    await pool.query("UPDATE partner_companies SET quote_default_wall_rate_cents = 15000, quote_defaults_revision = 4 WHERE id = $1", [a]);
    const repository = new PartnerRepository(pool);
    const principal: PartnerPrincipal = { userId: "a1", companyId: a, principalType: "PARTNER" };
    const first = await repository.getJob(principal, aJob);
    expect(first?.quote.defaultsSnapshot).toMatchObject({ wallRateCents: 15000, revision: 4 });
    await pool.query("UPDATE partner_companies SET quote_default_wall_rate_cents = 19000, quote_defaults_revision = 5 WHERE id = $1", [a]);
    const again = await repository.getJob(principal, aJob);
    expect(again?.quote.defaultsSnapshot).toMatchObject({ wallRateCents: 15000, revision: 4 });
    await pool.end();
  });

  it("initializes every list result before exposure and never re-reads changed defaults", async () => {
    const { pool, a, aJob } = await fixture();
    await pool.query("UPDATE partner_companies SET quote_default_wall_rate_cents = 15100, quote_defaults_revision = 6 WHERE id = $1", [a]);
    const repository = new PartnerRepository(pool);
    const principal: PartnerPrincipal = { userId: "a1", companyId: a, principalType: "PARTNER" };
    const first = await repository.listJobs(principal);
    expect(first.find((job) => job.id === aJob)?.quote.defaultsSnapshot).toMatchObject({ wallRateCents: 15100, revision: 6 });
    expect((await pool.query("SELECT count(*)::int AS count FROM partner_jobs WHERE company_id = $1 AND submission_state = 'DRAFT' AND quote_data IS NULL", [a])).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM partner_jobs WHERE company_id = $1 AND submission_state <> 'DRAFT' AND quote_data IS NULL", [a])).rows[0].count).toBe(1);
    await pool.query("UPDATE partner_companies SET quote_default_wall_rate_cents = 19900, quote_defaults_revision = 7 WHERE id = $1", [a]);
    const again = await repository.listJobs(principal);
    expect(again.find((job) => job.id === aJob)?.quote.defaultsSnapshot).toMatchObject({ wallRateCents: 15100, revision: 6 });
    await pool.end();
  });

  it("converges concurrent first reads on one immutable defaults snapshot", async () => {
    const { pool, a, aJob } = await fixture();
    await pool.query("UPDATE partner_companies SET quote_default_wall_rate_cents = 16300, quote_defaults_revision = 8 WHERE id = $1", [a]);
    const repository = new PartnerRepository(pool);
    const principal: PartnerPrincipal = { userId: "a1", companyId: a, principalType: "PARTNER" };
    const [left, right] = await Promise.all([repository.getJob(principal, aJob), repository.getJob(principal, aJob)]);
    expect(left?.quote.defaultsSnapshot).toEqual(right?.quote.defaultsSnapshot);
    expect(left?.quote.defaultsSnapshot).toMatchObject({ wallRateCents: 16300, revision: 8 });
    expect((await pool.query("SELECT quote_defaults_revision FROM partner_jobs WHERE id = $1", [aJob])).rows[0].quote_defaults_revision).toBe(8);
    await pool.end();
  });

  it("recalculates authoritative totals for a same-company quote update", async () => {
    const { pool, a, aJob } = await fixture();
    await pool.query("UPDATE partner_companies SET quote_default_wall_rate_cents = 10000 WHERE id = $1", [a]);
    const repository = new PartnerRepository(pool);
    const principal: PartnerPrincipal = { userId: "a2", companyId: a, principalType: "PARTNER" };
    const initialized = await repository.getJob(principal, aJob);
    let quote = setQuoteProductEnabled(initialized!.quote, "wall", true);
    quote = { ...quote, wall: { ...quote.wall, rateCentsPerSqm: 10_000, areaSqm: 10, cavityDepthCm: 10 } };
    const updated = await repository.updateDraft(principal, aJob, 0, { ...EMPTY_LEAD_DRAFT, quote });
    expect(updated).toMatchObject({ outcome: "updated", job: { quoteCalculation: { contractCents: 133000, gstCents: 19950, totalCents: 152950 } } });
    expect((await pool.query("SELECT quote_total_cents FROM partner_jobs WHERE id = $1", [aJob])).rows[0].quote_total_cents).toBe(152950);
    await pool.end();
  });
});
