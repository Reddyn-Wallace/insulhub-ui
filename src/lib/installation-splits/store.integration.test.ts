import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/overlay-db", () => ({
  overlaySql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let sql = strings[0];
    for (let i = 0; i < values.length; i++) sql += `$${i + 1}${strings[i + 1]}`;
    return (await state.pool!.query(sql, values)).rows;
  },
}));
import { readSplits, readPendingSplits, saveSplit } from "./store";
import { initialSplit } from "./projection";
import { completeVisit } from "./model";
const url = process.env.INSTALLATION_SPLITS_TEST_DATABASE_URL;
describe.skipIf(!url)("installation split PostgreSQL persistence", () => {
  beforeAll(async () => {
    if (
      !url ||
      new URL(url).hostname !== "127.0.0.1" ||
      new URL(url).port !== "55687" ||
      new URL(url).pathname !== "/crm_tests"
    )
      throw Error("Dedicated local test database only");
    const setup = new Pool({ connectionString: url });
    await setup.query("CREATE SCHEMA IF NOT EXISTS installation_splits_test");
    await setup.end();
    state.pool = new Pool({
      connectionString: url,
      options: "-c search_path=installation_splits_test",
    });
    const schema = readFileSync(
      "scripts/installation-splits-schema.sql",
      "utf8",
    );
    await state.pool.query(schema);
    await state.pool.query(schema);
    await state.pool.query(
      "TRUNCATE job_installation_split_events,job_installation_splits",
    );
  });
  afterAll(async () => {
    await state.pool?.end();
  });
  it("saves and reads real visits and audits each committed revision once", async () => {
    const base = initialSplit({
      _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      stage: "INSTALLATION",
      quote: { c_total: 10000, wall: { SQM: 200, c_bagCount: 30 } },
      installation: { installDate: "2026-11-06T00:00:00Z" },
    });
    const next = {
      ...base,
      ...completeVisit(base, "initial", 60, "2026-11-10"),
    };
    const saved = await saveSplit(next, 0, "staff", { action: "complete" });
    expect(saved.version).toBe(1);
    expect(
      (await readSplits([base.id]))[base.id].visits.map((v) => v.percent),
    ).toEqual([60, 40]);
    await expect(saveSplit(next, 0, "staff", {})).rejects.toMatchObject({
      status: 409,
    });
    const results = await Promise.allSettled([
      saveSplit(saved, 1, "staff", { action: "one" }),
      saveSplit(saved, 1, "other", { action: "two" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await readSplits())[base.id].version).toBe(2);
    const events = await state.pool!.query(
      "SELECT * FROM job_installation_split_events ORDER BY version",
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0].payload.visits[0].percent).toBe(60);
  });
  it("rolls back the document if the audit write fails", async () => {
    const split = (await readSplits())["aaaaaaaaaaaaaaaaaaaaaaaa"];
    await expect(
      saveSplit(split, 2, null as unknown as string, {}),
    ).rejects.toThrow();
    expect((await readSplits())[split.id].version).toBe(2);
  });
  it("finds only split records with remaining planned work",async()=>{
    const base=initialSplit({_id:"cccccccccccccccccccccccc",quote:{c_total:100,wall:{SQM:10}},installation:{installDate:"2026-11-06"}});
    const saved=await saveSplit(base,0,"staff",{action:"test"});
    expect((await readPendingSplits())[base.id]).toBeTruthy();
    await saveSplit({...saved,visits:[{...saved.visits[0],state:"completed"}]},saved.version,"staff",{action:"test"});
    expect((await readPendingSplits())[base.id]).toBeUndefined();
  });

});
