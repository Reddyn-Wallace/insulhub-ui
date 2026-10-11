import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  build: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("./snapshot-store", () => ({ readSnapshot: mocks.snapshot }));
vi.mock("./snapshot-cache", () => ({
  settleDashboardLoads: async () => undefined,
}));
vi.mock("./bank-refresh", () => ({ refreshBankAccounts: mocks.refresh }));
vi.mock("./access", () => ({ requireFinanceOwner: mocks.auth }));
vi.mock("./dashboard", () => ({ buildDashboard: mocks.build }));
vi.mock("./live-data", () => ({ loadFinanceInputs: mocks.load }));
vi.mock("./review-store", () => ({ saveReviewDecision: mocks.save }));
import {
  GET,
  POST as refreshDashboard,
} from "../../app/api/finance/dashboard/route";
import { POST } from "../../app/api/finance/review/route";
import { FinanceError } from "./errors";
it("denies a different CRM identity before reading data or saving decisions", async () => {
  mocks.auth.mockRejectedValue(new FinanceError(403, "Owner only"));
  expect(
    (await GET(new NextRequest("https://example.com/api/finance/dashboard")))
      .status,
  ).toBe(403);
  expect(
    (
      await POST(
        new NextRequest("https://example.com/api/finance/review", {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("marks the dashboard private and uncacheable", async () => {
  mocks.auth.mockResolvedValue({ userId: "owner", token: "private" });
  mocks.build.mockResolvedValue({ reserved: 10000 });
  const r = await GET(
    new NextRequest("https://example.com/api/finance/dashboard"),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store, private");
  expect(await r.json()).toEqual({ reserved: 10000 });
});

it("requests upstream refresh only after owner authentication and bypasses cached data", async () => {
  mocks.auth.mockResolvedValue({ userId: "owner", token: "private" });
  mocks.refresh.mockResolvedValue([
    {
      account: "Operating account",
      status: "unchanged",
      message: "No new timestamp",
    },
  ]);
  mocks.build.mockResolvedValue({ owed: 100 });
  const response = await refreshDashboard(
    new NextRequest("https://example.com/api/finance/dashboard", {
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.build).toHaveBeenLastCalledWith(
    { userId: "owner", token: "private" },
    false,
    true,
  );
  expect((await response.json()).bankRefresh[0].status).toBe("unchanged");
  mocks.refresh.mockClear();
  mocks.auth.mockRejectedValue(new FinanceError(403, "Owner only"));
  expect(
    (
      await refreshDashboard(
        new NextRequest("https://example.com/api/finance/dashboard", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("returns an owner-authorised expired snapshot without loading upstream sources", async () => {
  mocks.auth.mockResolvedValue({ userId: "owner", token: "private" });
  const saved = { checkedAt: "2020-01-01T00:00:00Z" };
  mocks.snapshot.mockResolvedValue(saved);
  mocks.build.mockResolvedValue({ checkedAt: saved.checkedAt, owed: 100 });
  const r = await GET(
    new NextRequest("https://example.com/api/finance/dashboard?snapshot=1"),
  );
  expect(mocks.snapshot).toHaveBeenLastCalledWith("owner", "overview", true);
  expect(mocks.build).toHaveBeenLastCalledWith(
    { userId: "owner", token: "private" },
    false,
    false,
    saved,
  );
  expect((await r.json()).snapshotStale).toBe(true);
  mocks.snapshot.mockResolvedValue(null);
  expect(
    await (
      await GET(
        new NextRequest("https://example.com/api/finance/dashboard?snapshot=1"),
      )
    ).json(),
  ).toBeNull();
  mocks.snapshot.mockClear();
  mocks.auth.mockRejectedValue(new FinanceError(403, "Owner only"));
  expect(
    (
      await GET(
        new NextRequest("https://example.com/api/finance/dashboard?snapshot=1"),
      )
    ).status,
  ).toBe(403);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
