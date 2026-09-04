// @vitest-environment jsdom
import React from "react";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import { APP_DIALOG_WARNING_CONFIRM_COLORS, AppDialog } from "@/components/AppDialog";
import PartnerFloorPlanEditor from "@/components/PartnerFloorPlanEditor";
import PartnerFloorPlanList from "@/components/PartnerFloorPlanList";
import PartnerPdfDownloadButton from "@/components/PartnerPdfDownloadButton";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { decodeSitePlanRecovery, encodeSitePlanRecovery, sitePlanRecoveryKey, type PartnerFloorPlanClient } from "./site-plan-client";
import { partnerSubmissionBrowserKeyName } from "./submission-client";
import { registerPartnerSaveGuard } from "./navigation-save";

const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const wall = { id: "wall-1", start: { x: 1, y: 1 }, end: { x: 4, y: 1 }, style: "solid" as const, color: "slate" as const };
function floor(id: string, name: string, order: number, overrides: Partial<PartnerFloorPlanClient> = {}): PartnerFloorPlanClient { return { id, jobId, name, sortOrder: order, document: EMPTY_SITE_PLAN_DOCUMENT, revision: 0, currentPdf: null, pdfReady: false, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", ...overrides }; }
const ground = floor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Ground floor", 0);
const upper = floor("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Upper floor", 1);
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
class TestLocalStorage implements Storage { private values=new Map<string,string>(); get length(){return this.values.size;} clear(){this.values.clear();} getItem(key:string){return this.values.get(key)??null;} key(index:number){return [...this.values.keys()][index]??null;} removeItem(key:string){this.values.delete(key);} setItem(key:string,value:string){this.values.set(key,String(value));} }

beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); sessionStorage.clear(); Object.defineProperty(window,"localStorage",{configurable:true,value:new TestLocalStorage()}); navigation.push.mockReset(); navigation.replace.mockReset(); navigation.refresh.mockReset(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("partner floor-plan list", () => {
  it("drains quote edits before creating, and single-flights Add through navigation", async () => {
    let saved!: (ok: boolean) => void;
    const flush = vi.fn(() => new Promise<boolean>((resolve) => { saved = resolve; }));
    const unregister = registerPartnerSaveGuard(flush);
    const opening = vi.fn(); const busy = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(response({floorPlans:{revision:1,floors:[ground]}}));
    try {
      render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{revision:0,floors:[]}} onOpeningChange={opening} onBusyChange={busy}/>);
      const add = screen.getAllByRole("button",{name:"Add floorplan"})[0];
      fireEvent.click(add); fireEvent.click(add);
      expect(flush).toHaveBeenCalledOnce(); expect(opening).toHaveBeenLastCalledWith(true);
      expect(busy).not.toHaveBeenCalledWith(true); expect(fetch).not.toHaveBeenCalled();
      saved(true);
      await waitFor(()=>expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${jobId}/floor-plans/${ground.id}`));
      expect(fetch).toHaveBeenCalledOnce(); expect(opening).not.toHaveBeenCalledWith(false);
      expect(screen.getByRole("button",{name:"Adding…"})).toHaveProperty("disabled",true);
    } finally { unregister(); }
  });
  it("stays on the quote when its save fails, without creating a floor", async () => {
    const unregister = registerPartnerSaveGuard(async()=>false); const opening=vi.fn();
    try {
      render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{revision:0,floors:[]}} onOpeningChange={opening}/>);
      fireEvent.click(screen.getAllByRole("button",{name:"Add floorplan"})[0]);
      await screen.findByText(/Save the highlighted quote changes/);
      expect(fetch).not.toHaveBeenCalled(); expect(navigation.push).not.toHaveBeenCalled(); expect(opening).toHaveBeenLastCalledWith(false);
    } finally { unregister(); }
  });
  it("requires a read-only reload after an ambiguous create response before another Add",async()=>{
    vi.mocked(fetch).mockRejectedValueOnce(new Error("response lost after commit")).mockResolvedValueOnce(response({floorPlans:{revision:1,floors:[ground]}}));
    render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{revision:0,floors:[]}}/>);
    fireEvent.click(screen.getAllByRole("button",{name:"Add floorplan"})[0]);
    await screen.findByText(/new floorplan could not be confirmed/);
    expect(screen.getAllByRole("button",{name:"Add floorplan"})[0]).toHaveProperty("disabled",true);
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Reload latest floor plans"}));
    await screen.findByRole("heading",{name:"Ground floor"});
    expect(fetch).toHaveBeenCalledTimes(2); expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBeUndefined();
  });
  it("offers retry only after a load error, with no routine Refresh control", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response({floorPlans:{revision:1,floors:[ground]}}));
    render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a"/>);
    await screen.findByRole("button",{name:"Retry floor plans"});
    expect(screen.queryByRole("button",{name:"Refresh"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Retry floor plans"}));
    await screen.findByRole("heading",{name:"Ground floor"});
    expect(screen.queryByRole("button",{name:"Retry floor plans"})).toBeNull();
  });
  it("blocks Add until the authoritative mount refresh reconciles a stale server collection", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const user = userEvent.setup();
    render(<PartnerFloorPlanList refreshOnMount jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 0, floors: [] }} />);
    const add = screen.getAllByRole("button", { name: "Loading floors…" });
    expect(add.length).toBeGreaterThan(0); expect(add.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    await user.click(add[0]); expect(fetch).toHaveBeenCalledTimes(1);
    resolve(response({ floorPlans: { revision: 1, floors: [ground] } }));
    expect(await screen.findByRole("heading",{name:"Ground floor"})).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("creates the default Ground floor and immediately opens its editor", async () => {
    const created = { revision: 5, floors: [ground] }; vi.mocked(fetch).mockResolvedValueOnce(response({ floorPlans: created }, 201));
    const user = userEvent.setup(); render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 4, floors: [] }} />);
    await user.click(screen.getAllByRole("button", { name: "Add floorplan" })[0]);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${jobId}/floor-plans/${ground.id}`));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)); expect(request).toEqual({ revision: 4, name: "Ground floor", document: EMPTY_SITE_PLAN_DOCUMENT });
    expect(screen.getByRole("button",{name:"Adding…"})).toHaveProperty("disabled",true);
  });

  it("serializes deletion and focuses the remaining floor", async () => {
    let resolve!: (value: Response) => void; vi.mocked(fetch).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(); render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 7, floors: [ground, upper] }} />);
    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await user.click(screen.getByRole("button", { name: "Delete floor" }));
    expect(screen.getByRole("button", { name: "Add floorplan" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
    resolve(response({ floorPlans: { revision: 8, floors: [{ ...upper, sortOrder: 0 }] } }));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(`floor-card-${upper.id}`)));
    expect(screen.getByText("Ground floor deleted.")).toBeTruthy();
    expect(screen.queryByRole("heading",{name:"Ground floor"})).toBeNull();
  });

  it("quarantines stale collection changes and prevents keyboard navigation through Open", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ code: "STALE_REVISION", currentRevision: 4 }, 409));
    const user = userEvent.setup(); render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 3, floors: [ground, upper] }} />);
    await user.click(screen.getAllByRole("button",{name:"Delete"})[0]);
    await user.click(screen.getByRole("button",{name:"Delete floor"}));
    expect(await screen.findByText(/changed in another tab/i)).toBeTruthy();
    expect(screen.queryByRole("link",{name:"Open"})).toBeNull(); expect(screen.getAllByText("Open")[0].getAttribute("aria-disabled")).toBe("true");
  });

  it("shows only Draft or Complete without PDF controls or technical metadata", () => {
    const current = floor(ground.id, ground.name, 0, { document: { ...EMPTY_SITE_PLAN_DOCUMENT, walls: [wall] }, revision: 2, currentPdf: { drawingRevision: 2, fileName: "Ground.pdf", generatedAt: "2026-08-29T00:00:00.000Z" }, pdfReady: true });
    const { container } = render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 2, floors: [current, upper] }} />);
    expect(screen.getByText("Complete")).toBeTruthy(); expect(screen.getByText("Draft")).toBeTruthy(); for(const hidden of ["PDF", "Walls:", "Notes:", "Updated:"]) expect(container.textContent).not.toContain(hidden); expect(container.innerHTML).not.toContain("artifactId"); expect(container.innerHTML).not.toContain("renderHash");
    for(const name of ["Move up","Move down","Refresh"]) expect(screen.queryByRole("button",{name})).toBeNull();
  });

  it("adopts an authoritative parent PDF invalidation after an address save", async () => {
    const current = floor(ground.id, ground.name, 0, { document: { ...EMPTY_SITE_PLAN_DOCUMENT, walls: [wall] }, currentPdf: { drawingRevision: 0, fileName: "Ground.pdf", generatedAt: "2026-08-29T00:00:00.000Z" }, pdfReady: true });
    const view = render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 1, floors: [current] }} />); expect(screen.getByText("Complete")).toBeTruthy();
    view.rerender(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 1, floors: [{ ...current, pdfReady: false }] }} />);
    await screen.findByText("Draft"); expect(screen.queryByText("Complete")).toBeNull();
  });

  it("keeps naming inside the editor and exposes compact floor cards", () => {
    render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 1, floors: [ground] }} />);
    expect(screen.getByRole("heading",{name:"Ground floor"})).toBeTruthy(); expect(screen.queryByLabelText("Floor name")).toBeNull();
    expect(screen.getByRole("button",{name:"Add floorplan"})).toHaveProperty("disabled",false); expect(screen.getByRole("link",{name:"Open"}).getAttribute("href")).toContain(ground.id);
  });

  it("explains an empty read-only collection without draft readiness instructions", () => {
    render(<PartnerFloorPlanList readOnly jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 1, floors: [] }} />);
    expect(screen.getByText("Read-only plans.")).toBeTruthy(); expect(screen.getByText("No floor plans recorded")).toBeTruthy(); expect(screen.queryByText(/item to finish/)).toBeNull(); expect(screen.queryByRole("button", { name: "Add floorplan" })).toBeNull();
  });

  it("keeps read-only plans navigable while blocking every editable action for a newer-tab PENDING submission", async () => {
    const pendingName = partnerSubmissionBrowserKeyName("scope-a", jobId, 3, 4);
    localStorage.setItem(pendingName, JSON.stringify({ key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", state: "PENDING", createdAt: 1_000, updatedAt: 1_000 }));
    const editable = render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" submissionJobRevision={2} initialCollection={{ revision: 3, floors: [ground] }} />);
    expect(await screen.findByText("Plan editing is locked.")).toBeTruthy(); expect(screen.getByRole("button", { name: "Add floorplan" })).toHaveProperty("disabled", true); expect(screen.queryByRole("link", { name: "Open" })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    editable.unmount();
    render(<PartnerFloorPlanList readOnly jobId={jobId} recoveryScope="scope-a" submissionJobRevision={2} initialCollection={{ revision: 3, floors: [ground] }} />);
    expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe(`/partner/jobs/${jobId}/floor-plans/${ground.id}`);
  });

  it("does not let an older DRAFT status response override a newer PENDING storage event", async () => {
    let resolve!: (value: Response) => void; vi.mocked(fetch).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" submissionJobRevision={2} initialCollection={{ revision: 3, floors: [ground] }} />);
    const name = partnerSubmissionBrowserKeyName("scope-a", jobId, 3, 4); const value = JSON.stringify({ key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", state: "PENDING", createdAt: 1_000, updatedAt: 1_000 }); localStorage.setItem(name, value);
    const event = new Event("storage") as StorageEvent; Object.defineProperties(event, { key: { value: name }, newValue: { value }, storageArea: { value: localStorage } }); window.dispatchEvent(event); resolve(response({ status: { state: "DRAFT" } }));
    expect(await screen.findByText(/submission is being checked in another tab/i)).toBeTruthy(); expect(screen.getByRole("button", { name: "Add floorplan" })).toHaveProperty("disabled", true);
  });

  it("fails closed synchronously when the guarded revision tuple changes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: { state: "DRAFT" } })).mockImplementationOnce(() => new Promise<Response>(()=>undefined));const view=render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" submissionJobRevision={2} initialCollection={{ revision: 3, floors: [ground] }} />);await screen.findByRole("link",{name:"Open"});view.rerender(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" submissionJobRevision={3} initialCollection={{ revision: 3, floors: [ground] }} />);expect(screen.queryByRole("link",{name:"Open"})).toBeNull();expect(screen.getByRole("button",{name:"Add floorplan"})).toHaveProperty("disabled",true);
  });

  it("refreshes authoritative job props after a DRAFT_LOCKED mutation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ code: "DRAFT_LOCKED" }, 409)); const user = userEvent.setup();
    render(<PartnerFloorPlanList jobId={jobId} recoveryScope="scope-a" initialCollection={{ revision: 1, floors: [ground] }} />);
    await user.click(screen.getByRole("button", { name: "Add floorplan" }));
    await user.click(await screen.findByRole("button", { name: "Reload job details" })); expect(navigation.replace).toHaveBeenCalledWith(`/partner/jobs/${jobId}`); expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});

describe("partner floor-plan editor adapter", () => {
  it("preserves an unchanged completed floor on Back without a save or modal",()=>{
    render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={{...ground,pdfReady:true,document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[wall]}}} recoveryScope="scope-a"/>);
    expect(screen.queryByRole("button",{name:"Save as draft"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Back to quote"}));
    expect(fetch).not.toHaveBeenCalled(); expect(screen.getByText("Complete")).toBeTruthy();
    expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${jobId}#floor-plans`); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("waits for the dirty Back-save, blocks double clicks, and explains invalid names",async()=>{
    let saved!:(value:Response)=>void; vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve=>{saved=resolve;}));
    render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a"/>);
    fireEvent.change(screen.getByLabelText("Floor name"),{target:{value:""}});
    fireEvent.click(screen.getByRole("button",{name:"Back to quote"}));
    expect(screen.getByRole("alert").textContent).toContain("Enter a floor name"); expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Floor name"),{target:{value:"Upper level"}});
    const back=screen.getByRole("button",{name:"Back to quote"}); fireEvent.click(back);fireEvent.click(back);
    expect(fetch).toHaveBeenCalledOnce(); expect(navigation.push).not.toHaveBeenCalled();expect(back).toHaveProperty("disabled",true);
    saved(response({floorPlan:{...ground,name:"Upper level",revision:1}}));
    await waitFor(()=>expect(navigation.push).toHaveBeenCalledOnce());
  });
  it("recovers valid older drawings without an age expiry but rejects future and stale revisions",()=>{
    const key=sitePlanRecoveryKey("scope-a",jobId,ground.id);
    const recovery={scope:"scope-a",jobId,drawingId:ground.id,revision:0,savedAt:"2020-01-01T00:00:00Z",value:{name:"Kept old drawing",document:EMPTY_SITE_PLAN_DOCUMENT,edited:true}};
    sessionStorage.setItem(key,encodeSitePlanRecovery(recovery));
    const view=render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a"/>);
    expect(screen.getByLabelText("Floor name")).toHaveProperty("value","Kept old drawing"); expect(screen.getByText("Unsaved changes recovered.")).toBeTruthy();
    view.unmount(); sessionStorage.setItem(key,encodeSitePlanRecovery({...recovery,revision:3}));
    render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a"/>);
    expect(screen.getByLabelText("Floor name")).toHaveProperty("value","Ground floor");
    expect(decodeSitePlanRecovery(encodeSitePlanRecovery({...recovery,savedAt:"2100-01-01T00:00:00Z"}),"scope-a",jobId,ground.id)).toBeNull();
  });
  it("waits for PDF completion before leaving and stays locked until navigation finishes",async()=>{
    const current={...ground,document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[wall]}};
    let complete!:(response:Response)=>void;
    vi.mocked(fetch).mockResolvedValueOnce(response({floorPlan:{...current,revision:1}})).mockReturnValueOnce(new Promise(resolve=>{complete=resolve;}));
    render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={current} recoveryScope="scope-a"/>);
    fireEvent.click(screen.getByRole("button",{name:"Save as complete"}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    expect(navigation.push).not.toHaveBeenCalled();expect(screen.getByLabelText("Floor name")).toHaveProperty("disabled",true);
    complete(response({floorPlan:{...current,revision:1,pdfReady:true}}));
    await waitFor(()=>expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${jobId}#floor-plans`));
    expect(screen.getByRole("button",{name:"Save as complete"})).toHaveProperty("disabled",true);
    expect(screen.getByRole("button",{name:"Back to quote"})).toHaveProperty("disabled",true);
  });
  it("keeps failed saves in the editor with recovery intact",async()=>{
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a"/>);
    fireEvent.change(screen.getByLabelText("Floor name"),{target:{value:"Kept drawing"}});
    fireEvent.click(screen.getByRole("button",{name:"Back to quote"}));
    await screen.findByText(/could not be saved/i);expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Floor name")).toHaveProperty("disabled",false);
    expect(sessionStorage.getItem(sitePlanRecoveryKey("scope-a",jobId,ground.id))).toContain("Kept drawing");
  });
  it("saves changed completed drawings as Draft on Back to quote", async () => {
    const current={...ground, document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[wall]},currentPdf:{drawingRevision:0,fileName:"Ground.pdf",generatedAt:"2026-08-29T00:00:00Z"},pdfReady:true};
    vi.mocked(fetch).mockResolvedValueOnce(response({floorPlan:{...current,revision:1,pdfReady:false}}));
    render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={current} recoveryScope="scope-a"/>);
    fireEvent.change(screen.getByLabelText("Floor name"),{target:{value:"Changed floor"}});
    fireEvent.click(screen.getByRole("button",{name:"Back to quote"})); await screen.findByText("Draft saved.");
    expect(screen.getByText("Draft")).toBeTruthy(); expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("PATCH"); expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({revision:0,document:current.document});
    expect(screen.queryByRole("button",{name:/PDF/})).toBeNull();
    expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${jobId}#floor-plans`);
    expect(screen.getByLabelText("Floor name")).toHaveProperty("disabled",true);
    expect(screen.getByRole("button",{name:"Back to quote"})).toHaveProperty("disabled",true);
  });

  it("keeps a saved drawing Draft after completion failure and serializes retries/double clicks", async () => {
    const current={...ground, document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[wall]},currentPdf:{drawingRevision:0,fileName:"Ground.pdf",generatedAt:"2026-08-29T00:00:00Z"},pdfReady:true};
    vi.mocked(fetch).mockResolvedValueOnce(response({floorPlan:{...current,revision:1,pdfReady:false}})).mockRejectedValueOnce(new Error("render failed"))
      .mockResolvedValueOnce(response({floorPlan:{...current,revision:2,pdfReady:false}})).mockResolvedValueOnce(response({floorPlan:{...current,revision:2,currentPdf:{...current.currentPdf,drawingRevision:2}}}));
    render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={current} recoveryScope="scope-a"/>);
    const complete=screen.getByRole("button",{name:"Save as complete"}); fireEvent.click(complete); fireEvent.click(complete);
    await screen.findByText(/could not be completed/i); expect(fetch).toHaveBeenCalledTimes(2); expect(screen.getByText("Draft")).toBeTruthy(); expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(complete); await screen.findByText("Complete"); expect(fetch).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body)).revision).toBe(1);
  });
  it("starts direct editor routes locked and performs no mutation while a submission is PENDING", async () => {
    localStorage.setItem(partnerSubmissionBrowserKeyName("scope-a", jobId, 2, 3), JSON.stringify({ key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", state: "PENDING", createdAt: 1_000, updatedAt: 1_000 }));
    const user = userEvent.setup(); render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a" submissionJobRevision={2} submissionFloorPlanRevision={3} />);
    expect(await screen.findByText("Plan editing is locked.")).toBeTruthy(); const input = screen.getByLabelText("Floor name"); expect(input).toHaveProperty("disabled", true); await user.click(screen.getByRole("button", { name: "Back to quote" })); expect(fetch).not.toHaveBeenCalled();
  });
  it("saves a blank in-progress drawing but cannot complete without a wall", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({floorPlan:{...ground,revision:1}}));
    const user=userEvent.setup();render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a"/>);
    expect(screen.getByRole("button",{name:"Save as complete"})).toHaveProperty("disabled",true);
    fireEvent.change(screen.getByLabelText("Floor name"),{target:{value:"Blank floor"}});
    await user.click(screen.getByRole("button",{name:"Back to quote"})); await screen.findByText("Draft saved.");
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("PATCH"); expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${jobId}#floor-plans`);
  });

  it("saves from its persisted revision, marks edited PDF stale, then regenerates from the saved revision", async () => {
    const current = floor(ground.id, ground.name, 0, { document: { ...EMPTY_SITE_PLAN_DOCUMENT, walls: [wall] }, revision: 1, currentPdf: { drawingRevision: 1, fileName: "Ground.pdf", generatedAt: "2026-08-29T00:00:00.000Z" }, pdfReady: true });
    const saved = { ...current, name: "Entry level", revision: 2, pdfReady: false }; const generated = { ...saved, currentPdf: { drawingRevision: 2, fileName: "Entry level.pdf", generatedAt: "2026-08-30T00:00:00.000Z" }, pdfReady: true };
    vi.mocked(fetch).mockResolvedValueOnce(response({ floorPlan: saved })).mockResolvedValueOnce(response({ floorPlan: generated }, 201));
    const user = userEvent.setup(); render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={current} recoveryScope="scope-a" />); const input = screen.getByLabelText("Floor name"); await user.clear(input); await user.type(input, "Entry level");
    expect(screen.getByText("Draft")).toBeTruthy(); await user.click(screen.getByRole("button", { name: "Save as complete" })); await screen.findByText("Floor plan complete.");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).revision).toBe(1); expect(screen.getByText("Complete")).toBeTruthy(); expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/pdf");
    expect(navigation.push).toHaveBeenCalledWith(`/partner/jobs/${jobId}#floor-plans`);
    expect(screen.getByLabelText("Floor name")).toHaveProperty("disabled",true);
  });

  it("keeps recovered edits and exact edit-undo Draft until explicitly completed", async () => {
    const current={...ground, document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[wall]},revision:2,currentPdf:{drawingRevision:2,fileName:"Ground.pdf",generatedAt:"2026-08-29T00:00:00Z"},pdfReady:true};
    const user=userEvent.setup(); const view=render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={current} recoveryScope="scope-a"/>);
    const input=screen.getByLabelText("Floor name"); await user.type(input," revised"); await user.clear(input); await user.type(input,current.name);
    expect(screen.getByText("Draft")).toBeTruthy(); expect(screen.queryByText("Complete")).toBeNull();
    await waitFor(()=>expect(sessionStorage.getItem(sitePlanRecoveryKey("scope-a",jobId,current.id))).toContain('"edited":true'));
    view.unmount(); render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={current} recoveryScope="scope-a"/>);
    expect(await screen.findByText("Unsaved changes recovered.")).toBeTruthy(); expect(screen.getByText("Draft")).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });

  it("quarantines stale edits for scoped recovery and reloads deterministically", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ code: "STALE_REVISION", currentRevision: 3 }, 409)); const user = userEvent.setup(); render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a" />);
    await user.type(screen.getByLabelText("Floor name"), " revised"); await user.click(screen.getByRole("button", { name: "Back to quote" })); expect(await screen.findByText(/changed in another tab/i)).toBeTruthy();
    expect(sessionStorage.getItem(sitePlanRecoveryKey("scope-a", jobId, ground.id))).toContain("Ground floor revised"); expect(screen.getByRole("button", { name: "Save as complete" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Reload latest floor plan" })); expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("rejects malformed and cross-scope recovery before dereference", () => {
    const key = sitePlanRecoveryKey("scope-a", jobId, ground.id); sessionStorage.setItem(key, JSON.stringify({ scope: "scope-a", jobId, drawingId: ground.id, revision: 0, savedAt: new Date().toISOString(), value: { name: 2, document: null } }));
    expect(() => render(<PartnerFloorPlanEditor jobId={jobId} initialFloor={ground} recoveryScope="scope-a" />)).not.toThrow(); expect(screen.queryByText("Unsaved changes recovered.")).toBeNull();
    expect(decodeSitePlanRecovery(encodeSitePlanRecovery({ scope: "other", jobId, drawingId: ground.id, revision: 0, savedAt: new Date().toISOString(), value: {} }), "scope-a", jobId, ground.id)).toBeNull();
  });
});

