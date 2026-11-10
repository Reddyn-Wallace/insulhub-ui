import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/overlay-db", () => ({
  overlaySql: async (s: TemplateStringsArray, ...v: unknown[]) => {
    let q = s[0];
    v.forEach((_, i) => (q += `$${i + 1}${s[i + 1]}`));
    return (await state.pool!.query(q, v)).rows;
  },
}));
import {
  createReport,
  getReport,
  saveCommentary,
  startRefresh,
  publishRefresh,
  cancelRefresh,
  finaliseReport,
  readSettings,
  saveSettings,
} from "./store";
import { buildSnapshot } from "./model";
const url = process.env.GM_REPORT_TEST_DATABASE_URL || process.env.INSTALLATION_SPLITS_TEST_DATABASE_URL;
const settings = {
  wallBagCost: 100,
  ceilingBagCost: 200,
  weeklyWages: 10000,
  weeklyOpex: 5000,
  profitBudget: 0,
  salesSqmBudget: 400,
  councilAliases: [],
};
describe.skipIf(!url)("GM snapshot PostgreSQL lifecycle", () => {
  beforeAll(async () => {
    if (
      !url ||
      new URL(url).hostname !== "127.0.0.1" ||
      new URL(url).port !== "55687" ||
      new URL(url).pathname !== "/crm_tests"
    )
      throw Error("Disposable local database only");
    const setup = new Pool({ connectionString: url });
    await setup.query("CREATE SCHEMA IF NOT EXISTS gm_report_test");
    await setup.end();
    state.pool = new Pool({
      connectionString: url,
      options: "-c search_path=gm_report_test",
    });
    const sql = readFileSync("scripts/gm-report-schema.sql", "utf8");
    await state.pool.query(sql);
    await state.pool.query(sql);
    await state.pool.query(
      "TRUNCATE gm_report_events,gm_reports,gm_report_settings",
    );
  });
  afterAll(async () => {
    await state.pool?.end();
  });
  it("requires explicit initial settings and protects concurrent settings writes", async () => {
    expect(await readSettings()).toBeNull();
    expect((await saveSettings(settings, 0, "admin")).revision).toBe(1);
    await expect(saveSettings(settings, 0, "admin")).rejects.toMatchObject({
      status: 409,
    });
  });
  it("creates one weekly draft and preserves independently saved commentary through refresh", async () => {
    const [a, b] = await Promise.all([
      createReport("2026-11-09", "admin"),
      createReport("2026-11-09", "admin"),
    ]);
    expect(a.week).toBe(b.week);
    const lease = await startRefresh(a.week, "admin");
    const saved = await saveCommentary(
      a.week,
      { profit: "Good week", upcoming: "", pipeline: "" },
      a.revision,
      "admin",
    );
    const snapshot = buildSnapshot(a.week, [], {}, [], settings);
    const updated = await publishRefresh(a.week, lease, snapshot, "admin");
    expect(updated.commentary.profit).toBe("Good week");
    expect(updated.revision).toBe(saved.revision + 1);
  });
  it("rejects stale commentary writes rather than silently replacing another GM edit", async () => {
    const r = (await getReport("2026-11-09"))!;
    await saveCommentary(
      r.week,
      { profit: "Edited", upcoming: "", pipeline: "" },
      r.revision,
      "admin",
    );
    await expect(
      saveCommentary(r.week, r.commentary, r.revision, "other"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps last successful snapshot after refresh failure, recovers leases and prevents concurrent refresh", async () => {
    const r = (await getReport("2026-11-09"))!;
    const lease = await startRefresh(r.week, "admin");
    await expect(startRefresh(r.week, "other")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      finaliseReport(r.week, r.revision, "admin"),
    ).rejects.toMatchObject({ status: 409 });
    await cancelRefresh(r.week, lease);
    expect((await getReport(r.week))!.snapshot).toEqual(r.snapshot);
  });
  it("rejects incomplete data and permanently locks finalised reports including late refresh/saves", async () => {
    let r = (await getReport("2026-11-09"))!;
    const lease = await startRefresh(r.week, "admin");
    const snapshot = { ...r.snapshot!, issues: ["Missing actual bag usage"] };
    r = await publishRefresh(r.week, lease, snapshot, "admin");
    await expect(
      finaliseReport(r.week, r.revision, "admin"),
    ).rejects.toMatchObject({ status: 400 });
    const next = await startRefresh(r.week, "admin");
    r = await publishRefresh(
      r.week,
      next,
      buildSnapshot(r.week, [], {}, [], settings),
      "admin",
    );
    r = await finaliseReport(r.week, r.revision, "admin");
    expect(r.status).toBe("finalised");
    expect((await finaliseReport(r.week, r.revision, "admin")).status).toBe(
      "finalised",
    );
    await expect(
      saveCommentary(r.week, r.commentary, r.revision, "admin"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(startRefresh(r.week, "admin")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      publishRefresh(r.week, next, r.snapshot!, "admin"),
    ).rejects.toMatchObject({ status: 409 });
  });
});
