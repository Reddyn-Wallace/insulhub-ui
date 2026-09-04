// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/partner", useRouter: () => navigation }));

import PartnerShell from "@/components/PartnerShell";
import { draftRecoveryKey } from "./draft";
import { partnerSubmissionBrowserKeyName } from "./submission-client";

const viewer = { userId: "partner-a", userName: "Aroha Bennett", companyId: "company-a", companyName: "Northwind Insulation", billingModel: "INSULHUB_BILLED" as const };
class TestLocalStorage implements Storage { private values=new Map<string,string>(); get length(){return this.values.size;} clear(){this.values.clear();} getItem(key:string){return this.values.get(key)??null;} key(index:number){return [...this.values.keys()][index]??null;} removeItem(key:string){this.values.delete(key);} setItem(key:string,value:string){this.values.set(key,String(value));} }

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(window,"localStorage",{configurable:true,value:new TestLocalStorage()});
  navigation.replace.mockReset(); navigation.refresh.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("partner shell accessibility and recovery cleanup", () => {
  it("keeps branding and sign out without top-level navigation on either layout", () => {
    render(<PartnerShell viewer={viewer} demoMode={false} recoveryScope="scope-a"><p>Content</p></PartnerShell>);
    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe("#main-content");
    expect(screen.getByRole("link", { name: "InsulHub partner dashboard" }).getAttribute("href")).toBe("/partner");
    expect(screen.getByRole("button", { name: "Sign out" }).className).toContain("min-h-11");
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New quote / lead" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("offers company user management only to Admins", () => {
    const view = render(<PartnerShell viewer={{...viewer,role:"ADMIN"}} demoMode={false} recoveryScope="scope-a"><p>Content</p></PartnerShell>);
    expect(screen.getByRole("link",{name:"Manage users"}).getAttribute("href")).toBe("/partner/users");
    view.rerender(<PartnerShell viewer={{...viewer,role:"SALES"}} demoMode={false} recoveryScope="scope-a"><p>Content</p></PartnerShell>);
    expect(screen.queryByRole("link",{name:"Manage users"})).toBeNull();
    expect(screen.getByRole("link",{name:"InsulHub partner dashboard"})).toBeTruthy();
  });

  it("clears only the authenticated recovery scope after successful logout", async () => {
    sessionStorage.setItem(draftRecoveryKey("scope-a", "new"), "a");
    sessionStorage.setItem(draftRecoveryKey("scope-b", "new"), "b");
    const submissionA=partnerSubmissionBrowserKeyName("scope-a","11111111-1111-4111-8111-111111111111",2,3);const submissionB=partnerSubmissionBrowserKeyName("scope-b","11111111-1111-4111-8111-111111111111",2,3);localStorage.setItem(submissionA,"pending-a");localStorage.setItem(submissionB,"pending-b");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const user = userEvent.setup();
    render(<PartnerShell viewer={viewer} demoMode={false} recoveryScope="scope-a"><p>Content</p></PartnerShell>);
    await user.click(screen.getAllByRole("button", { name: "Sign out" })[0]);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/partner/login"));
    expect(sessionStorage.getItem(draftRecoveryKey("scope-a", "new"))).toBeNull();
    expect(sessionStorage.getItem(draftRecoveryKey("scope-b", "new"))).toBe("b");
    expect(localStorage.getItem(submissionA)).toBeNull();expect(localStorage.getItem(submissionB)).toBe("pending-b");
  });
});
