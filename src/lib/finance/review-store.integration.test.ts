import { beforeAll, afterAll, expect, it, vi, describe } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
import { financePool } from "./connection-store";
import {
  saveReviewDecision,
  listReviewDecisions,
  reviewHistory,
} from "./review-store";
import { decisionFingerprint } from "./review-validation";
import type { FinanceInputs } from "./model";
const url = process.env.FINANCE_TEST_DATABASE_URL;
describe.skipIf(!url)(
  "review concurrency against disposable local PostgreSQL",
  () => {
    beforeAll(async () => {
      if (!url || new URL(url).hostname !== "127.0.0.1")
        throw Error("Local test database required");
      vi.stubEnv("FINANCE_DATABASE_URL", url);
      await financePool().query(
        readFileSync("scripts/finance-review-schema.sql", "utf8"),
      );
    });
    afterAll(async () => {
      await financePool().query(
        "DELETE FROM finance_review_events WHERE owner_id='review-test'",
      );
      await financePool().query(
        "DELETE FROM finance_review_decisions WHERE owner_id='review-test'",
      );
      await financePool().end();
    });
    it("rejects concurrent stale revisions and preserves undo history", async () => {
      const d = {
        receipts: [
          {
            id: "r",
            amount: 100,
            date: "2026-09-27",
            description: "Transfer",
            reference: "",
          },
        ],
        invoices: [],
        jobs: [],
        payments: [],
      } as unknown as FinanceInputs;
      const body = {
        key: "receipt:r",
        revision: 0,
        fingerprint: decisionFingerprint(d, "receipt:r"),
        value: {
          kind: "receipt" as const,
          receiptId: "r",
          nonCustomer: true,
          allocations: [],
          reason: "Owner transfer",
        },
      };
      const results = await Promise.allSettled([
        saveReviewDecision("review-test", d, body),
        saveReviewDecision("review-test", d, body),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await listReviewDecisions("review-test"))[0].revision).toBe(1);
      await saveReviewDecision("review-test", d, {
        ...body,
        revision: 1,
        value: null,
      });
      expect((await listReviewDecisions("review-test"))[0].value).toBeNull();
      expect(await reviewHistory("review-test")).toHaveLength(2);
    });
  },
);
