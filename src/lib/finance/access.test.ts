import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
import { requireFinanceOwner, verifiedFinanceIdentity } from "./access";
const request = () =>
  new NextRequest("https://insulhub-ui.vercel.app/api/finance/sources", {
    headers: { "x-access-token": "valid-session" },
  });
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("FINANCE_OWNER_USER_ID", "owner");
  vi.stubEnv("FINANCE_OWNER_EMAIL", "owner@example.nz");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: { me: { _id: "owner", email: "owner@example.nz" } },
      }),
    ),
  );
});
it("denies missing and non-owner sessions", async () => {
  await expect(
    requireFinanceOwner(new NextRequest("https://example.nz")),
  ).rejects.toMatchObject({ status: 401 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: { me: { _id: "other", email: "owner@example.nz" } },
      }),
    ),
  );
  await expect(requireFinanceOwner(request())).rejects.toMatchObject({
    status: 403,
  });
});
it("fails closed without pinned owner ID", async () => {
  vi.stubEnv("FINANCE_OWNER_USER_ID", "");
  await expect(requireFinanceOwner(request())).rejects.toMatchObject({
    status: 503,
  });
});
it("does not trust a forged browser identity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: { me: { _id: "owner", email: "someone@example.nz" } },
      }),
    ),
  );
  await expect(requireFinanceOwner(request())).rejects.toMatchObject({
    status: 403,
  });
});
it("returns only the verified canonical owner and request token", async () => {
  expect(await requireFinanceOwner(request())).toEqual({
    userId: "owner",
    token: "valid-session",
  });
});
it("distinguishes upstream failure and refuses malformed identities", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("secret network details");
    }),
  );
  await expect(requireFinanceOwner(request())).rejects.toMatchObject({
    status: 503,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ data: { me: { email: "owner@example.nz" } } }),
    ),
  );
  await expect(requireFinanceOwner(request())).rejects.toMatchObject({
    status: 401,
  });
});
it("allows email-verified ID discovery but not finance access before pinning", async () => {
  vi.stubEnv("FINANCE_OWNER_USER_ID", "");
  expect((await verifiedFinanceIdentity(request())).userId).toBe("owner");
  await expect(requireFinanceOwner(request())).rejects.toMatchObject({
    status: 503,
  });
});
