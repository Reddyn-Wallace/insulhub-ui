import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPartnerDemoPool, readPartnerDemoPdfBytes, resetPartnerDemoStorage } from "./demo";
import { PartnerSitePlanRepository } from "./site-plan-repository";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import type { PartnerPrincipal } from "./repository";

const principal: PartnerPrincipal = { userId: "demo-partner-northwind", companyId: "11111111-1111-4111-8111-111111111111", principalType: "PARTNER" };
const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
beforeEach(() => {
  vi.stubEnv("PARTNER_DEMO_MODE", "true"); vi.stubEnv("PARTNER_DEMO_CONFIRM", "LOCAL_FICTIONAL_DATA_ONLY"); vi.stubEnv("PARTNER_APP_ORIGIN", "http://127.0.0.1:3000");
});
afterEach(async () => { await resetPartnerDemoStorage(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function completedFloor() {
  const pool = getPartnerDemoPool(), repository = new PartnerSitePlanRepository(pool);
  const collection = (await repository.list(principal, jobId))!;
  const created = await repository.create(principal, jobId, collection.revision, "Delete regression", { ...EMPTY_SITE_PLAN_DOCUMENT, walls: [{ id: "wall", start: { x: 1, y: 1 }, end: { x: 4, y: 1 }, style: "solid" }] });
  if (created.outcome !== "updated") throw new Error("Fixture creation failed");
  const id = created.collection.floors.at(-1)!.id;
  const bytes = Buffer.from("%PDF-completed-delete-test");
  const floor = (await repository.publish(principal, jobId, id, (await repository.renderSnapshot(principal, jobId, id))!, { bytes, contentSha256: createHash("sha256").update(bytes).digest("hex") }, "Floor.pdf"))!;
  return { pool, repository, floor, revision: created.collection.revision, bytes };
}

describe("completed floor deletion in the real local demo adapter", () => {
  it("deletes a completed floor and its PDF, keeps other floors and increments collection revision", async () => {
    const { pool, repository, floor, revision } = await completedFloor();
    expect(floor.pdfReady).toBe(true);
    const before = (await repository.list(principal, jobId))!;
    const result = await repository.remove(principal, jobId, floor.id, revision);
    expect(result).toMatchObject({ outcome: "updated", collection: { revision: revision + 1 } });
    if (result.outcome !== "updated") throw new Error("Delete failed");
    expect(result.collection.floors.map(item => item.id)).toEqual(before.floors.filter(item => item.id !== floor.id).map(item => item.id));
    expect(await repository.get(principal, jobId, floor.id)).toBeNull();
    expect((await pool.query("SELECT id FROM partner_site_plan_pdf_artifacts WHERE drawing_id=$1", [floor.id])).rowCount).toBe(0);
    expect(readPartnerDemoPdfBytes(floor.currentPdf!.artifactId)).toBeNull();
  });

  it("preserves completed bytes for stale, cross-company and submitted deletion attempts", async () => {
    const { pool, repository, floor, revision, bytes } = await completedFloor();
    expect(await repository.remove(principal, jobId, floor.id, revision - 1)).toMatchObject({ outcome: "stale" });
    expect(await repository.remove({ ...principal, companyId: "22222222-2222-4222-8222-222222222222" }, jobId, floor.id, revision)).toEqual({ outcome: "not_found" });
    await pool.query("UPDATE partner_jobs SET submission_state='QUEUED',submission_started_at=now() WHERE id=$1", [jobId]);
    expect(await repository.remove(principal, jobId, floor.id, revision)).toEqual({ outcome: "not_draft" });
    expect(readPartnerDemoPdfBytes(floor.currentPdf!.artifactId)).toEqual(bytes);
  });

  it("rolls back drawing, PDF, bytes and collection revision when deletion fails late", async () => {
    const { pool, repository, floor, revision, bytes } = await completedFloor();
    const before = await repository.list(principal, jobId);
    const failingPool = new Proxy(pool, { get(target, key) {
      if (key === "connect") return async () => {
        const client = await target.connect();
        return new Proxy(client, { get(connection, member) {
          if (member === "query") return (sql: string, values: unknown[]) => {
            if (sql.startsWith("UPDATE partner_jobs SET floor_plan_revision")) throw new Error("Injected late failure");
            return connection.query(sql, values);
          };
          const value = Reflect.get(connection, member); return typeof value === "function" ? value.bind(connection) : value;
        } });
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(new PartnerSitePlanRepository(failingPool).remove(principal, jobId, floor.id, revision)).rejects.toThrow("Injected late failure");
    expect(await repository.list(principal, jobId)).toEqual(before);
    expect(await repository.download(principal, jobId, floor.id)).not.toBeNull();
    expect(readPartnerDemoPdfBytes(floor.currentPdf!.artifactId)).toEqual(bytes);
  });
});
