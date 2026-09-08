import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const storage = vi.hoisted(() => ({ query: null as unknown as (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }));
vi.mock("@/lib/insulhub-auth", () => ({ requireInsulhubAuth: async () => null }));
vi.mock("@/lib/overlay-db", () => ({
  ensureOverlaySchema: async () => {},
  overlaySql: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
    return (await storage.query(text, values)).rows;
  },
}));
import { PUT } from "@/app/api/install-planning/route";
beforeEach(() => {
  const db = newDb();
  const schema = readFileSync("src/lib/overlay-db.ts", "utf8").match(/CREATE TABLE IF NOT EXISTS job_install_planning \([\s\S]*?\n    \)/)![0];
  db.public.none(schema.replace("id uuid PRIMARY KEY DEFAULT gen_random_uuid()", "id serial PRIMARY KEY"));
  const pool = new (db.adapters.createPg().Pool)();
  storage.query = (text, values) => pool.query(text, values);
});
async function save(input: Record<string, unknown>) {
  const response = await PUT(new NextRequest("http://localhost/api/install-planning", { method: "PUT", body: JSON.stringify({ jobId: "job", ...input }) }));
  expect(response.status).toBe(200);
  return (await response.json()).planning;
}
it("saves parking, preserves it through scheduling edits, and allows clearing", async () => {
  const initial = await save({ accessNotes: "Side gate", parkingNotes: " Driveway ", status: "pencilled" });
  expect(initial.parkingNotes).toBe("Driveway");
  expect(await save({ status: "confirmed", planningNote: "Booked" })).toMatchObject({ accessNotes: "Side gate", parkingNotes: "Driveway", status: "confirmed" });
  const stored = await storage.query("SELECT parking_notes FROM job_install_planning WHERE insulhub_job_id = $1", ["job"]);
  expect(stored.rows[0].parking_notes).toBe("Driveway");
  expect((await save({ parkingNotes: "" })).parkingNotes).toBe("");
});
