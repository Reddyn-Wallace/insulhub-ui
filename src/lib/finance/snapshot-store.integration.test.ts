import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("server-only", () => ({}));
import { financePool } from "./connection-store";
import { readSnapshot, writeSnapshot } from "./snapshot-store";
const db = process.env.FINANCE_TEST_DATABASE_URL;
describe.skipIf(!db)("encrypted shared finance snapshots", () => {
  beforeAll(async () => {
    if (!db?.includes("127.0.0.1"))
      throw Error("Disposable local database required");
    vi.stubEnv("FINANCE_DATABASE_URL", db);
    vi.stubEnv(
      "FINANCE_ENCRYPTION_KEY",
      Buffer.alloc(32, 5).toString("base64"),
    );
    await financePool().query(
      await readFile("scripts/finance-snapshots-schema.sql", "utf8"),
    );
  });
  afterAll(async () => {
    await financePool().end();
  });
  it("encrypts payloads, isolates owners and modes, and refuses expired data", async () => {
    const input = {
      checkedAt: new Date().toISOString(),
      invoices: [{ contact: "Private customer" }],
    } as never;
    await writeSnapshot("snapshot-test", "overview", input);
    expect(await readSnapshot("snapshot-test", "overview")).toEqual(input);
    expect(await readSnapshot("other-owner", "overview")).toBeNull();
    expect(await readSnapshot("snapshot-test", "bank")).toBeNull();
    const r = await financePool().query(
      "SELECT payload FROM finance_snapshots WHERE owner_id=$1",
      ["snapshot-test"],
    );
    expect(r.rows[0].payload).not.toContain("Private customer");
    await financePool().query(
      "UPDATE finance_snapshots SET expires_at=now()-interval '1 second' WHERE owner_id=$1",
      ["snapshot-test"],
    );
    expect(await readSnapshot("snapshot-test", "overview")).toBeNull();
  });
});
