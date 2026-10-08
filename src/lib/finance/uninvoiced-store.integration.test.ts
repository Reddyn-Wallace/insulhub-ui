import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("server-only", () => ({}));
import { financePool } from "./connection-store";
import { trackUninvoicedJobs, trackedUninvoicedJobs } from "./uninvoiced-store";
const db = process.env.FINANCE_TEST_DATABASE_URL;
describe.skipIf(!db)("durable uninvoiced discovery", () => {
  beforeAll(async () => {
    if (!db?.includes("127.0.0.1")) throw Error("Local database required");
    vi.stubEnv("FINANCE_DATABASE_URL", db);
    await financePool().query(
      await readFile("scripts/finance-uninvoiced-schema.sql", "utf8"),
    );
  });
  afterAll(async () => {
    await financePool().end();
  });
  it("persists unique jobs independently for each owner without expiring older captures", async () => {
    const owner = "unbilled-" + Date.now();
    await trackUninvoicedJobs(owner, ["a", "a", "b"]);
    await trackUninvoicedJobs(owner, ["b"]);
    await financePool().query(
      "UPDATE finance_uninvoiced_jobs SET first_seen_at=now()-interval '40 days' WHERE owner_id=$1",
      [owner],
    );
    expect((await trackedUninvoicedJobs(owner)).sort()).toEqual(["a", "b"]);
    expect(await trackedUninvoicedJobs(owner + "other")).toEqual([]);
  });
});
