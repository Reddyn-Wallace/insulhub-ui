import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseJobIdentifier, type JobLinkTarget, type LinkablePartnerJob } from "./job-link";
import { jobLinkPreview, verifyJobLinkPreview } from "./job-link-preview";
import { LegacyJobStatusReader, parseLinkedJob } from "./legacy/job-status";
import { partnerJobLinkRoute, type JobLinkDependencies } from "./job-link-routes";
import { requireInsulhubAuth } from "../insulhub-auth";

const company = "11111111-1111-4111-8111-111111111111", job = "22222222-2222-4222-8222-222222222222";
const id = "a".repeat(24), origin = "https://insulhub.example.test", secret = "test-only-preview-key-".repeat(3);
const raw = () => ({ _id: id, jobNumber: 1234, stage: "QUOTE", archivedAt: null, ebaForm: { complete: false },
  installation: { installDate: "2026-08-29T12:30:00.000Z" }, finalInvoice: null,
  client: { contactDetails: { name: "Test customer", streetAddress: "1 Test Street", suburb: "Test suburb", city: "Test city", postCode: "1234" } } });
const target = (): JobLinkTarget => parseLinkedJob(raw());
const local = (): LinkablePartnerJob => ({ id: job, revision: 4, clientReference: "TEST-1", customerName: "Test customer", siteAddress: target().address,
  submissionState: "FAILED_RETRYABLE", legacyId: null, linkedJobNumber: null,linkMethod:null, linkedStatus: null });
