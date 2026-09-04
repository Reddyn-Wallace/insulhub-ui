// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import PartnerDraftForm from "@/components/PartnerDraftForm";
import { draftRecoveryKey } from "./draft";
import type { PartnerJobView } from "./repository";
import { calculateQuote, createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";

const pricedQuote = createQuoteDraft({ ...PRODUCT_QUOTE_DEFAULTS, wallRateCents: 15500, ceilingRateCents: 13200, revision: 1 });

function job(revision: number, customerName = "Server Customer"): PartnerJobView {
  const quote = createQuoteDraft(PRODUCT_QUOTE_DEFAULTS, "LOCAL-DEMO-101", "2026-08-28T00:00:00.000Z");
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientReference: "DEMO-101", submissionState: "DRAFT",
    customerName, customerMobile: "", customerEmail: "",
    siteAddress: { street: "", suburb: "", city: "", postcode: "" }, leadSources: [], notes: "", revision,
    trackingFacts: [], createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
    quote, quoteCalculation: calculateQuote(quote),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } });
  window.history.replaceState(null, "", "/partner/jobs/new");
  navigation.push.mockReset(); navigation.replace.mockReset(); navigation.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("partner draft browser recovery", () => {
  it("keeps the focused field editable after autosave with submission checks enabled", async () => {
    const floors = { revision: 0, floors: [] };
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (init?.method === "PATCH") return Response.json({ job: job(1, "Updated") });
      if (String(url).endsWith("floor-plans")) return Response.json({ floorPlans: floors });
      return Response.json({ status: { state: "DRAFT" } });
    }));
    render(<PartnerDraftForm initialJob={job(0)} initialFloorPlans={floors} recoveryScope="focus-scope" />);
    const name = screen.getByLabelText("Customer name");
    await waitFor(() => expect(name.matches(":disabled")).toBe(false));
    name.focus();
    fireEvent.change(name, { target: { value: "Updated" } });
    // Any temporary disabling loses focus in a real browser, even when the
    // status request completes before the next assertion.
    const disabledStates: boolean[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) if (record.attributeName === "disabled" && record.oldValue !== null) disabledStates.push(true);
    });
    observer.observe(name.closest("fieldset")!, { attributes: true, attributeOldValue: true });
    await waitFor(() => expect(screen.getByText("All changes saved.")).toBeTruthy(), { timeout: 2000 });
    observer.disconnect();
    expect(disabledStates).toEqual([]);
    expect(document.activeElement).toBe(name);
    expect(name.matches(":disabled")).toBe(false);
  });

  it("does not recover one tenant's unsaved new lead into another scope", async () => {
    const user = userEvent.setup();
    const first = render(<PartnerDraftForm recoveryScope="northwind-scope" />);
    await user.type(screen.getByLabelText("Customer name"), "Northwind private unsaved");
    await waitFor(() => expect(sessionStorage.getItem(draftRecoveryKey("northwind-scope", "new"))).toContain("Northwind private unsaved"));
    first.unmount();

    render(<PartnerDraftForm recoveryScope="harbour-scope" />);
    expect(screen.getByLabelText("Customer name")).toHaveProperty("value", "");
    expect(screen.queryByText("Unsaved changes recovered.")).toBeNull();
  });

  it("quarantines a stale save, blocks every later mutation/save, and resets from the refreshed server revision", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "STALE_REVISION", currentRevision: 2 }), { status: 409, headers: { "content-type": "application/json" } }));
    const view = render(<PartnerDraftForm initialJob={job(0)} recoveryScope="northwind-scope" />);
    const name = screen.getByLabelText("Customer name");
    await user.clear(name); await user.type(name, "Stale tab value");
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    await screen.findByText(/changed in another tab/i);
    expect(sessionStorage.getItem(draftRecoveryKey("northwind-scope", job(0).id))).toBeNull();
    expect(name.matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("Notes").matches(":disabled")).toBe(true);
    await user.type(name, " must not apply");
    expect(name).toHaveProperty("value", "Stale tab value");
    fireEvent.submit(name.closest("form")!);
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByText(/changed in another tab/i)).toBeTruthy();
    expect(sessionStorage.getItem(draftRecoveryKey("northwind-scope", job(0).id))).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reload latest draft" }));
    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith("/partner/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?reload=2");
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(draftRecoveryKey("northwind-scope", job(0).id))).toBeNull();

    view.rerender(<PartnerDraftForm initialJob={job(2, "Latest server value")} recoveryScope="northwind-scope" />);
    await waitFor(() => expect(screen.getByLabelText("Customer name")).toHaveProperty("value", "Latest server value"));
    expect(screen.getByLabelText("Customer name").matches(":disabled")).toBe(false);
    expect(screen.getByText("Latest draft loaded.")).toBeTruthy();
    expect(screen.queryByDisplayValue("Stale tab value")).toBeNull();
  });

  it("becomes authoritatively read-only when another device freezes the draft during save", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "DRAFT_LOCKED" }), { status: 409, headers: { "content-type": "application/json" } }));
    render(<PartnerDraftForm initialJob={job(0)} recoveryScope="northwind-scope" />);
    const name = screen.getByLabelText("Customer name");
    await user.clear(name); await user.type(name, "Cross-device race");
    await waitFor(() => expect(sessionStorage.getItem(draftRecoveryKey("northwind-scope", job(0).id))).toContain("Cross-device race"));
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    expect(await screen.findByText(/Submission started in another browser or device/i)).toBeTruthy();
    expect(sessionStorage.getItem(draftRecoveryKey("northwind-scope", job(0).id))).toBeNull();
    expect(name.matches(":disabled")).toBe(true);
    expect(screen.queryByRole("link", { name: "Open plans page" })).toBeNull();
    fireEvent.submit(name.closest("form")!);
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByText(/reload its status before making any more changes/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reload submission status" }));
    expect(navigation.replace).toHaveBeenCalledWith(`/partner/jobs/${job(0).id}`);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("promotes a new draft without navigation or losing focus when recovery removal throws", async () => {
    const created = job(0, "Created once");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ job: created, destination: `/partner/jobs/${created.id}` }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("storage disabled"); });
    const user = userEvent.setup();
    render(<PartnerDraftForm recoveryScope="northwind-scope" />);
    await user.type(screen.getByLabelText("Customer name"), "Created once");
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    await waitFor(() => expect(window.location.pathname).toBe(`/partner/jobs/${created.id}`));
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Customer name"));
    expect(screen.getByLabelText("Customer name").matches(":disabled")).toBe(false);
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(screen.getByText("All changes saved.")).toBeTruthy();
  });

  it("starts with blank rates, preserves entered pricing, and clears products without confirmation", async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, "confirm");
    render(<PartnerDraftForm recoveryScope="northwind-scope" initialQuote={pricedQuote} />);
    await user.click(screen.getByLabelText("Wall insulation"));
    await user.type(screen.getByLabelText("Area (m²)"), "10");
    await user.selectOptions(screen.getByLabelText("Cavity depth"), "10");
    expect(screen.queryByText(/R 2.8 · 1.5 bags/)).toBeNull();
    expect(screen.getByLabelText("Rate per m² ($)")).toHaveProperty("value", "");
    await user.type(screen.getByLabelText("Rate per m² ($)"), "155");
    await user.click(screen.getByLabelText("Area (m²)"));
    expect(screen.getByText("$2,162.00")).toBeTruthy();

    await user.click(screen.getByLabelText("Wall insulation"));
    expect(screen.queryByLabelText("Area (m²)")).toBeNull();
    await user.click(screen.getByLabelText("Wall insulation"));
    expect(screen.getByLabelText("Rate per m² ($)")).toHaveProperty("value", "");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("adds, reorders and removes accessible extras", async () => {
    const user = userEvent.setup(); render(<PartnerDraftForm recoveryScope="northwind-scope" initialQuote={pricedQuote} />);
    await user.click(screen.getByRole("button", { name: "Add extra" }));
    const names = screen.getAllByLabelText("Name");
    expect(document.activeElement).toBe(names[1]);
    expect(screen.getByText(/Extra 2 added/i)).toBeTruthy();
    await user.type(names[1], "Scaffold access");
    expect(screen.getByRole("button", { name: "Move Scaffold access up" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move Scaffold access up" }));
    expect(screen.getAllByLabelText("Name")[0]).toHaveProperty("value", "Scaffold access");
    expect(document.activeElement).toBe(screen.getAllByLabelText("Name")[0]);
    expect(screen.getByText(/moved to position 1/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove Scaffold access" }));
    expect(screen.queryByDisplayValue("Scaffold access")).toBeNull();
    expect(document.activeElement).toBe(screen.getAllByLabelText("Name")[0]);
    expect(screen.getByText(/Scaffold access removed/i)).toBeTruthy();
  });

  it("keeps raw dollar entry stable until blur, then rounds half-up and supports clear and paste", async () => {
    const user = userEvent.setup();
    render(<PartnerDraftForm recoveryScope="northwind-scope" initialQuote={pricedQuote} />);
    await user.click(screen.getByLabelText("Wall insulation"));
    const rate = screen.getByLabelText("Rate per m² ($)");
    await user.clear(rate);
    await user.type(rate, "10.075");
    expect(rate).toHaveProperty("value", "10.075");
    await user.click(screen.getByLabelText("Area (m²)"));
    expect(rate).toHaveProperty("value", "10.08");
    await user.clear(rate);
    await user.click(screen.getByLabelText("Area (m²)"));
    expect(rate).toHaveProperty("value", "");
    await user.click(rate);
    await user.paste("123.45");
    expect(rate).toHaveProperty("value", "123.45");
  });

  it("hides fixed fees and sends zero terms even with old nonzero defaults", async () => {
    const created = job(0);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ job: created }), {status:201}));
    render(<PartnerDraftForm recoveryScope="northwind-scope" initialQuote={{...pricedQuote,consentFeeCents:9900,depositBasisPoints:2500}} />);
    expect(screen.queryByLabelText("Consent fee ($)")).toBeNull();
    expect(screen.queryByLabelText("Deposit (%)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Automatic quote" } });
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const body=JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.quote).toMatchObject({consentFeeCents:0,depositBasisPoints:0});
  });

  it("preserves malformed dollar text and blocks a silent clear on save", async () => {
    const user = userEvent.setup();
    render(<PartnerDraftForm recoveryScope="northwind-scope" initialQuote={pricedQuote} />);
    await user.click(screen.getByLabelText("Wall insulation"));
    const rate = screen.getByLabelText("Rate per m² ($)");
    await user.clear(rate); await user.type(rate, "12x");
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    expect(rate).toHaveProperty("value", "12x");
    expect(rate.getAttribute("aria-invalid")).toBe("true");
    expect(await screen.findByText("Enter a valid non-negative dollar amount.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps inputs editable while a save response is pending", async () => {
    let resolveResponse!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    const user = userEvent.setup();
    render(<PartnerDraftForm initialJob={job(0)} recoveryScope="northwind-scope" />);
    const name = screen.getByLabelText("Customer name");
    await user.clear(name); await user.type(name, "Saving value");
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    await screen.findByText("Saving changes…");
    expect(name.closest("fieldset")).toHaveProperty("disabled", false);
    expect(name.matches(":disabled")).toBe(false);
    expect(screen.getByLabelText("Notes").matches(":disabled")).toBe(false);
    resolveResponse(new Response(JSON.stringify({ job: job(1, "Saving value") }), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await screen.findByText("All changes saved.")).toBeTruthy();
    expect(name).toHaveProperty("disabled", false);
  });

  it("links and wires every returned visible field error from the focused summary", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: "Check the highlighted fields.",
      fieldErrors: {
        customerMobile: "Check mobile.", customerEmail: "Check email.", street: "Check street.", suburb: "Check suburb.",
        city: "Check city.", postcode: "Check postcode.", notes: "Check notes.",
        "wall.areaSqm": "Check wall area.", "wall.rateCentsPerSqm": "Check wall rate.", "wall.cavityDepthCm": "Check depth.",
        "extras.0.name": "Check extra name.",
        "extras.0.priceCents": "Check extra price.", comments: "Check comments.", form: "Check draft shape.",
      },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    const user = userEvent.setup();
    render(<PartnerDraftForm initialJob={job(0)} recoveryScope="northwind-scope" initialQuote={pricedQuote} />);
    await user.click(screen.getByLabelText("Wall insulation"));
    await user.type(screen.getByLabelText("Area (m²)"), "10");
    await user.selectOptions(screen.getByLabelText("Cavity depth"), "10");
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    const alert = await screen.findByRole("alert");
    expect(document.activeElement).not.toBe(alert);
    for (const id of ["draft-customerMobile", "draft-customerEmail", "draft-street", "draft-suburb", "draft-city", "draft-postcode", "draft-notes", "draft-wall-areaSqm", "draft-wall-rateCentsPerSqm", "draft-wall-cavityDepthCm", "draft-comments"]) {
      const input = document.getElementById(id)!;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toMatch(/-error$/);
    }
    expect(screen.getByRole("link", { name: /Mobile: Check mobile/ }).getAttribute("href")).toBe("#draft-customerMobile");
    expect(alert.textContent).toContain("Draft: Check draft shape.");
    const mobile = document.getElementById("draft-customerMobile")!;
    mobile.scrollIntoView = vi.fn();
    await user.click(screen.getByRole("link", { name: /Mobile: Check mobile/ }));
    await Promise.resolve();
    expect(document.activeElement).toBe(mobile);
    expect(screen.getByRole("alert")).toBe(alert);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps every quote normalization error path to a rendered control or described group", async () => {
    const fieldErrors = {
      form: "Bad form.", quote: "Bad quote.", quoteNumber: "Bad number.", quoteDate: "Bad date.", defaultsSnapshot: "Bad defaults.",
      wall: "Bad wall.", ceiling: "Bad ceiling.", "wall.areaSqm": "Bad wall area.", "wall.rateCentsPerSqm": "Bad wall rate.",
      "wall.cavityDepthCm": "Bad depth.", "ceiling.areaSqm": "Bad ceiling area.", "ceiling.rateCentsPerSqm": "Bad ceiling rate.",
      "ceiling.rValue": "Bad R-value.", "ceiling.downlights": "Bad downlights.",
      extras: "Bad extras.", "extras.0": "Bad extra shape.", "extras.0.id": "Bad extra id.",
      "extras.0.name": "Bad extra name.", "extras.0.priceCents": "Bad extra price.", comments: "Bad comments.",
    };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Check fields.", fieldErrors }), { status: 400, headers: { "content-type": "application/json" } }));
    const user = userEvent.setup();
    render(<PartnerDraftForm initialJob={job(0)} recoveryScope="northwind-scope" />);
    await user.click(screen.getByLabelText("Wall insulation"));
    await user.click(screen.getByLabelText("Ceiling insulation"));
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    await screen.findByText("Check fields.");
    const targets: Record<string, string> = {
      form: "partner-draft-form", quote: "quote-details", quoteNumber: "quote-details", quoteDate: "quote-details", defaultsSnapshot: "quote-details",
      wall: "draft-wall", ceiling: "draft-ceiling", "wall.areaSqm": "draft-wall-areaSqm", "wall.rateCentsPerSqm": "draft-wall-rateCentsPerSqm",
      "wall.cavityDepthCm": "draft-wall-cavityDepthCm", "ceiling.areaSqm": "draft-ceiling-areaSqm", "ceiling.rateCentsPerSqm": "draft-ceiling-rateCentsPerSqm",
      "ceiling.rValue": "draft-ceiling-rValue", "ceiling.downlights": "draft-ceiling-downlights",
      extras: "draft-extras", "extras.0": "draft-extras-0", "extras.0.id": "draft-extras-0",
      "extras.0.name": "draft-extras-0-name", "extras.0.priceCents": "draft-extras-0-priceCents", comments: "draft-comments",
    };
    for (const [path, targetId] of Object.entries(targets)) {
      const target = document.getElementById(targetId)!;
      expect(target, `${path} target`).toBeTruthy();
      expect(target.getAttribute("aria-describedby"), `${path} description`).toContain(`draft-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}-error`);
      expect(document.getElementById(`draft-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}-error`), `${path} inline error`).toBeTruthy();
    }
    for (const label of [/Draft: Bad form/, /Quote: Bad quote/, /Quote number: Bad number/, /Quote date: Bad date/, /Quote defaults: Bad defaults/, /Extra 1 id: Bad extra id/]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  it("keeps lead and quote inputs without section navigation or readiness panels", async () => {
    const user = userEvent.setup();
    render(<PartnerDraftForm recoveryScope="northwind-scope" initialQuote={pricedQuote} />);
    expect(screen.queryByRole("navigation", { name: "Draft sections" })).toBeNull();
    expect(screen.queryByText("Your lead and quote save automatically. Complete your floor plans, then submit.")).toBeNull();
    await user.click(screen.getByLabelText("Wall insulation"));
    await user.click(screen.getByLabelText("Ceiling insulation"));
    expect(screen.queryByText("Submission readiness")).toBeNull();
  });

  it("keeps quote recovery in the authenticated scope and handles session expiry", async () => {
    const user = userEvent.setup(); const first = render(<PartnerDraftForm recoveryScope="northwind-scope" initialQuote={pricedQuote} />);
    await user.click(screen.getByLabelText("Ceiling insulation"));
    await user.type(screen.getByLabelText("R-value"), "3.6");
    await waitFor(() => expect(sessionStorage.getItem(draftRecoveryKey("northwind-scope", "new"))).toContain('"rValue":3.6'));
    first.unmount();
    render(<PartnerDraftForm recoveryScope="harbour-scope" initialQuote={createQuoteDraft({ ...PRODUCT_QUOTE_DEFAULTS, ceilingRateCents: 14500 })} />);
    expect(screen.getByLabelText("Ceiling insulation")).toHaveProperty("checked", false);
    cleanup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401, headers: { "content-type": "application/json" } }));
    render(<PartnerDraftForm recoveryScope="fresh-scope" initialQuote={pricedQuote} />);
    await user.type(screen.getByLabelText("Customer name"), "Fictional");
    fireEvent.submit(screen.getByLabelText("Customer name").closest("form")!);
    expect(await screen.findByText(/session expired before this draft/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe("/partner/login?reason=session-expired");
  });
});
