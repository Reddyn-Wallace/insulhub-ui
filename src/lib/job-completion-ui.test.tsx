// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({ push: vi.fn(), job: {} as any, planning: {} as any, confirmation: null as any, failConsent: false, calls: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => state, useParams: () => ({ id: "69ea7a15a5185b0a06d7615e" }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/graphql", () => ({ gql: vi.fn(async (query: string, variables: any) => {
  if (query.includes("mutation UpdateCouncilConsent")) {
    state.calls.push("consent");
    if (state.failConsent) throw new Error("Consent save failed");
    state.job = { ...state.job, council: { ...state.job.council, ...variables.input.council } };
    return { updateJob: state.job };
  }
  if (query.includes("mutation CreateFinalInvoices")) throw new Error("Xero API request failed: Unauthorized");
  if (query.includes("mutation SendCertificate")) { state.calls.push("send"); return {}; }
  return { job: state.job, users: { results: [] } };
}) }));
import JobPage from "@/app/jobs/[id]/page";
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "token" ? "test" : null });
  sessionStorage.clear();
  state.calls = []; state.failConsent = false; state.confirmation = null;
  state.planning = { status: "confirmed", note: "", installScope: "external", councilApprovalNA: false };
  state.job = { _id: "69ea7a15a5185b0a06d7615e", jobNumber: 123, stage: "INSTALLATION", updatedAt: "2026-09-18", installation: { installDate: "2026-07-23" }, council: { _id: "council" }, client: { contactDetails: { name: "Test owner" } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("manual-invoice")) {
      if (options?.method === "POST") { state.calls.push("manual"); state.confirmation = { reference: JSON.parse(options.body as string).reference, confirmedAt: "2026-09-18", confirmedBy: "user", confirmedByName: "Sam" }; }
      return Response.json({ confirmation: state.confirmation });
    }
    if (url.includes("install-planning")) {
      if (options?.method === "PUT") { state.calls.push("planning"); state.planning = { ...state.planning, ...JSON.parse(options.body as string) }; return Response.json({ planning: state.planning }); }
      return Response.json({ planning: [state.planning] });
    }
    return Response.json({ results: [], templates: [], senders: [], enabled: false });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("saves N/A on ticking the council exception and enables the completion pack with no council files", async () => {
  render(<JobPage />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /Council paperwork not required/ }));
  await waitFor(() => expect(state.job.council.consentNumber).toBe("N/A"));
  await waitFor(() => expect(state.planning.councilApprovalNA).toBe(true));
  expect(await screen.findByRole("button", { name: "Send completion pack" })).toBeTruthy();
  expect(screen.getByLabelText("Consent #")).toHaveProperty("value", "N/A");
  expect(state.calls.slice(0, 2)).toEqual(["consent", "planning"]);
});
it("repairs legacy checked jobs before sending, and sends nothing if N/A cannot be saved", async () => {
  state.planning.councilApprovalNA = true; state.failConsent = true;
  render(<JobPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Send completion pack" }));
  await waitFor(() => expect(state.calls).toContain("consent"));
  expect(state.calls).not.toContain("send");
});
it("persists N/A before sending for a legacy checked job", async () => {
  state.planning.councilApprovalNA = true;
  render(<JobPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Send completion pack" }));
  await waitFor(() => expect(state.calls).toContain("send"));
  expect(state.calls.indexOf("consent")).toBeLessThan(state.calls.indexOf("send"));
});
it("allows a confirmed manually sent invoice to unlock completion without a Xero record", async () => {
  state.job.certificateSentAt = "2026-08-03";
  render(<JobPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark invoice as sent manually" }));
  fireEvent.change(screen.getByLabelText("Invoice reference"), { target: { value: "MAN-20" } });
  expect(screen.getByRole("button", { name: "Save invoice confirmation" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this invoice has been sent/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save invoice confirmation" }));
  await waitFor(() => expect(state.confirmation?.reference).toBe("MAN-20"));
  expect(await screen.findByRole("button", { name: "Mark completed" })).toBeTruthy();
  expect(state.job.finalInvoice).toBeUndefined();
  expect(screen.getByText("Sent manually")).toBeTruthy();
});

it("unticking the exception clears N/A and restores document requirements", async () => {
  state.planning.councilApprovalNA = true;
  state.job.council.consentNumber = "N/A";
  render(<JobPage />);
  const toggle = await screen.findByRole("checkbox", { name: /Council paperwork not required/ });
  await waitFor(() => expect(toggle).toHaveProperty("checked", true));
  fireEvent.click(toggle);
  await waitFor(() => expect(state.planning.councilApprovalNA).toBe(false));
  await waitFor(() => expect(state.job.council.consentNumber).toBe(""));
  expect(screen.queryByRole("button", { name: "Send completion pack" })).toBeNull();
  expect(state.calls.slice(0, 2)).toEqual(["planning", "consent"]);
});
it("does not enable the exception when saving N/A fails", async () => {
  state.failConsent = true;
  render(<JobPage />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /Council paperwork not required/ }));
  await waitFor(() => expect(state.calls).toContain("consent"));
  expect(state.planning.councilApprovalNA).toBe(false);
  expect(state.calls).not.toContain("planning");
  expect(screen.queryByRole("button", { name: "Send completion pack" })).toBeNull();
});
it("loads an existing manual confirmation on return and keeps completion blocked until the pack is sent", async () => {
  state.confirmation = { reference: "MAN-20", confirmedAt: "2026-09-18", confirmedBy: "user", confirmedByName: "Sam" };
  render(<JobPage />);
  expect(await screen.findByText("Sent manually")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create final invoice" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Mark completed" })).toBeNull();
});
it("saves N/A before opening the certificate for an existing exempt job", async () => {
  state.planning.councilApprovalNA = true;
  const popup = { opener: {}, location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  render(<JobPage />);
  const download = await screen.findByRole("button", { name: "Download completion certificate" });
  await waitFor(() => expect(download).toHaveProperty("disabled", false));
  fireEvent.click(download);
  await waitFor(() => expect(popup.location.href).toContain("/pdf/certificate?"));
  expect(state.job.council.consentNumber).toBe("N/A");
  expect(popup.opener).toBeNull();
  vi.restoreAllMocks();
});

it("shows invoice failures inside the open confirmation sheet", async () => {
  render(<JobPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Create final invoice" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Create final invoice" })[1]);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Xero API request failed: Unauthorized");
  expect(screen.getByRole("heading", { name: "Create Final Invoice in Xero" })).toBeTruthy();
});
