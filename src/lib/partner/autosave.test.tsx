// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, usePathname: () => "/partner/jobs/new" }));
import PartnerDraftForm from "@/components/PartnerDraftForm";
import PartnerShell from "@/components/PartnerShell";
import { draftRecoveryKey, type PartnerDraftFields } from "./draft";
import { createQuoteDraft, calculateQuote, PRODUCT_QUOTE_DEFAULTS } from "./quote";
import type { PartnerJobView } from "./repository";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
const quote = createQuoteDraft(PRODUCT_QUOTE_DEFAULTS, "LOCAL-TEST", "2026-08-30T00:00:00Z");
const job: PartnerJobView = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientReference: "TEST", submissionState: "DRAFT", customerName: "Original", customerEmail: "", customerMobile: "", siteAddress: { street: "", suburb: "", city: "", postcode: "" }, leadSources: [], notes: "", revision: 0, quote, quoteCalculation: calculateQuote(quote), trackingFacts: [], createdAt: "2026-08-30T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z" };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const changeName = (value: string) => fireEvent.change(screen.getByLabelText("Customer name"), { target: { value } });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(800); });
beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); vi.stubGlobal("localStorage", sessionStorage); window.history.replaceState(null, "", "/partner/jobs/new"); vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("quote autosave", () => {
  it("saves pending quote changes before Add floorplan and locks editing through the editor transition",async()=>{
    vi.stubGlobal("localStorage",sessionStorage);
    let create!:(value:Response)=>void; const order:string[]=[];
    vi.mocked(fetch).mockImplementation(async(url,options)=>{
      const path=String(url);
      if(options?.method==="PATCH"){order.push("save quote");return response({job:{...job,customerName:"Saved before drawing",revision:1}});}
      if(options?.method==="POST"){order.push("create floor");return new Promise<Response>(resolve=>{create=resolve;});}
      if(path.endsWith("/floor-plans"))return response({floorPlans:{revision:0,floors:[]}});
      return response({status:{state:"DRAFT"}});
    });
    render(<PartnerDraftForm initialJob={job} initialFloorPlans={{revision:0,floors:[]}} recoveryScope="scope"/>);
    await act(async()=>{});
    changeName("Saved before drawing");fireEvent.click(screen.getAllByRole("button",{name:"Add floorplan"})[0]);
    await act(async()=>{});
    expect(order).toEqual(["save quote","create floor"]);
    expect(screen.getByLabelText("Customer name").matches(":disabled")).toBe(true);expect(navigation.push).not.toHaveBeenCalled();
    const back=screen.getByRole("button",{name:"Back to dashboard"});expect(back).toHaveProperty("disabled",true);fireEvent.click(back);
    expect(navigation.push).not.toHaveBeenCalled();expect(screen.getByLabelText("Customer name").matches(":disabled")).toBe(true);
    await act(async()=>{create(response({floorPlans:{revision:1,floors:[{id:"new-floor",jobId:job.id,name:"Ground floor",document:EMPTY_SITE_PLAN_DOCUMENT,revision:0,sortOrder:0,pdfReady:false,currentPdf:null,createdAt:job.createdAt,updatedAt:job.updatedAt}]}}));});
    expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${job.id}/floor-plans/new-floor`);
    expect(screen.getByLabelText("Customer name").matches(":disabled")).toBe(true);
  });
  it("debounces edits and drains newer typing before Back to dashboard", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(response({ job: { ...job, customerName: "Newest", revision: 2 } }));
    render(<PartnerDraftForm initialJob={job} recoveryScope="scope" />);
    changeName("First"); await tick(); expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Customer name").matches(":disabled")).toBe(false);
    changeName("Newest"); fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => { finish(response({ job: { ...job, customerName: "First", revision: 1 } })); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ revision: 1, draft: { customerName: "Newest" } });
    expect(screen.getByLabelText("Customer name")).toHaveProperty("value", "Newest");
    expect(navigation.push).toHaveBeenCalledWith("/partner");
  });

  it("does not create an untouched draft or expose a manual save button", async () => {
    render(<PartnerDraftForm recoveryScope="scope" />); await tick();
    expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: /save changes|create draft/i })).toBeNull();
  });

  it("keeps editing in place after create and PATCHes later edits to the same job", async () => {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === "POST") return response({ job });
      if (init?.method === "PATCH") return response({ job: { ...job, customerName: "Still typing", revision: 1 } });
      return response(String(url).endsWith("floor-plans") ? { floorPlans: { revision: 0, floors: [] } } : { status: { state: "DRAFT" } });
    });
    render(<PartnerDraftForm recoveryScope="scope" />); changeName("Created"); await tick();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/partner/jobs/${job.id}`);
    expect(screen.getByLabelText("Customer name").matches(":disabled")).toBe(false);
    changeName("Still typing"); await tick();
    const mutations = vi.mocked(fetch).mock.calls.filter(([, init]) => ["POST", "PATCH"].includes(init?.method ?? ""));
    expect(mutations.map(([, init]) => init?.method)).toEqual(["POST", "PATCH"]);
    expect(mutations[1][0]).toBe(`/api/partner/jobs/${job.id}`);
    expect(JSON.parse(String(mutations[1][1]?.body))).toMatchObject({ revision: 0, draft: { customerName: "Still typing" } });
    expect(screen.getByLabelText("Notes").matches(":disabled")).toBe(false);
  });

  it("adopts server quote metadata after draining creation without replacing newer edits", async () => {
    let finish!: (value: Response) => void;
    const serverQuote = { ...quote, defaultsSnapshot: { ...quote.defaultsSnapshot, revision: 19 } };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === "POST") return new Promise(resolve => { finish = resolve; });
      if (init?.method === "PATCH") return response({ job: { ...job, quote: serverQuote, revision: 1 } });
      return response(String(url).endsWith("floor-plans") ? { floorPlans: { revision: 0, floors: [] } } : { status: { state: "DRAFT" } });
    });
    render(<PartnerDraftForm recoveryScope="scope" />);
    changeName("First"); await tick();
    changeName("Newest");
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep this later edit" } });
    await act(async () => { finish(response({ job: { ...job, quote: serverQuote } })); });
    expect(screen.getByLabelText("Customer name")).toHaveProperty("value", "Newest");
    expect(screen.getByLabelText("Notes")).toHaveProperty("value", "Keep this later edit");
    fireEvent.click(screen.getByRole("button", { name: "Submit quote" }));
    await act(async () => {});
    expect(screen.queryAllByText(/A local quote number is required/)).toHaveLength(0);
    expect(screen.queryAllByText(/A quote date is required/)).toHaveLength(0);
    changeName("Final"); await tick();
    const patches = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(JSON.parse(String(patches[1][1]?.body)).draft).toMatchObject({
      customerName: "Final", notes: "Keep this later edit", quote: {
        quoteNumber: serverQuote.quoteNumber, quoteDate: serverQuote.quoteDate, defaultsSnapshot: serverQuote.defaultsSnapshot,
      },
    });
  });

  it("recovers raw price-only edits even when their parsed quote equals the saved quote", async () => {
    const enabled = { ...job, quote: { ...quote, wall: { ...quote.wall, enabled: true } } };
    const first = render(<PartnerDraftForm initialJob={enabled} recoveryScope="scope" />);
    fireEvent.change(screen.getByLabelText("Rate per m² ($)"), { target: { value: "-" } }); await tick(); first.unmount();
    render(<PartnerDraftForm initialJob={enabled} recoveryScope="scope" />);
    expect(screen.getByLabelText("Rate per m² ($)")).toHaveProperty("value", "-");
    expect(screen.getByText("Unsaved changes recovered.")).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps later edits quarantined after a committed PATCH loses its response", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("PATCH committed but response lost")).mockResolvedValueOnce(new Response(JSON.stringify({ code: "STALE_REVISION", currentRevision: 1 }), { status: 409 }));
    const first = render(<PartnerDraftForm initialJob={job} recoveryScope="scope" />);
    changeName("Committed A"); await tick(); changeName("Unsaved B"); await tick();
    expect(screen.getByLabelText("Earlier unsaved changes")).toHaveProperty("value", expect.stringContaining("Unsaved B"));
    fireEvent.click(screen.getByRole("button", { name: "Reload latest draft" }));
    first.unmount(); render(<PartnerDraftForm initialJob={{ ...job, revision: 1, customerName: "Committed A" }} recoveryScope="scope" />);
    expect(screen.getByLabelText("Customer name")).toHaveProperty("value", "Committed A");
    expect(screen.getByLabelText("Earlier unsaved changes")).toHaveProperty("value", expect.stringContaining("Unsaved B"));
  });

  it("recovers a lost create response across remount and replays the original key/body before PATCHing newer edits", async () => {
    let created = 0; const stored = new Map<string, PartnerJobView>();
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (!init?.body) return response(String(_url).endsWith("floor-plans") ? { floorPlans: { revision: 0, floors: [] } } : { status: { state: "DRAFT" } });
      const payload = JSON.parse(String(init?.body));
      if (init?.method === "POST") {
        const key = new Headers(init.headers).get("idempotency-key")!;
        if (!stored.has(key)) { stored.set(key, { ...job, ...payload, revision: 0 }); created++; throw new Error("response lost after commit"); }
        return response({ job: stored.get(key) });
      }
      return response({ job: { ...job, ...payload.draft, revision: 1 } });
    });
    const first = render(<StrictMode><PartnerDraftForm recoveryScope="scope" /></StrictMode>);
    changeName("Original create"); await tick(); expect(created).toBe(1);
    changeName("Newer recovered edit"); first.unmount();
    render(<StrictMode><PartnerDraftForm recoveryScope="scope" /></StrictMode>); await tick();
    expect(created).toBe(1);
    const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.body);
    expect(calls).toHaveLength(3);
    expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
    expect(new Headers(calls[1][1]?.headers).get("idempotency-key")).toBe(new Headers(calls[0][1]?.headers).get("idempotency-key"));
    expect(JSON.parse(String(calls[2][1]?.body))).toMatchObject({ revision: 0, draft: { customerName: "Newer recovered edit" } });
    expect(window.location.pathname).toBe(`/partner/jobs/${job.id}`);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("retains partial email/raw amounts, does not steal focus, and refuses navigation until valid", async () => {
    const first = render(<PartnerDraftForm initialJob={job} recoveryScope="scope" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "unfinished@" } });
    fireEvent.click(screen.getByLabelText("Wall insulation"));
    const rate = screen.getByLabelText("Rate per m² ($)"); rate.focus(); fireEvent.change(rate, { target: { value: "1..2" } });
    await tick(); expect(document.activeElement).toBe(rate); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" })); await act(async () => {});
    expect(navigation.push).not.toHaveBeenCalled();
    first.unmount(); render(<PartnerDraftForm initialJob={job} recoveryScope="scope" />);
    expect(screen.getByLabelText("Email")).toHaveProperty("value", "unfinished@"); expect(screen.getByLabelText("Rate per m² ($)")).toHaveProperty("value", "1..2");
    expect(sessionStorage.getItem(draftRecoveryKey("scope", job.id))).toContain("unfinished@");
  });

  it("blocks shell links and sign-out when saving fails, preserving recovery", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<PartnerShell viewer={{ userId: "u", userName: "User", companyId: "c", companyName: "Company" }} demoMode={false} recoveryScope="scope"><PartnerDraftForm initialJob={job} recoveryScope="scope" /></PartnerShell>);
    changeName("Kept offline"); fireEvent.click(screen.getByRole("link", { name: "InsulHub partner dashboard" })); await act(async () => {});
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" })); await act(async () => {});
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("logout"))).toBe(true);
    expect(sessionStorage.getItem(draftRecoveryKey("scope", job.id))).toContain("Kept offline");
  });

  it("flushes successfully before sign-out, without losing newly entered data", async () => {
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).includes("logout") ? response({}) : response({ job: { ...job, ...(JSON.parse(String(init?.body)).draft as PartnerDraftFields), revision: 1 } }));
    render(<PartnerShell viewer={{ userId: "u", userName: "User", companyId: "c", companyName: "Company" }} demoMode={false} recoveryScope="scope"><PartnerDraftForm initialJob={job} recoveryScope="scope" /></PartnerShell>);
    changeName("Saved before logout"); fireEvent.click(screen.getByRole("button", { name: "Sign out" })); await act(async () => {});
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([`/api/partner/jobs/${job.id}`, "/api/partner/auth/logout"]);
    expect(navigation.replace).toHaveBeenCalledWith("/partner/login");
    expect(document.getElementById("main-content")?.hasAttribute("inert")).toBe(true);
  });

  it("prevents further editing during the post-flush sign-out request and restores it on failure", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).includes("logout") ? new Promise((resolve) => { finish = resolve; }) : response({ job: { ...job, ...JSON.parse(String(init?.body)).draft, revision: 1 } }));
    render(<PartnerShell viewer={{ userId: "u", userName: "User", companyId: "c", companyName: "Company" }} demoMode={false} recoveryScope="scope"><PartnerDraftForm initialJob={job} recoveryScope="scope" /></PartnerShell>);
    changeName("Flushed"); fireEvent.click(screen.getByRole("button", { name: "Sign out" })); await act(async () => {});
    expect(document.getElementById("main-content")?.hasAttribute("inert")).toBe(true);
    await act(async () => { finish(new Response("{}",{status:503})); });
    expect(document.getElementById("main-content")?.hasAttribute("inert")).toBe(false);
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
