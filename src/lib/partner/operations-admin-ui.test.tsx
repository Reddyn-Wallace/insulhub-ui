// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
let query = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/partner-ops",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(query),
}));

import PartnerOpsCompanies, {PartnerCompanyManagement, Users} from "@/components/PartnerOpsCompanies";
import type { OpsCompanyView } from "./operations-client";

const companyA: OpsCompanyView = { id: "11111111-1111-4111-8111-111111111111", revision: 5, slug: "northwind", name: "Northwind Insulation", billingModel: "INSULHUB_BILLED", quoteDefaults: { wallRateCents: 15500, ceilingRateCents: 13200, depositBasisPoints: 2500, consentFeeCents: 0, extras: [{ id: "council-fee", name: "Council Fee", priceCents: 33000 }] } };
const companyB: OpsCompanyView = { ...companyA, id: "22222222-2222-4222-8222-222222222222", slug: "harbour", name: "Harbour Thermal", revision: 2 };
const user = { id: "partner-user-a", name: "Samira Cole", email: "samira@example.test", disabledAt: null };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function requestBody(fetcher: ReturnType<typeof vi.fn>, call: number) { return JSON.parse((fetcher.mock.calls[call]![1] as RequestInit).body as string); }

beforeEach(() => { query = ""; navigation.push.mockReset(); navigation.replace.mockReset(); navigation.refresh.mockReset(); vi.stubGlobal("localStorage", { getItem: (key: string) => key === "token" ? "normal-insulhub-test-token" : null }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("operations company, user and queue controls", () => {
  it("opens connection settings within the selected company's edit panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: { configured: false } })));
    render(<PartnerCompanyManagement initialCompany={companyB} />);
    expect(screen.queryByRole("button", { name: "InsulHub connection" })).toBeNull();
    expect(await screen.findByLabelText("InsulHub email")).toBeTruthy();
    expect(screen.getByLabelText("Company name")).toHaveProperty("value", companyB.name);
  });

  it("continues from a newly saved company straight into adding its first user", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "POST"
      ? response({ company: { id: companyB.id, name: "New Partner", revision: 0 } }, 201)
      : String(_url).endsWith("/users") ? response({ users: [] }) : response({ companies: [companyA, { id: companyB.id, name: "New Partner", revision: 0 }] })));
    render(<PartnerOpsCompanies companies={[companyA]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add company" }));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "New Partner" } });
    fireEvent.click(screen.getByRole("button", { name: "Save company" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/jobs/settings/partners/${companyB.id}?created=1`));
  });

  it("shows only company name and billing model, uses fixed defaults, and locks a conflict", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ error: "changed" }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<PartnerOpsCompanies companies={[companyA]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add company" }));
    fireEvent.click(screen.getByRole("button", { name: "Save company" }));
    expect(screen.getByRole("alert").textContent).toContain("Enter a company name");
    expect(fetcher).not.toHaveBeenCalled();
    for (const field of ["Company slug", "Deposit percentage", "Consent fee (NZD)", "Wall rate (NZD)", "Ceiling rate (NZD)", "Extra name 1"]) expect(screen.queryByLabelText(field)).toBeNull();
    expect(screen.queryByText("Optional quote extras")).toBeNull();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "New Company" } });
    fireEvent.click(screen.getByRole("button", { name: "Save company" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const create = requestBody(fetcher, 0);
    expect(create.creationKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(create).toEqual({ creationKey: create.creationKey, name: "New Company" });
    expect(create).not.toHaveProperty("id"); expect(create).not.toHaveProperty("revision");
    expect((screen.getByRole("button", { name: "Save company" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Reload required");
    for (const name of ["Add company", "Cancel"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);

    cleanup(); fetcher.mockClear();
    fetcher.mockImplementation(async (_url, init) => init?.method === "PUT" ? response({ error: "changed" }, 409) : response({ status: { configured: false } }));
    render(<PartnerCompanyManagement initialCompany={companyA} />);
    fireEvent.click(screen.getByRole("button", { name: "Save company" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const edit = requestBody(fetcher, 1);
    expect(edit.revision).toBe(5);
    expect(edit).toEqual({ revision: 5, name: "Northwind Insulation" });
  });

  it("cannot abandon a pending or unconfirmed save and create a duplicate company", async () => {
    let rejectSave!: (error: Error) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    vi.stubGlobal("fetch", fetcher);
    render(<PartnerOpsCompanies companies={[companyA]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add company" }));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Pending Company" } });
    fireEvent.click(screen.getByRole("button", { name: "Save company" }));
    for (const name of ["Add company", "Cancel", "Saving…"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    rejectSave(new Error("Lost response"));
    await screen.findByRole("alert");
    for (const name of ["Add company", "Cancel", "Save company"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true); fireEvent.click(button);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Company name")).toHaveProperty("value", "Pending Company");
  });

  it("links each company to a dedicated page and filters archived companies", () => {
    render(<PartnerOpsCompanies companies={[companyA, {...companyB, isActive:false}]} />);
    expect(screen.getByRole("link", {name:`Manage ${companyA.name}`}).getAttribute("href")).toBe(`/jobs/settings/partners/${companyA.id}`);
    expect(screen.queryByRole("link", {name:`Manage ${companyB.name}`})).toBeNull();
    expect(screen.queryByLabelText("Company name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Show companies"), {target:{value:"archived"}});
    expect(screen.getByRole("link", {name:`Manage ${companyB.name}`}).getAttribute("href")).toBe(`/jobs/settings/partners/${companyB.id}`);
  });

  it("normalizes user email, enforces the client password policy, disables bodylessly, and refreshes", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return response({ users: [user] });
      if (method === "DELETE") return response({ ok: true });
      return response({ user: { id: "partner-user-b", name: "New User", email: "new@example.test" } }, 201);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<Users companyId={companyA.id} companyName={companyA.name} onLock={vi.fn()} />);
    await screen.findByText("Samira Cole");
    fireEvent.change(screen.getByLabelText("User name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("User email"), { target: { value: "NEW@EXAMPLE.TEST" } });
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeTruthy();
    expect(screen.queryByLabelText("Initial password")).toBeNull();
    fireEvent.change(screen.getByLabelText("Account setup"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("Initial password"), { target: { value: "not-strong" } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    expect(screen.getByRole("alert").textContent).toContain("lowercase, uppercase, a number and a symbol");
    fireEvent.change(screen.getByLabelText("Initial password"), { target: { value: "StrongPassword1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const postCall = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse((postCall[1] as RequestInit).body as string)).toMatchObject({ name: "New User", email: "new@example.test", initialPassword: "StrongPassword1!" });
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("dialog", { name: "Disable partner user?" })).toBeTruthy();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Disable user" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    const deleteCall = fetcher.mock.calls.find(([, init]) => init?.method === "DELETE")!;
    expect(deleteCall[0]).toContain(encodeURIComponent(user.id));
    expect(deleteCall[1]).toEqual({ method: "DELETE", cache: "no-store", credentials: "same-origin", headers: { "x-access-token": "normal-insulhub-test-token" } });
  });

});
