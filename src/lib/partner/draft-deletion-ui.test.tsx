// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PartnerDashboard from "@/components/PartnerDashboard";
import { draftRecoveryKey } from "./draft";
import { sitePlanRecoveryKey } from "./site-plan-client";
import { clearDeletedDraftRecovery } from "./deleted-draft-recovery";
import type { PartnerJobView } from "./repository";
import { calculateQuote, createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";

const quote=createQuoteDraft(PRODUCT_QUOTE_DEFAULTS);
const job:PartnerJobView={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",revision:0,clientReference:"NW-101",submissionState:"DRAFT",customerName:"Fictional customer",customerEmail:"",customerMobile:"",siteAddress:{street:"",suburb:"",city:"",postcode:""},leadSources:[],notes:"",trackingFacts:[],quote,quoteCalculation:calculateQuote(quote),createdAt:"2026-08-31T00:00:00Z",updatedAt:"2026-08-31T00:00:00Z"};
beforeEach(()=>{sessionStorage.clear();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function page(){return render(<PartnerDashboard jobs={[job,{...job,id:"submitted",clientReference:"NW-102",submissionState:"SUBMITTED"}]} companyName="Northwind" recoveryScope="scope"/>);}
async function confirmDeletion(){
  await userEvent.click(screen.getByRole("button",{name:"Delete draft NW-101"}));
  const dialog=screen.getByRole("dialog",{name:"Delete draft?"});
  await userEvent.click(within(dialog).getByRole("button",{name:"Delete draft"}));
}
describe("draft deletion UI",()=>{
  it("offers draft-only deletion, cancel keeps the card, success removes it and persists via server request",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({deleted:true})));vi.stubGlobal("fetch",fetchMock);
    sessionStorage.setItem(draftRecoveryKey("scope",job.id),"unsaved");
    page();expect(screen.queryByRole("button",{name:"Delete draft NW-102"})).toBeNull();
    await userEvent.click(screen.getByRole("button",{name:"Delete draft NW-101"}));
    const dialog=screen.getByRole("dialog");expect(dialog.textContent).toContain("and its floor plans");
    await waitFor(()=>expect(document.activeElement).toBe(within(dialog).getByRole("button",{name:"Cancel"})));
    await userEvent.keyboard("{Escape}");expect(fetchMock).not.toHaveBeenCalled();expect(screen.getAllByRole("article")).toHaveLength(2);
    await confirmDeletion();await waitFor(()=>expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/partner/jobs/${job.id}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({revision:0})});
    expect(sessionStorage.getItem(draftRecoveryKey("scope",job.id))).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Showing 1 of 1 jobs");
  });
  it.each([409,503,200])("keeps the card and recovery on unconfirmed result %s",async status=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:"not deleted"}),{status})));
    sessionStorage.setItem(draftRecoveryKey("scope",job.id),"unsaved");
    page();await confirmDeletion();await screen.findByRole("alert");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect((screen.getByRole("button",{name:"Delete draft NW-101"}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button",{name:"Reload jobs"})).toBeTruthy();
    expect(sessionStorage.getItem(draftRecoveryKey("scope",job.id))).toBe("unsaved");
  });
  it("does not remove a card while pending or on network failure",async()=>{
    let reject!:(reason:Error)=>void;vi.stubGlobal("fetch",vi.fn(()=>new Promise((_,r)=>{reject=r;})));
    page();await confirmDeletion();expect(screen.getByRole("button",{name:"Delete draft NW-101"}).textContent).toBe("Deleting…");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    reject(new Error("offline"));await screen.findByRole("alert");expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("clears only this user's deleted draft and floor-plan copies, including conflicts; storage failures do not throw",()=>{
    const keys=[draftRecoveryKey("scope",job.id),draftRecoveryKey("scope",job.id)+":conflict",sitePlanRecoveryKey("scope",job.id,"floor")];
    const retained=[draftRecoveryKey("other",job.id),draftRecoveryKey("scope","different"),sitePlanRecoveryKey("other",job.id,"floor"),sitePlanRecoveryKey("scope","different","floor")];
    for(const key of [...keys,...retained])sessionStorage.setItem(key,"value");
    clearDeletedDraftRecovery(sessionStorage,"scope",job.id);
    for(const key of keys)expect(sessionStorage.getItem(key)).toBeNull();
    for(const key of retained)expect(sessionStorage.getItem(key)).toBe("value");
    expect(()=>clearDeletedDraftRecovery({get length(){throw Error("blocked");}} as unknown as Storage,"scope",job.id)).not.toThrow();
  });
});