describe("dialog accessibility", () => {
  it("keeps the warning confirmation token above WCAG AA contrast", () => {
    const channel = (hex: string, offset: number) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const first = luminance(APP_DIALOG_WARNING_CONFIRM_COLORS.background);
    const second = luminance(APP_DIALOG_WARNING_CONFIRM_COLORS.foreground);
    const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    render(<AppDialog open title="Submit?" tone="warning" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm.className).toContain(`bg-[${APP_DIALOG_WARNING_CONFIRM_COLORS.background}]`);
    expect(confirm.className).toContain(`focus:ring-[${APP_DIALOG_WARNING_CONFIRM_COLORS.background}]`);
  });

  it("traps Tab and restores the trigger after closing", async () => {
    function Harness() { const [open, setOpen] = React.useState(false); return <><button onClick={() => setOpen(true)}>Open confirmation</button><AppDialog open={open} title="Delete floor?" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} /></>; }
    const user = userEvent.setup(); render(<Harness />); const trigger = screen.getByRole("button", { name: "Open confirmation" }); await user.click(trigger); const cancel = screen.getByRole("button", { name: "Cancel" }); const confirm = screen.getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(document.activeElement).toBe(cancel)); fireEvent.keyDown(window, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(confirm); fireEvent.keyDown(window, { key: "Tab" }); expect(document.activeElement).toBe(cancel); await user.click(cancel); await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("secure PDF download", () => {
  it("announces success, defers URL cleanup, and surfaces session expiry", async () => {
    const createObjectURL = vi.fn(() => "blob:site-plan"); const revokeObjectURL = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL }); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Blob(["%PDF"]), { status: 200, headers: { "content-disposition": "attachment; filename*=UTF-8''M%C4%81ori.pdf" } })).mockResolvedValueOnce(response({ error: "expired" }, 401));
    const user = userEvent.setup(); render(<PartnerPdfDownloadButton href="/secure.pdf" className="button" />); await user.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Māori.pdf download started."); await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:site-plan"));
    await user.click(screen.getByRole("button", { name: "Download PDF" })); expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("session expired")); expect(screen.getByRole("link", { name: "Sign in again" })).toBeTruthy();
  });
});