describe("read-only legacy linking adapter", () => {
  it("parses numbers, normal/local job links and case-insensitive IDs without fetching pasted URLs", () => {
    expect(parseJobIdentifier("1234")).toEqual({ number: 1234 });
    expect(parseJobIdentifier(id.toUpperCase())).toEqual({ id });
    expect(parseJobIdentifier(`http://127.0.0.1:3000/jobs/${id}?tab=quote`)).toEqual({ id });
    for (const input of ["0", "-1", "1.5", "javascript:alert(1)", "https://x.test/not-a-job", `https://user:password@x.test/jobs/${id}`, {}, "a".repeat(501)]) expect(() => parseJobIdentifier(input)).toThrow();
  });
  it("maps the three operational partner milestones", () => {
    const result = target();
    expect(result.status).toEqual({ ebaCompleted: false, installDate: "2026-08-30", jobCompleted: false, checkedAt: expect.any(String) });
    expect(parseLinkedJob({ ...raw(), stage: "COMPLETED", ebaForm: { complete: true } }).status).toMatchObject({ jobCompleted: true, ebaCompleted: true });
  });
  it("keeps missing and malformed status flags unknown and rejects invalid dates/archive/identity", () => {
    expect(parseLinkedJob({ ...raw(), stage: undefined, ebaForm: {}, installation: {} }).status).toMatchObject({ ebaCompleted: null, jobCompleted: null, installDate: null });
    for (const change of [{ installation: { installDate: "nonsense" } }, { archivedAt: "2026-08-31" }, { _id: "wrong" }, { client: null }]) expect(() => parseLinkedJob({ ...raw(), ...change })).toThrow();
    expect(parseLinkedJob({ ...raw(), installation: { installDate: String(Date.parse("2026-08-29T12:30:00Z")) } }).status.installDate).toBe("2026-08-30");
  });
  it("uses only the fixed read-only endpoint, no redirects/cache, verified token and exact result identity", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { job: raw() } }));
    expect((await new LegacyJobStatusReader("fixture-token", send).read(`https://evil.test/jobs/${id}`)).id).toBe(id);
    expect(send).toHaveBeenCalledWith("https://api.insulhub.nz/graphql", expect.objectContaining({ redirect: "error", cache: "no-store", headers: expect.objectContaining({ "x-access-token": "fixture-token" }) }));
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).query).not.toMatch(/mutation/);
    send.mockResolvedValue(Response.json({ data: { job: { ...raw(), _id: "b".repeat(24) } } }));
    await expect(new LegacyJobStatusReader("fixture-token", send).read(id)).rejects.toThrow();
  });
  it("refreshes an already-linked archived job while refusing it as a new link target", async () => {
    const send=vi.fn<typeof fetch>(async()=>Response.json({data:{job:{...raw(),archivedAt:"2026-09-05T00:00:00Z",ebaForm:{complete:true}}}}));
    const reader=new LegacyJobStatusReader("fixture-token",send);
    await expect(reader.read(id)).rejects.toThrow();
    await expect(reader.read(id,{allowArchived:true})).resolves.toMatchObject({id,status:{ebaCompleted:true}});
  });
  it("searches exact job number, refuses ambiguous or truncated results and sanitizes upstream failures", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: { jobs: { total: 2, results: [{ _id: id, jobNumber: 1234 }, { _id: "b".repeat(24), jobNumber: 12345 }] } } })).mockResolvedValueOnce(Response.json({ data: { job: raw() } }));
    expect((await new LegacyJobStatusReader("fixture-token", send).read("1234")).id).toBe(id);
    send.mockResolvedValue(Response.json({ data: { jobs: { total: 2, results: [{ _id: id, jobNumber: 1234 }, { _id: id, jobNumber: 1234 }] } } }));
    await expect(new LegacyJobStatusReader("fixture-token", send).read("1234")).rejects.toThrow("could not be found");
    send.mockRejectedValue(new Error("secret-provider-response"));
    await expect(new LegacyJobStatusReader("fixture-token", send).read(id)).rejects.toThrow("InsulHub could not be checked");
  });
});
describe("company-bound preview", () => {
  it("expires and rejects tampering/company/revision/customer/property changes but allows status updates", () => {
    const value = target(), preview = jobLinkPreview(company, job, 4, value, secret);
    expect(() => verifyJobLinkPreview(preview, company, job, 4, { ...value, status: { ...value.status, ebaCompleted: true } }, secret)).not.toThrow();
    for (const [c, j, rev, t] of [["other", job, 4, value], [company, "other", 4, value], [company, job, 5, value], [company, job, 4, { ...value, customerName: "Other customer" }]] as const)
      expect(() => verifyJobLinkPreview(preview, c, j, rev, t, secret)).toThrow();
    expect(() => verifyJobLinkPreview(jobLinkPreview(company, job, 4, value, secret, Date.now() - 1), company, job, 4, value, secret)).toThrow();
    expect(() => verifyJobLinkPreview(preview.slice(0, -1) + "x", company, job, 4, value, secret)).toThrow();
  });
});
describe("normal Settings link routes", () => {
  let deps: JobLinkDependencies;
  const req = (body?: unknown, headers = {}, method = body ? "POST" : "GET") => new Request(`${origin}/api/settings/partners/test`, { method, headers: { host: new URL(origin).host, origin, "x-access-token": "fixture-token", "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  beforeEach(() => { deps = { origins: new Set([origin]), secret, verify: vi.fn(async () => null), reader: vi.fn(() => ({ read: vi.fn(async () => target()) })),
    repository: { list: vi.fn(async () => [local()]), lookup: vi.fn(async () => ({ companyId: company, jobId: job })), commit: vi.fn(async () => true), refresh: vi.fn(async () => true),investigationRequired:vi.fn(async()=>null),commitInvestigated:vi.fn(async()=>true) } }; });
  it("binds preview, confirmation, company lookup and uses no-store responses", async () => {
    const preview = await partnerJobLinkRoute(req({ action: "preview", identifier: id }), company, job, deps);
    expect(preview.status).toBe(200); expect(preview.headers.get("cache-control")).toBe("private, no-store");
    const data = await preview.json();
    expect((await partnerJobLinkRoute(req({ action: "confirm", identifier: id, preview: data.preview, confirmed: true }), company, job, deps)).status).toBe(200);
    expect(deps.repository.commit).toHaveBeenCalledWith(company, job, 4, expect.objectContaining({ id }));
    expect(deps.repository.list).toHaveBeenCalledWith(company);
  });
  it("denies cross-company guessed jobs and partner-cookie authentication", async () => {
    vi.mocked(deps.repository.list).mockResolvedValue([]);
    expect((await partnerJobLinkRoute(req({ action: "preview", identifier: id }), company, job, deps)).status).toBe(404);
    expect(deps.reader).toHaveBeenCalledTimes(1); // Factory only; no read.
    deps.verify = requireInsulhubAuth;
    expect((await partnerJobLinkRoute(req(undefined, { "x-access-token": "", cookie: "insulhub_partner.session_token=partner" }), company, undefined, deps)).status).toBe(401);
  });
  it("checks hostile Origin/Host before auth/upstream; rejects client status injection", async () => {
    for (const headers of [{ origin: "https://evil.test" }, { host: "evil.test" }, { "x-forwarded-host": "evil.test" }]) expect((await partnerJobLinkRoute(req({ action: "preview", identifier: id }, headers), company, job, deps)).status).toBe(403);
    expect(deps.verify).not.toHaveBeenCalled();
    expect((await partnerJobLinkRoute(req({ action: "refresh", ebaCompleted: true }), company, job, deps)).status).toBe(400);
  });
  it("requires explicit confirmation and refuses a changed customer after preview", async () => {
    const response = await partnerJobLinkRoute(req({ action: "preview", identifier: id }), company, job, deps);
    const { preview } = await response.json();
    expect((await partnerJobLinkRoute(req({ action: "confirm", identifier: id, preview }), company, job, deps)).status).toBe(400);
    deps.reader = () => ({ read: async () => ({ ...target(), customerName: "Changed customer" }) });
    expect((await partnerJobLinkRoute(req({ action: "confirm", identifier: id, preview, confirmed: true }), company, job, deps)).status).toBe(409);
    expect(deps.repository.commit).not.toHaveBeenCalled();
  });
  it("requires a second explicit acknowledgement for an armed create with no returned identity",async()=>{
    vi.mocked(deps.repository.investigationRequired).mockResolvedValue("NO_EFFECT_CONFIRMED");
    const response=await partnerJobLinkRoute(req({action:"preview",identifier:id}),company,job,deps);const data=await response.json();
    expect(data.resolutionRequired).toBe("NO_EFFECT_CONFIRMED");
    expect((await partnerJobLinkRoute(req({action:"confirm",identifier:id,preview:data.preview,confirmed:true}),company,job,deps)).status).toBe(400);
    expect((await partnerJobLinkRoute(req({action:"confirm",identifier:id,preview:data.preview,confirmed:true,investigationConfirmed:true}),company,job,deps)).status).toBe(200);
    expect(deps.repository.commitInvestigated).toHaveBeenCalledWith(company,job,4,expect.objectContaining({id}));expect(deps.repository.commit).not.toHaveBeenCalled();
  });
  it("does not fetch unrelated jobs or store client credentials/status in background updates", async () => {
    vi.mocked(deps.repository.lookup).mockResolvedValueOnce(null);
    const read = vi.fn(async () => target()); deps.reader = () => ({ read });
    expect(await (await partnerJobLinkRoute(req({ legacyId: id }), undefined, undefined, deps)).json()).toEqual({ linked: false });
    expect(read).not.toHaveBeenCalled();
    expect((await partnerJobLinkRoute(req({ legacyId: id }), undefined, undefined, deps)).status).toBe(200);
    expect(read).toHaveBeenCalledWith(id, {allowArchived:true});
    expect(deps.repository.refresh).toHaveBeenCalledWith(expect.objectContaining({ id, status: expect.objectContaining({ ebaCompleted: false }) }));
    expect(JSON.stringify(vi.mocked(deps.repository.refresh).mock.calls)).not.toContain("fixture-token");
  });
  it("keeps previous status when upstream fails", async () => {
    deps.reader = () => ({ read: async () => { throw new Error("provider secret"); } });
    expect((await partnerJobLinkRoute(req({ legacyId: id }), undefined, undefined, deps)).status).toBe(503);
    expect(deps.repository.refresh).not.toHaveBeenCalled();
  });
});
