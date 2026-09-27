import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validateFinanceDatabaseUrl } from "./connection-store";
it("refuses transaction-pooled Neon URLs because refresh uses session locks", () => {
  expect(() =>
    validateFinanceDatabaseUrl(
      "postgresql://user:pass@ep-test-pooler.ap-southeast-2.aws.neon.tech/db",
    ),
  ).toThrow("direct");
  expect(
    validateFinanceDatabaseUrl(
      "postgresql://user:pass@ep-test.ap-southeast-2.aws.neon.tech/db",
    ),
  ).toContain("ep-test.");
});
