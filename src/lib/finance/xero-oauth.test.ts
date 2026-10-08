import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const storage = vi.hoisted(() => ({
  saveState: vi.fn(),
  consumeState: vi.fn(),
  saveTokens: vi.fn(),
  readConnection: vi.fn(),
  withTokens: vi.fn(),
  pinTenant: vi.fn(),
}));
vi.mock("./connection-store", () => storage);
import {
  startXeroConnection,
  finishXeroConnection,
  listXeroOrganisations,
  selectXeroOrganisation,
  XERO_SCOPES,
} from "./xero-oauth";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FINANCE_OWNER_USER_ID", "owner");
  vi.stubEnv("FINANCE_APP_ORIGIN", "https://insulhub-ui.vercel.app");
  vi.stubEnv("XERO_CLIENT_ID", "client");
  vi.stubEnv("XERO_CLIENT_SECRET", "secret");
  storage.consumeState.mockResolvedValue("owner");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 1800,
        scope: XERO_SCOPES,
      }),
    ),
  );
});
it("starts read-only authorisation with random state and exact callback", async () => {
  const a = await startXeroConnection("owner"),
    b = await startXeroConnection("owner");
  expect(a.state).not.toBe(b.state);
  const u = new URL(a.url);
  expect(u.searchParams.get("redirect_uri")).toBe(
    "https://insulhub-ui.vercel.app/api/finance/xero/callback",
  );
  expect(u.searchParams.get("scope")).toBe(XERO_SCOPES);
  expect(
    XERO_SCOPES.split(" ")
      .filter((s) => s.startsWith("accounting."))
      .every((s) => s.endsWith(".read")),
  ).toBe(true);
});
it("rejects browser mismatch before token exchange", async () => {
  await expect(
    finishXeroConnection("code", "a".repeat(43), "b".repeat(43)),
  ).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects consumed or expired state and changed owner", async () => {
  storage.consumeState.mockResolvedValue(null);
  await expect(
    finishXeroConnection("code", "a".repeat(43), "a".repeat(43)),
  ).rejects.toMatchObject({ status: 400 });
  storage.consumeState.mockResolvedValue("other");
  await expect(
    finishXeroConnection("code", "a".repeat(43), "a".repeat(43)),
  ).rejects.toMatchObject({ status: 403 });
});
it("stores valid tokens but does not select the first tenant", async () => {
  await finishXeroConnection("code", "a".repeat(43), "a".repeat(43));
  expect(storage.saveTokens).toHaveBeenCalledWith(
    "owner",
    expect.objectContaining({ accessToken: "access" }),
  );
  expect(storage.pinTenant).not.toHaveBeenCalled();
});
it("rejects incomplete or overprivileged token response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ access_token: "access" })),
  );
  await expect(
    finishXeroConnection("code", "a".repeat(43), "a".repeat(43)),
  ).rejects.toMatchObject({ status: 502 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 1800,
        scope: XERO_SCOPES + " accounting.invoices",
      }),
    ),
  );
  await expect(
    finishXeroConnection("code", "a".repeat(43), "a".repeat(43)),
  ).rejects.toMatchObject({ status: 502 });
});
it("only pins a connected expected organisation", async () => {
  storage.withTokens.mockImplementation(async (_owner, operation) =>
    operation({ accessToken: "access", tenantId: null }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([
        {
          tenantId: "wrong",
          tenantName: "Other company",
          tenantType: "ORGANISATION",
        },
      ]),
    ),
  );
  expect((await listXeroOrganisations("owner"))[0].eligible).toBe(false);
  await expect(selectXeroOrganisation("owner", "wrong")).rejects.toMatchObject({
    status: 400,
  });
  expect(storage.pinTenant).not.toHaveBeenCalled();
});
