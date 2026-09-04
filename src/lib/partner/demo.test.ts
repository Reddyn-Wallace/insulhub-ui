import { afterAll, describe, expect, it } from "vitest";
import { getPartnerDemoPool, PARTNER_DEMO_CONFIRMATION, partnerDemoModeEnabled } from "./demo";
import { PartnerRepository } from "./repository";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";

const originalMode = process.env.PARTNER_DEMO_MODE;
const originalConfirm = process.env.PARTNER_DEMO_CONFIRM;
const originalOrigin = process.env.PARTNER_APP_ORIGIN;

afterAll(() => {
  if (originalMode === undefined) delete process.env.PARTNER_DEMO_MODE; else process.env.PARTNER_DEMO_MODE = originalMode;
  if (originalConfirm === undefined) delete process.env.PARTNER_DEMO_CONFIRM; else process.env.PARTNER_DEMO_CONFIRM = originalConfirm;
  if (originalOrigin === undefined) delete process.env.PARTNER_APP_ORIGIN; else process.env.PARTNER_APP_ORIGIN = originalOrigin;
});

describe("partner demo mode", () => {
  it("is explicit and fails closed in production or without confirmation", () => {
    expect(partnerDemoModeEnabled({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(() => partnerDemoModeEnabled({ NODE_ENV: "production", PARTNER_DEMO_MODE: "true", PARTNER_DEMO_CONFIRM: PARTNER_DEMO_CONFIRMATION } as NodeJS.ProcessEnv)).toThrow("forbidden in production");
    expect(() => partnerDemoModeEnabled({ NODE_ENV: "test", PARTNER_DEMO_MODE: "true" } as NodeJS.ProcessEnv)).toThrow("PARTNER_DEMO_CONFIRM");
    const confirmed = { NODE_ENV: "test", PARTNER_DEMO_MODE: "true", PARTNER_DEMO_CONFIRM: PARTNER_DEMO_CONFIRMATION } as NodeJS.ProcessEnv;
    expect(() => partnerDemoModeEnabled(confirmed)).toThrow("PARTNER_APP_ORIGIN is required");
    for (const origin of ["https://portal.example.com", "https://staging.example.test", "ftp://localhost:3000", "http://localhost:3000/path", "http://user:pass@localhost:3000"]) {
      expect(() => partnerDemoModeEnabled({ ...confirmed, PARTNER_APP_ORIGIN: origin })).toThrow("loopback origin");
    }
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "https://[::1]:3000"]) {
      expect(partnerDemoModeEnabled({ ...confirmed, PARTNER_APP_ORIGIN: origin })).toBe(true);
    }
  });

  it("seeds deterministic fictional tenants without mixing their jobs", async () => {
    process.env.PARTNER_DEMO_MODE = "true";
    process.env.PARTNER_DEMO_CONFIRM = PARTNER_DEMO_CONFIRMATION;
    process.env.PARTNER_APP_ORIGIN = "http://127.0.0.1:3000";
    const pool = getPartnerDemoPool();
    const repository = new PartnerRepository(pool);
    const northwind = await repository.listJobs({ userId: "demo-partner-northwind", companyId: "11111111-1111-4111-8111-111111111111", principalType: "PARTNER" });
    const harbour = await repository.listJobs({ userId: "demo-partner-harbour", companyId: "22222222-2222-4222-8222-222222222222", principalType: "PARTNER" });
    expect(northwind).toHaveLength(5);
    expect(harbour).toHaveLength(2);
    expect(northwind.every((job) => job.clientReference.startsWith("NW-"))).toBe(true);
    expect(harbour.every((job) => job.clientReference.startsWith("HT-"))).toBe(true);
    expect(northwind.find((job)=>job.clientReference==="NW-2026-READY")).toMatchObject({submissionState:"DRAFT",customerName:"Anika Rangi"});
    const pdfs=await pool.query<{pdf_bytes:Buffer;byte_size:number|string;content_sha256:string;renderer_version:string;template_sha256:string}>("SELECT a.pdf_bytes,a.byte_size,a.content_sha256,a.renderer_version,a.template_sha256 FROM partner_site_plan_drawings d JOIN partner_site_plan_pdf_artifacts a ON a.id=d.current_pdf_artifact_id WHERE d.job_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5' ORDER BY d.sort_order");expect(pdfs.rowCount).toBe(2);for(const artifact of pdfs.rows){const bytes=Buffer.from(artifact.pdf_bytes);expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);expect(Number(artifact.byte_size)).toBe(bytes.byteLength);expect(artifact.content_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));expect(artifact.renderer_version).toMatch(/^partner-site-plan-/);expect(artifact.template_sha256).toMatch(/^[0-9a-f]{64}$/);}
    const northwindDefaults = await repository.getQuoteDefaults({ userId: "demo-partner-northwind", companyId: "11111111-1111-4111-8111-111111111111", principalType: "PARTNER" });
    const harbourDefaults = await repository.getQuoteDefaults({ userId: "demo-partner-harbour", companyId: "22222222-2222-4222-8222-222222222222", principalType: "PARTNER" });
    expect(northwindDefaults).toMatchObject({ wallRateCents: 15500, ceilingRateCents: 13200, depositBasisPoints: 2500, revision: 1 });
    expect(harbourDefaults).toMatchObject({ wallRateCents: 16900, ceilingRateCents: 14500, depositBasisPoints: 3000, consentFeeCents: 2500, revision: 1 });
    const actor = (await pool.query("SELECT principal_type, company_id FROM partner_users WHERE id = 'demo-internal-operator'")).rows[0];
    expect(actor).toEqual({ principal_type: "INTERNAL", company_id: null });
    expect((await pool.query("SELECT recorded_by_user_id FROM partner_tracking_facts WHERE source = 'LOCAL_INTERNAL'")).rows[0].recorded_by_user_id).toBe("demo-internal-operator");
  });
});
