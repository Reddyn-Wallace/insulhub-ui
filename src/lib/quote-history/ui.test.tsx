// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QuoteHistory from "@/components/QuoteHistory";
import type { QuoteEvent, QuoteHistory as History } from "./model";

const baseline: QuoteEvent = {
  id: "1", kind: "baseline", revision: 1, actor: null, at: "2026-11-27T01:00:00Z", total: 6900, changes: [],
};
const send: QuoteEvent = { ...baseline, id: "2", kind: "send", actor: "Andrew" };
const edit: QuoteEvent = {
  ...baseline, id: "3", kind: "edit", revision: 2, actor: "Olivia", at: "2026-11-27T03:00:00Z",
  changes: [{ label: "Wall area", before: "80 m²", after: "92 m²" }],
};

function quoteCard(refreshKey = "1", legacySentAt: string | null = null) {
  return (
    <QuoteHistory jobId="quote" refreshKey={refreshKey} legacySentAt={legacySentAt}>
      {(trigger, content) => <><header>{trigger}<button>Edit</button></header>{content}</>}
    </QuoteHistory>
  );
}

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => "test-token" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the header link only after a saved change and opens its field details even when the total is unchanged", async () => {
  let result: History = { revision: 1, events: [baseline], lastSend: null, changedSinceSend: false, next: null, pending: false };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(result)));
  const view = render(quoteCard());
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "View changes" })).toBeNull();
  expect(screen.queryByText(/Revision 1/)).toBeNull();

  result = { ...result, revision: 2, events: [edit, send, baseline], lastSend: send, changedSinceSend: true };
  view.rerender(quoteCard("2"));
  const toggle = await screen.findByRole("button", { name: "View changes" });
  expect(within(screen.getByRole("banner")).getByRole("button", { name: "View changes" })).toBe(toggle);
  expect(screen.queryByRole("region", { name: "Quote history" })).toBeNull();
  expect(screen.getByText(/last send acknowledged/i).textContent).toContain("$6,900.00");
  expect(screen.getByText(/saved quote changed since/)).toBeTruthy();

  fireEvent.click(toggle);
  const panel = screen.getByRole("region", { name: "Quote history" });
  expect(within(panel).getByText("Quote edited by Olivia")).toBeTruthy();
  expect(within(panel).getByText("80 m²").closest("details")?.open).toBe(true);
  expect(within(panel).getByText("92 m²")).toBeTruthy();
  expect(within(panel).getByText(/attachment and delivery are unverified/)).toBeTruthy();
  expect(within(panel).queryByText(/starting quote recorded/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hide changes" }));
  expect(screen.queryByRole("region", { name: "Quote history" })).toBeNull();
});

it("keeps the link hidden when a quote has only been sent or accepted", async () => {
  const accepted: QuoteEvent = {
    ...baseline, id: "4", kind: "accepted", actor: "Olivia",
    changes: [{ label: "Quote status", before: "Open", after: "Accepted" }],
  };
  const result: History = { revision: 1, events: [accepted, send, baseline], lastSend: send, changedSinceSend: false, next: null, pending: false };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(result)));
  render(quoteCard());
  expect(await screen.findByText(/Last send acknowledged/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "View changes" })).toBeNull();
  expect(screen.queryByText(/Revision 1/)).toBeNull();
});

it("still offers history when the field change is on an older page", async () => {
  const recentSend = { ...send, id: "4", revision: 2 };
  const result: History = { revision: 2, events: [recentSend], lastSend: recentSend, changedSinceSend: false, next: "4", pending: false };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("?before=")
    ? { ...result, next: null, events: [edit, baseline] }
    : result)));
  render(quoteCard());
  fireEvent.click(await screen.findByRole("button", { name: "View changes" }));
  const older = await screen.findByRole("button", { name: "Load older events" });
  await act(async () => { fireEvent.click(older); });
  expect(await screen.findByText("Quote edited by Olivia")).toBeTruthy();
});

it("uses the legacy email-log match when history is disabled", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  render(quoteCard("1", "2026-11-27T01:00:00Z"));
  expect(await screen.findByText(/email log match/iu)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "View changes" })).toBeNull();
});
