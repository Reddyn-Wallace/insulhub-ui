import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  owner: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  list: vi.fn(),
  select: vi.fn(),
}));
vi.mock("./access", () => ({ requireFinanceOwner: m.owner }));
vi.mock("./xero-oauth", () => ({
  startXeroConnection: m.start,
  finishXeroConnection: m.finish,
  listXeroOrganisations: m.list,
  selectXeroOrganisation: m.select,
  XERO_COOKIE: "insulhub_finance_xero",
  XERO_CALLBACK: "/api/finance/xero/callback",
}));
import { POST as connect } from "../../app/api/finance/xero/connect/route";
import { GET as callback } from "../../app/api/finance/xero/callback/route";
import { POST as select } from "../../app/api/finance/xero/organisation/route";
import { FinanceError } from "./errors";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FINANCE_APP_ORIGIN", "https://insulhub-ui.vercel.app");
  m.owner.mockResolvedValue({ userId: "owner", token: "session" });
  m.start.mockResolvedValue({
    state: "a".repeat(43),
    url: "https://login.xero.com/identity/connect/authorize",
  });
});
it("sets a secure HttpOnly callback-only cookie after owner check", async () => {
  const r = await connect(
    new NextRequest("https://insulhub-ui.vercel.app/api/finance/xero/connect", {
      method: "POST",
    }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("set-cookie")).toContain("HttpOnly");
  expect(r.headers.get("set-cookie")).toContain("Secure");
  expect(r.headers.get("cache-control")).toContain("no-store");
});
it("denies other users before authorisation and selection", async () => {
  m.owner.mockRejectedValue(new FinanceError(403, "Restricted"));
  expect(
    (await connect(new NextRequest("https://example.nz", { method: "POST" })))
      .status,
  ).toBe(403);
  expect(
    (
      await select(
        new NextRequest("https://example.nz", {
          method: "POST",
          body: '{"tenantId":"x"}',
        }),
      )
    ).status,
  ).toBe(403);
  expect(m.start).not.toHaveBeenCalled();
  expect(m.select).not.toHaveBeenCalled();
});
it("does not exchange tokens on denied consent and clears state cookie", async () => {
  const r = await callback(
    new NextRequest(
      "https://insulhub-ui.vercel.app/api/finance/xero/callback?error=access_denied&state=x",
    ),
  );
  expect(m.finish).not.toHaveBeenCalled();
  expect(r.headers.get("location")).toBe(
    "https://insulhub-ui.vercel.app/jobs/finance/connections?xero=denied",
  );
  expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("never reflects sensitive provider errors in callback URL", async () => {
  m.finish.mockRejectedValue(Error("client-secret"));
  const r = await callback(
    new NextRequest(
      "https://insulhub-ui.vercel.app/api/finance/xero/callback?code=secret&state=x",
    ),
  );
  expect(r.headers.get("location")).toBe(
    "https://insulhub-ui.vercel.app/jobs/finance/connections?xero=failed",
  );
});
