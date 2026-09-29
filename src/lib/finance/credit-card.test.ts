import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getCreditCardSnapshot } from "./akahu";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function source(current: number) {
  vi.stubEnv("AKAHU_CREDIT_CARD_ACCOUNT_ID", "card");
  vi.stubEnv("AKAHU_APP_TOKEN", "app");
  vi.stubEnv("AKAHU_USER_TOKEN", "user");
  const item = {
    _id: "card",
    name: "Visa Business",
    status: "ACTIVE",
    type: "CREDITCARD",
    balance: { currency: "NZD", current, available: 6414.7, limit: 10000 },
    refreshed: { balance: "2026-09-29T06:47:00Z" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ success: true, item })),
  );
  return item;
}
it("uses outstanding debt, not available credit or credit limit", async () => {
  source(-3585.3);
  const d = await getCreditCardSnapshot();
  expect(d.owedCents).toBe(358530);
  expect(d.creditCents).toBe(0);
  expect(d.balanceUpdatedAt).toBe("2026-09-29T06:47:00Z");
});
it("distinguishes an actual credit balance from an amount owed", async () => {
  source(123.45);
  const d = await getCreditCardSnapshot();
  expect(d.owedCents).toBe(0);
  expect(d.creditCents).toBe(12345);
});
it("rejects wrong accounts and unknown balance or update time rather than using zero", async () => {
  const item = source(-1);
  item.type = "CHECKING";
  await expect(getCreditCardSnapshot()).rejects.toThrow();
  item.type = "CREDITCARD";
  item.balance.current = NaN;
  await expect(getCreditCardSnapshot()).rejects.toThrow();
  item.balance.current = -1;
  item.refreshed.balance = "";
  await expect(getCreditCardSnapshot()).rejects.toThrow();
});
