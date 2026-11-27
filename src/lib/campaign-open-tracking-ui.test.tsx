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
  expect(await screen.findByRole("heading", { name: "2 likely opens of 4 tracked sends" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Likely opened (2)" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Tracking unavailable (1)" }));
  expect(within(table).getByText("Dani")).toBeTruthy();

  latestOpen = recent;
  fireEvent.click(screen.getByRole("button", { name: "Refresh opens" }));
  expect(await screen.findByRole("heading", { name: "3 likely opens of 5 tracked sends" })).toBeTruthy();
  expect(within(table).getByText("No recipients match this filter.")).toBeTruthy();
});

it("offers tracking as an opt-in on Gmail campaign confirmation", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "token" });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => url.includes("communication-senders") ? { senders: [gmailSender] } :
      url.includes("communication-settings") ? {} : {
        campaign: { ...campaign, status: init?.method === "PATCH" ? "sent" : "draft" },
        emailOpenTrackingAvailable: true,
        recipients: [{ id: "1", status: init?.method === "PATCH" ? "sent" : "pending", contactName: "Aroha", destination: "aroha@example.com" }],
      },
  }));
  vi.stubGlobal("fetch", fetcher);

  render(<CampaignPage />);
  const confirm = await screen.findByRole("button", { name: "Confirm Campaign" });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  const tracking = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Track email opens" });
  expect(tracking.checked).toBe(false);
  fireEvent.click(tracking);
  fireEvent.click(screen.getByRole("button", { name: "Queue Campaign" }));
  await screen.findByRole("heading", { name: "Delivery Records" });
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ sendCampaign: true, trackEmailOpens: true });
});
