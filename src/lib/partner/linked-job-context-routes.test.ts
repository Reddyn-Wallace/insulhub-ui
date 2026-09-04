import { describe, expect, it, vi } from "vitest";
import { linkedJobContextRoute, type LinkedJobContextDependencies } from "./linked-job-context-routes";

const companyId = "11111111-1111-4111-8111-111111111111", jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", legacyId = "6a979ecce193712a011df66d";
const requestKey = "99999999-9999-4999-8999-999999999999";
const origin = "http://localhost:3000";
function request(method: string, body?: unknown, query = `?legacyId=${legacyId}`) {
  return new Request(`${origin}/api/settings/partners/job-context${query}`, { method, headers: { host: "localhost:3000", origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function deps(): LinkedJobContextDependencies {
  return {
    origins: new Set([origin]), verify: vi.fn(async () => null),
    links: { lookup: vi.fn(async (id: string) => id === legacyId ? { companyId, jobId } : null) },
    repository: {
      listCompanies: vi.fn(async () => [{ id: companyId, name: "Northwind", slug: "northwind", revision: 0, billingModel: "INSULHUB_BILLED", quoteDefaults: {} }]),
      jobDetail: vi.fn(async () => ({ id: jobId, clientReference: "NW-12", billingModel: "INSULHUB_BILLED", invoice: { reference: "INV-1" }, settlement: { commissionCents: 1000 }, milestones: { EBA_COMPLETED: { recordedAt: "2026-09-01T00:00:00Z" }, INVOICE_SENT: { recordedAt: "2026-09-02T00:00:00Z" } }, amendments: [] })),
      appendAmendment: vi.fn(async () => undefined),
    } as never,
  };
}

describe("linked partner context in normal InsulHub", () => {
  it("returns neutral attribution without archived financial fields", async () => {
    const response = await linkedJobContextRoute(request("GET"), deps()), body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ linked: true, companyName: "Northwind", tracking: { clientReference: "NW-12" } });
    expect(JSON.stringify(body)).not.toMatch(/billing|invoice|commission|settlement/i);
  });
  it("records a bounded partner-visible update under the reserved service identity", async () => {
    const injected = deps();
    const response = await linkedJobContextRoute(request("POST", { legacyId, description: "Install moved", requestKey }, ""), injected);
    expect(response.status).toBe(201);
    expect(injected.repository.appendAmendment).toHaveBeenCalledWith(expect.objectContaining({ userId: "insulhub-settings-service" }), companyId, jobId, { description: "Install moved", requestKey });
  });
  it("rejects unknown fields, bad origins and unlinked jobs", async () => {
    expect((await linkedJobContextRoute(request("POST", { legacyId, description: "x", billingModel: "PARTNER_BILLED" }, ""), deps())).status).toBe(400);
    const foreign = request("POST", { legacyId, description: "x", requestKey }, ""); foreign.headers.set("origin", "https://evil.example");
    expect((await linkedJobContextRoute(foreign, deps())).status).toBe(403);
    expect((await linkedJobContextRoute(request("GET", undefined, "?legacyId=000000000000000000000000"), deps())).status).toBe(200);
  });
});
