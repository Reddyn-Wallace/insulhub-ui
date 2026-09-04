// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PartnerJobLinks from "@/components/PartnerJobLinks";
import PartnerLinkedJobSync from "@/components/PartnerLinkedJobSync";
import PartnerOpsCompanies from "@/components/PartnerOpsCompanies";
vi.mock("next/navigation", () => ({useRouter: () => ({push:vi.fn()})}));
vi.mock("@/components/AppDialog", () => ({ useAppDialog: () => ({ confirm: vi.fn(), dialog: null }) }));
import type { LinkablePartnerJob } from "./job-link";

const company = "11111111-1111-4111-8111-111111111111", id = "a".repeat(24);
const job: LinkablePartnerJob = { id: "22222222-2222-4222-8222-222222222222", revision: 1, clientReference: "TEST", customerName: "Test Customer",
  siteAddress: { street: "1 Test Street", suburb: "", city: "Auckland", postcode: "1234" }, submissionState: "FAILED_RETRYABLE", legacyId: null, linkedJobNumber: null,linkMethod:null, linkedStatus: null };
const target = { id, jobNumber: 1234, customerName: job.customerName, address: job.siteAddress, status: { ebaCompleted: true, installDate: null, jobCompleted: false, invoiceRecorded: false, checkedAt: "2026-08-31T10:00:00Z" } };
beforeEach(() => { vi.stubGlobal("localStorage", { getItem: () => "fixture-normal-token" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("previews customer/property, requires confirmation, links and reloads into read-only mapping", async () => {
  let linked = false;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action === "preview") return Response.json({ target, preview: "signed-test-preview" });
    if (body?.action === "confirm") { linked = true; return Response.json({ ok: true }); }
    return Response.json({ jobs: [linked ? { ...job, legacyId: id, linkedJobNumber: 1234, linkedStatus: target.status } : job] });
  }); vi.stubGlobal("fetch", fetcher);
  render(<PartnerJobLinks companyId={company} onLock={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link InsulHub job" }));
  fireEvent.change(screen.getByLabelText("InsulHub job number or link"), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Check job" }));
  await screen.findByText("Existing InsulHub job #1234");
  expect(screen.getByRole("button", { name: "Confirm link" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm link" }));
  expect((await screen.findByRole("link", { name: "InsulHub #1234" })).getAttribute("href")).toBe("/jobs/" + id);
  expect(screen.queryByRole("button", { name: "Link InsulHub job" })).toBeNull();
  const calls = fetcher.mock.calls.map(([, init]) => init?.body && JSON.parse(String(init.body))).filter(Boolean);
  expect(calls[1]).toEqual({ action: "confirm", identifier: id, preview: "signed-test-preview", confirmed: true,investigationConfirmed:false });
});
it.each([
  ["NO_EFFECT_CONFIRMED","I checked InsulHub and confirmed the automatic transfer did not create another job."],
  ["RETURNED_IDENTITY","I checked this is the exact job returned by the automatic transfer and completed any remaining quote or floor-plan work in InsulHub."],
] as const)("shows the truthful %s manual-resolution acknowledgement",async(resolutionRequired,label)=>{
  vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>init?.body?Response.json({target,preview:"preview",resolutionRequired}):Response.json({jobs:[job]})));
  render(<PartnerJobLinks companyId={company} onLock={vi.fn()}/>);fireEvent.click(await screen.findByRole("button",{name:"Link InsulHub job"}));fireEvent.change(screen.getByLabelText("InsulHub job number or link"),{target:{value:"1234"}});fireEvent.click(screen.getByRole("button",{name:"Check job"}));
  expect(await screen.findByLabelText(label)).toBeTruthy();expect(screen.getByRole("button",{name:"Confirm link"})).toHaveProperty("disabled",true);
});
it("drops preview/checkbox when the identifier changes and retains actionable failure feedback", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.body ? Response.json({ target, preview: "preview" }) : Response.json({ jobs: [job] })));
  render(<PartnerJobLinks companyId={company} onLock={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link InsulHub job" }));
  fireEvent.change(screen.getByLabelText("InsulHub job number or link"), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Check job" })); await screen.findByRole("checkbox");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("InsulHub job number or link"), { target: { value: "5678" } });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Check job" })).toBeTruthy();
});
it("does not offer retry/resume or editing actions for a linked job", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ jobs: [{ ...job, legacyId: id, linkedJobNumber: 1234, linkedStatus: target.status }] })));
  render(<PartnerJobLinks companyId={company} onLock={vi.fn()} />);
  await screen.findByRole("link", { name: "InsulHub #1234" });
  expect(screen.queryByText(/resume|retry|unlink/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
});
it("checks status on a normal job/version change without affecting the legacy save", async () => {
  const fetcher = vi.fn(async () => Response.json({ linked: true })); vi.stubGlobal("fetch", fetcher);
  const rendered = render(<PartnerLinkedJobSync jobId={id} version="v1" />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  rendered.rerender(<PartnerLinkedJobSync jobId={id} version="v1" />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  rendered.rerender(<PartnerLinkedJobSync jobId={id} version="v2" />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[0]).toEqual(["/api/settings/partners/job-status", expect.objectContaining({ method: "POST", body: JSON.stringify({ legacyId: id }) })]);
});
it("company settings expose Edit and Users without a Jobs section", () => {
  render(<PartnerOpsCompanies companies={[{ id: company, name: "Test partner", revision: 0 }]} />);
  expect(screen.getByRole("link", { name: "Manage Test partner" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Jobs" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Link InsulHub job" })).toBeNull();
});
