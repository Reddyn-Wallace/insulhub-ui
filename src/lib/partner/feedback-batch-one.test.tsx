// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn(),refresh:vi.fn()})}));
import PartnerDraftForm from "@/components/PartnerDraftForm";
import { createQuoteDraft, calculateQuote, PRODUCT_QUOTE_DEFAULTS } from "./quote";
import type { PartnerJobView } from "./repository";

const quote=createQuoteDraft(PRODUCT_QUOTE_DEFAULTS,"NW-001","2026-08-30T00:00:00Z");
quote.wall={enabled:true,areaSqm:150,rateCentsPerSqm:4200,cavityDepthCm:15};
quote.ceiling={enabled:true,areaSqm:120,rateCentsPerSqm:3500,rValue:4.2,downlights:8};
quote.comments="Ceiling access through hallway";
const job:PartnerJobView={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",clientReference:"NW-001",submissionState:"SUBMITTED",customerName:"Read-only customer",customerMobile:"0211111111",customerEmail:"fictional@example.test",siteAddress:{street:"1 Queen Street",suburb:"Auckland Central",city:"Auckland",postcode:"1010"},leadSources:[],notes:"Access from driveway",revision:4,trackingFacts:[],quote,quoteCalculation:calculateQuote(quote),createdAt:"2026-08-30T00:00:00Z",updatedAt:"2026-08-30T00:00:00Z"};
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal("fetch",vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("feedback batch one",()=>{
  it("does not describe a saved quote as unsaved when submission still needs a complete floor",async()=>{
    vi.stubGlobal("localStorage",sessionStorage);
    vi.mocked(fetch).mockImplementation(async(input)=>new Response(JSON.stringify(String(input).endsWith('/submission')?{status:{state:'DRAFT'}}:{floorPlans:{revision:0,floors:[]}})));
    render(<PartnerDraftForm initialJob={{...job,submissionState:"DRAFT"}} recoveryScope="missing-floor-scope" initialFloorPlans={{revision:0,floors:[]}}/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Submit quote"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"Submit quote"}));
    expect(screen.getByText("Before you submit:")).toBeTruthy();
    expect(screen.getByText("All changes saved.")).toBeTruthy();
    expect(screen.queryByText("Changes not saved.")).toBeNull();
    expect(screen.queryByRole("button",{name:"Retry automatic save"})).toBeNull();
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByText("Before you submit:").closest('[role="alert"]')));
    expect(screen.getByRole("link",{name:"Add a floor plan."}).getAttribute("href")).toBe("#floor-plans");
  });
  it("keeps each validation description available once while the summary is dismissed by editing",async()=>{
    vi.stubGlobal("localStorage",sessionStorage);
    vi.mocked(fetch).mockImplementation(async input=>Response.json(String(input).endsWith('/submission')?{status:{state:'DRAFT'}}:{floorPlans:{revision:0,floors:[]}}));
    render(<PartnerDraftForm initialJob={{...job,submissionState:"DRAFT",customerMobile:"",customerEmail:"",siteAddress:{street:"",suburb:"",city:"",postcode:""},quote:{...quote,wall:{...quote.wall,enabled:false},ceiling:{...quote.ceiling,enabled:false}}}} recoveryScope="validation-description" initialFloorPlans={{revision:0,floors:[]}}/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Submit quote"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"Submit quote"}));
    for(const id of ["draft-products-error","draft-address-error","draft-contact-error"])expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    fireEvent.change(document.getElementById("draft-customerName")!,{target:{value:"Updated customer"}});
    expect(screen.queryByText("Before you submit:")).toBeNull();
    for(const id of ["draft-products-error","draft-address-error","draft-contact-error"])expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
  });
  it("stops the address loading indicator when an in-flight search is cleared",async()=>{
    let signal:AbortSignal|undefined;vi.mocked(fetch).mockImplementation((_url,options)=>{signal=options?.signal as AbortSignal;return new Promise(()=>{});});
    const user=userEvent.setup();render(<PartnerDraftForm recoveryScope="address-clear-scope"/>);
    await user.type(screen.getByLabelText("Street address"),"Queen");
    expect(await screen.findByRole("status",{name:"Searching addresses"})).toBeTruthy();
    await user.clear(screen.getByLabelText("Street address"));
    await waitFor(()=>expect(screen.queryByRole("status",{name:"Searching addresses"})).toBeNull());
    expect(signal?.aborted).toBe(true);
  });
  it("shows the complete submitted job without mutation controls, recovery, or address lookups",async()=>{
    const user=userEvent.setup();const view=render(<PartnerDraftForm readOnly initialJob={job} recoveryScope="readonly-scope" initialFloorPlans={{revision:0,floors:[]}}/>);
    for(const [label,value] of [["Customer name",job.customerName],["Street address",job.siteAddress.street],["Notes",job.notes],["Quote comments",quote.comments]]) {
      const input=screen.getByLabelText(label);expect(input).toHaveProperty("value",value);expect(input.matches(":disabled")).toBe(true);
    }
    expect(screen.getByLabelText("Cavity depth")).toHaveProperty("value","15");expect(screen.getByLabelText("Downlights")).toHaveProperty("value","8");
    expect(screen.getAllByLabelText("Rate per m² ($)").map(input=>(input as HTMLInputElement).value)).toEqual(["42.00","35.00"]);
    expect(screen.getByDisplayValue("Council Fee")).toBeTruthy();
    for(const name of ["Save changes","Submit quote","Add extra","Add floorplan"])expect(screen.queryByRole("button",{name})).toBeNull();
    await user.type(screen.getByLabelText("Customer name"),"changed");fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));expect(fetch).toHaveBeenCalledWith(`/api/partner/jobs/${job.id}/tracking`,expect.objectContaining({cache:"no-store"}));expect(sessionStorage.length).toBe(0);
    expect(screen.queryByText("Submission readiness")).toBeNull();expect(screen.queryByText("Lead source")).toBeNull();
  });
  it("uses InsulHub address suggestions to populate all fields, persists them, and does not requery on selection",async()=>{
    const fetchMock=vi.mocked(fetch);fetchMock.mockImplementation(async(input)=>String(input).startsWith("https://photon.komoot.io/")?new Response(JSON.stringify({features:[{properties:{housenumber:"1",street:"Queen Street",suburb:"Auckland Central",city:"Auckland",postcode:"1010",country:"New Zealand"}}]})):new Response(JSON.stringify({job:{...job,submissionState:"DRAFT"}})));
    const user=userEvent.setup();render(<PartnerDraftForm recoveryScope="address-scope"/>);
    await user.type(screen.getByLabelText("Street address"),"1 Queen");
    await user.click(await screen.findByRole("button",{name:/1, Queen Street, Auckland Central, Auckland, 1010/}));
    for(const [label,value] of [["Street address","1 Queen Street"],["Suburb","Auckland Central"],["City","Auckland"],["Postcode","1010"]]) expect(screen.getByLabelText(label)).toHaveProperty("value",value);
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    await waitFor(()=>expect(fetchMock.mock.calls.filter(([url])=>String(url).startsWith("/api/partner/jobs"))).toHaveLength(1));
    const call=fetchMock.mock.calls.find(([url])=>url==="/api/partner/jobs")!;
    const payload=JSON.parse(String(call[1]?.body));expect(payload.siteAddress).toEqual(job.siteAddress);expect(payload.quote).toMatchObject({consentFeeCents:0,depositBasisPoints:0});
    expect(fetchMock.mock.calls.filter(([url])=>String(url).startsWith("https://photon.komoot.io/"))).toHaveLength(1);
  });
});
