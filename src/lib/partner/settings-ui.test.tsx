// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const navigation = vi.hoisted(() => ({ replace:vi.fn(), redirect:vi.fn() }));
const appDialog = vi.hoisted(() => ({ confirm:vi.fn() }));
vi.mock("next/navigation",()=>({ useRouter:()=>navigation,redirect:navigation.redirect }));
vi.mock("@/components/AppDialog",()=>({useAppDialog:()=>({confirm:appDialog.confirm,dialog:null})}));
import SettingsPage from "@/app/jobs/settings/page";
import RetiredOperationsPage from "@/app/partner-ops/page";
import RetiredCompaniesPage from "@/app/partner-ops/companies/page";
import RetiredLoginPage from "@/app/partner-ops/login/page";
import RetiredJobPage from "@/app/partner-ops/jobs/[jobId]/page";
const company={id:"11111111-1111-4111-8111-111111111111",name:"Test Partner",billingModel:"INSULHUB_BILLED",revision:0};
beforeEach(()=>{window.history.replaceState(null,"","/jobs/settings?section=partners");vi.stubGlobal("localStorage",{getItem:()=>"normal-insulhub-test-token"});navigation.replace.mockReset();navigation.redirect.mockReset();appDialog.confirm.mockReset();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("Partners within normal InsulHub Settings",()=>{
  it("uses the existing Settings shell/token, avoids unrelated communications requests, and renders only minimal company fields",async()=>{
    const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith("/notifications")?{settings:{recipientEmail:"notify@example.test",revision:0,updatedAt:"2026-09-02T00:00:00.000Z"}}:{companies:[company]}));vi.stubGlobal("fetch",fetcher);
    render(<SettingsPage/>);
    await screen.findByRole("heading",{name:"Test Partner"});
    await screen.findByDisplayValue("notify@example.test");
    expect(screen.getByRole("heading",{name:"Settings",level:1})).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("/api/settings/partners",expect.objectContaining({headers:{"x-access-token":"normal-insulhub-test-token"}}));
    expect(fetcher).toHaveBeenCalledWith("/api/settings/partners/notifications",expect.objectContaining({headers:{"x-access-token":"normal-insulhub-test-token"}}));
    for(const text of ["Partner operations","Queue","Sign out","Company slug","Deposit percentage","Consent fee (NZD)","Wall rate (NZD)","Ceiling rate (NZD)","Optional quote extras"])expect(screen.queryByText(text)).toBeNull();
    expect(screen.getByRole("link", {name:"Manage Test Partner"}).getAttribute("href")).toContain("/jobs/settings/partners/");
    expect(screen.queryByLabelText("Company name")).toBeNull();
    expect(screen.queryByLabelText("InsulHub email")).toBeNull();
  });
  it("warns about customer details and requires confirmation before changing the recipient",async()=>{
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>url.endsWith("/notifications")&&init?.method==="PUT"
      ?Response.json({settings:{recipientEmail:"new@example.test",revision:1,updatedAt:"2026-09-02T01:00:00.000Z"}})
      :Response.json(url.endsWith("/notifications")?{settings:{recipientEmail:"notify@example.test",revision:0,updatedAt:"2026-09-02T00:00:00.000Z"}}:{companies:[company]}));vi.stubGlobal("fetch",fetcher);
    render(<SettingsPage/>);const input=await screen.findByDisplayValue("notify@example.test");
    expect(screen.getByText(/each email includes the customer name, property address and quote total/i)).toBeTruthy();fireEvent.change(input,{target:{value:"new@example.test"}});
    appDialog.confirm.mockResolvedValueOnce(false);fireEvent.click(screen.getByRole("button",{name:"Save email"}));await waitFor(()=>expect(appDialog.confirm).toHaveBeenCalledOnce());expect(fetcher.mock.calls.filter(([,init])=>init?.method==="PUT")).toHaveLength(0);
    appDialog.confirm.mockResolvedValueOnce(true);fireEvent.click(screen.getByRole("button",{name:"Save email"}));await screen.findByText("Submission notification email saved.");
    const put=fetcher.mock.calls.find(([,init])=>init?.method==="PUT");expect(put?.[0]).toBe("/api/settings/partners/notifications");expect(JSON.parse(String(put?.[1]?.body))).toEqual({revision:0,recipientEmail:"new@example.test"});
  });
  it("offers normal InsulHub sign-in, not a second operations login, when verification expires",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"Unauthorized"},{status:401})));
    render(<SettingsPage/>);
    const link=await screen.findByRole("link",{name:"Sign in to InsulHub"});expect(link.getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button",{name:"Add company"})).toBeNull();
  });
  it("recovers from an unavailable settings response",async()=>{
    let companyAttempts=0;const fetcher=vi.fn(async(url:string)=>url.endsWith("/notifications")?Response.json({settings:{recipientEmail:null,revision:0,updatedAt:"2026-09-02T00:00:00.000Z"}}):++companyAttempts===1?Response.json({error:"Unavailable"},{status:503}):Response.json({companies:[company]}));vi.stubGlobal("fetch",fetcher);
    render(<SettingsPage/>);fireEvent.click(await screen.findByRole("button",{name:"Try again"}));
    await screen.findByText("Test Partner");expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("retains the existing Settings sections and loads their data only when selected",async()=>{
    const fetcher=vi.fn(async(url:string)=>Response.json(url==="/api/settings/partners"?{companies:[company]}:url==="/api/settings/partners/notifications"?{settings:{recipientEmail:null,revision:0,updatedAt:"2026-09-02T00:00:00.000Z"}}:{templates:[],senders:[],settings:{},gmail:{configured:false}}));vi.stubGlobal("fetch",fetcher);
    render(<SettingsPage/>);await screen.findByText("Test Partner");
    fireEvent.click(screen.getByRole("button",{name:"Templates"}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>url==="/api/contact-templates")).toBe(true));
    expect(navigation.replace).toHaveBeenLastCalledWith("/jobs/settings?section=templates");
    fireEvent.click(screen.getByRole("button",{name:"Configure Senders"}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>url==="/api/communication-senders")).toBe(true));
    expect(navigation.replace).toHaveBeenLastCalledWith("/jobs/settings?section=senders");
    fireEvent.click(screen.getByRole("button",{name:"Communication Settings"}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>url==="/api/communication-settings")).toBe(true));
    fireEvent.click(screen.getByRole("button",{name:"Partners"}));
    await screen.findByText("Test Partner");expect(navigation.replace).toHaveBeenLastCalledWith("/jobs/settings?section=partners");
  });
  it.each([RetiredOperationsPage,RetiredCompaniesPage,RetiredLoginPage,RetiredJobPage])("redirects each retired operations page to normal Settings",Page=>{
    Page();expect(navigation.redirect).toHaveBeenCalledWith("/jobs/settings?section=partners");
  });
});
