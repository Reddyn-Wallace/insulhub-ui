import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getPendingBankTransactions } from "./akahu";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("reads pending entries only for selected Trading Account without inventing transaction IDs", async () => {
  vi.stubEnv("AKAHU_ACCOUNT_ID", "trading");
  vi.stubEnv("AKAHU_APP_TOKEN", "app");
  vi.stubEnv("AKAHU_USER_TOKEN", "user");
  const payment = {
    _account: "trading",
    amount: 3338.25,
    date: "2026-09-28T20:44:29Z",
    description: "Da Silva K Inv 0445 Kdasilva",
    updated_at: "2026-09-29T09:26:41Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        success: true,
        items: [payment, { ...payment, _account: "other", amount: 999 }],
      }),
    ),
  );
  const result = await getPendingBankTransactions();
  expect(result.receipts).toHaveLength(1);
  expect(result.receipts[0]).toEqual({
    amount: 333825,
    date: payment.date,
    description: payment.description,
    updatedAt: payment.updated_at,
  });
  payment.updated_at = "";
  await expect(getPendingBankTransactions()).rejects.toThrow();
});
