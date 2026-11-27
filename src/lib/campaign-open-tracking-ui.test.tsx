// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CampaignPage from "@/app/jobs/campaigns/[id]/page";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "campaign" }), useRouter: () => router }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const gmailSender = { id: "sender", provider: "gmail", isActive: true, label: "Gmail", channel: "email" };
const campaign = {
  id: "campaign", name: "November quotes", channel: "email", senderId: "sender",
  senderLabel: "Gmail", messageSubject: "Your quote", messageBody: "Hello",
};

it("shows unique opens, supports both sorts and filters, and reloads tracking through GET", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "token" });
  const recent = { likelyCount: 1, lastLikelyAt: "2026-11-27T02:00:00Z", ambiguousSeen: false };
  const old = { likelyCount: 3, lastLikelyAt: "2026-11-26T02:00:00Z", ambiguousSeen: true };
  let latestOpen: typeof recent | null = null;
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.includes("communication-senders") ? { senders: [gmailSender] } :
      url.includes("communication-settings") ? {} : {
        campaign: { ...campaign, status: "sent" },
        recipients: [
          { id: "1", status: "sent", jobId: "aroha-job", jobNumber: 545, contactName: "Aroha", destination: "aroha@example.com", openTracking: old },
          { id: "2", status: "sent", contactName: "Blake", destination: "blake@example.com", openTracking: recent },
          { id: "3", status: "sent", contactName: "Charlie", destination: "charlie@example.com", openTracking: { likelyCount: 0, ambiguousSeen: true } },
          { id: "4", status: "sent", contactName: "Dani", destination: "dani@example.com", openTracking: latestOpen },
          { id: "5", status: "sent", contactName: "Eli", destination: "eli@example.com", openTracking: { likelyCount: 0 } },
        ],
      },
  }));
  vi.stubGlobal("fetch", fetcher);

  render(<CampaignPage />);
  expect(await screen.findByRole("heading", { name: "2 of 4 tracked recipients opened · 4 opens recorded" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Opened (2)" }));
  const table = screen.getByRole("table");
  const arohaRow = within(table).getByRole("row", { name: /Aroha/ });
  expect(within(arohaRow).getByRole("link", { name: "Aroha" }).getAttribute("href")).toBe("/jobs/aroha-job");
  expect(within(arohaRow).queryByText("#545")).toBeNull();
  expect(within(table).queryByText("Charlie")).toBeNull();
  expect(within(table).getAllByRole("row")[1].textContent).toContain("Blake");
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "count" } });
  expect(within(table).getAllByRole("row")[1].textContent).toContain("Aroha");
  fireEvent.click(screen.getByRole("button", { name: "Repeat opens (1)" }));
  expect(within(table).queryByText("Blake")).toBeNull();
  fireEvent.click(within(arohaRow).getByRole("button", { name: "View" }));
  expect(screen.getByText(/3 opens recorded · Last detected/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Likely unopened (2)" }));
  expect(within(table).getByText("Charlie")).toBeTruthy();
  expect(within(table).getByText("Eli")).toBeTruthy();
  expect(within(table).queryByText("Dani")).toBeNull();

  latestOpen = recent;
  fireEvent.click(screen.getByRole("button", { name: "Refresh opens" }));
  expect(await screen.findByRole("heading", { name: "3 of 5 tracked recipients opened · 5 opens recorded" })).toBeTruthy();
  expect(within(table).queryByText("Dani")).toBeNull();
});

it("queues a Gmail campaign without a tracking switch or opt-in flag", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "token" });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => url.includes("communication-senders") ? { senders: [gmailSender] } :
      url.includes("communication-settings") ? {} : {
        campaign: { ...campaign, status: init?.method === "PATCH" ? "sent" : "draft" },
        recipients: [{ id: "1", status: init?.method === "PATCH" ? "sent" : "pending", contactName: "Aroha", destination: "aroha@example.com" }],
      },
  }));
  vi.stubGlobal("fetch", fetcher);

  render(<CampaignPage />);
  const confirm = await screen.findByRole("button", { name: "Confirm Campaign" });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  expect(screen.queryByRole("checkbox", { name: "Track email opens" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Queue Campaign" }));
  await screen.findByRole("heading", { name: "Delivery Records" });
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ sendCampaign: true });
});

it("automatically saves the selected sender, gates confirmation while saving, and restores the saved sender on failure", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "token" });
  const another = { ...gmailSender, id: "another", label: "Office Gmail", senderValue: "office@example.com" };
  const draft = { ...campaign, status: "draft" };
  let finishSave: (response: Response) => void = () => {};
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("communication-senders")) return Response.json({ senders: [gmailSender, another] });
    if (url.includes("communication-settings")) return Response.json({});
    if (init?.method === "PATCH") return new Promise<Response>(resolve => { finishSave = resolve; });
    return Response.json({ campaign: draft, recipients: [{ id: "1", status: "pending", destination: "lead@example.com" }] });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<CampaignPage />);
  const sender = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Campaign sender" });
  const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Confirm Campaign" });
  await waitFor(() => expect(confirm.disabled).toBe(false));

  fireEvent.change(sender, { target: { value: "another" } });
  expect(screen.queryByRole("button", { name: "Save Sender" })).toBeNull();
  expect(confirm.disabled).toBe(true);
  expect(sender.disabled).toBe(true);
  expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body))).toEqual({ senderId: "another" });
  finishSave(Response.json({ error: "Sender could not be saved" }, { status: 503 }));
  await screen.findByText("Sender could not be saved");
  expect(sender.value).toBe(gmailSender.id);

  fireEvent.change(sender, { target: { value: "another" } });
  finishSave(Response.json({ campaign: { ...draft, senderId: another.id, senderLabel: another.label } }));
  await screen.findByText("Saved sender: Office Gmail");
  expect(sender.value).toBe(another.id);
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  expect(screen.getAllByText("Office Gmail").length).toBeGreaterThan(0);
});
