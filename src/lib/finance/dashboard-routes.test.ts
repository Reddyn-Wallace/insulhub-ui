import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  build: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("./access", () => ({ requireFinanceOwner: mocks.auth }));
vi.mock("./dashboard", () => ({ buildDashboard: mocks.build }));
vi.mock("./live-data", () => ({ loadFinanceInputs: mocks.load }));
vi.mock("./review-store", () => ({ saveReviewDecision: mocks.save }));
import { GET } from "../../app/api/finance/dashboard/route";
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
