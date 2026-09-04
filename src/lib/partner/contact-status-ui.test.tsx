// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import PartnerContactStatus from "@/components/PartnerContactStatus";
import PartnerDashboard from "@/components/PartnerDashboard";
import type { PartnerJobView } from "./repository";
import { calculateQuote, createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";

afterEach(()=>{cleanup();vi.useRealTimers();});
describe("partner contact status",()=>{
  it("retains focused help when the pointer leaves until Escape dismisses it",()=>{
    vi.useFakeTimers();render(<PartnerContactStatus reference="NW-123"/>);
    const trigger=screen.getByRole("button",{name:/Contact Insulmax/});
    act(()=>trigger.focus());fireEvent.mouseEnter(trigger);fireEvent.mouseLeave(trigger);
    act(()=>vi.advanceTimersByTime(300));expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(document,{key:"Escape"});expect(screen.queryByRole("tooltip")).toBeNull();expect(document.activeElement).toBe(trigger);
  });
  it("offers hoverable, focusable, tap-toggle help with Escape and outside dismissal",async()=>{
    const user=userEvent.setup(); render(<PartnerContactStatus reference="NW-123"/>);
    const trigger=screen.getByRole("button",{name:/Contact Insulmax/});
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.hover(trigger); const tip=screen.getByRole("tooltip"); expect(tip.textContent).toContain("Insulmax team directly");expect(tip.textContent).toContain("NW-123");
    await user.hover(tip); expect(screen.getByRole("tooltip")).toBeTruthy();await user.unhover(tip); await waitFor(()=>expect(screen.queryByRole("tooltip")).toBeNull());
    await user.tab(); expect(document.activeElement).toBe(trigger);expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    await user.keyboard("{Escape}");expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(trigger);expect(screen.getByRole("tooltip")).toBeTruthy();await user.click(trigger);expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(trigger);fireEvent.pointerDown(document.body);expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("uses one generic label for both failures, removes metrics and preserves the attention filter",async()=>{
    const quote=createQuoteDraft(PRODUCT_QUOTE_DEFAULTS,"LOCAL","2026-08-31T00:00:00Z");
    const jobs:PartnerJobView[]=(["FAILED_RETRYABLE","RECONCILIATION_REQUIRED"] as const).map((submissionState,index)=>({id:String(index),clientReference:`NW-${index}`,submissionState,customerName:`Customer ${index}`,customerEmail:"",customerMobile:"",notes:"",leadSources:[],siteAddress:{street:"",suburb:"",city:"",postcode:""},trackingFacts:[],billingModel:"INSULHUB_BILLED",revision:0,quote,quoteCalculation:calculateQuote(quote),createdAt:"2026-08-31T00:00:00Z",updatedAt:"2026-08-31T00:00:00Z"}));
    const {container}=render(<PartnerDashboard jobs={jobs} companyName="Northwind"/>);
    expect(screen.getAllByRole("button",{name:/Contact Insulmax/})).toHaveLength(2);
    expect(container.textContent).not.toMatch(/Retry needed|Reconciliation required/);expect(container.querySelector("dl")).toBeNull();
    await userEvent.click(screen.getByRole("button",{name:"Needs attention"}));expect(screen.getAllByRole("article")).toHaveLength(2);
  });
});
