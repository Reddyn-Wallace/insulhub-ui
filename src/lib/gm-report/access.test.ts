import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireReportActor } from "./access";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const request = () =>
  new NextRequest("http://localhost/api/gm-reports", {
    headers: { "x-access-token": "test-token" },
  });
it("denies anonymous and partner-cookie-only requests without contacting source", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  await expect(
    requireReportActor(
      new NextRequest("http://localhost/api/gm-reports", {
        headers: { cookie: "partner_session=abc" },
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(f).not.toHaveBeenCalled();
});
it("requires verified management identity and never trusts browser-supplied role", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { me: { _id: "gm", role: "SALES" } } }),
      ),
  );
  await expect(requireReportActor(request())).rejects.toMatchObject({
    status: 403,
  });
});
it("allows internal ADMIN or explicitly configured GM IDs, with no cached permission on revocation", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ data: { me: { _id: "admin", role: "ADMIN" } } }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { me: { _id: "admin", role: "SALES" } } }),
    );
  vi.stubGlobal("fetch", f);
  expect((await requireReportActor(request())).id).toBe("admin");
  await expect(requireReportActor(request())).rejects.toMatchObject({
    status: 403,
  });
  vi.stubEnv("GM_REPORT_USER_IDS", "gm");
  f.mockResolvedValue(
    Response.json({ data: { me: { _id: "gm", role: "SALES" } } }),
  );
  expect((await requireReportActor(request())).id).toBe("gm");
});
