// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QuoteHistory from "@/components/QuoteHistory";
import type { QuoteEvent, QuoteHistory as History } from "./model";
import type { QuoteVersion } from "./versions";

const baseline: QuoteEvent = {
  id: "1", kind: "baseline", revision: 1, actor: null, at: "2026-11-27T01:00:00Z", total: 6900, changes: [],
};
const send: QuoteEvent = { ...baseline, id: "2", kind: "send", actor: "Andrew" };

const current: QuoteVersion = {
  latest: 2, revision: 2, at: "2026-11-27T03:00:00Z", actor: "Olivia", observed: false, reconstructed: false,
  values: { fields: { c_total: "$6,900.00", "wall.SQM": "92 m²", "ceiling.SQM": "—", c_gst: "$900.00" }, extras: [] },
};
const older: QuoteVersion = {
  ...current, revision: 1, reconstructed: true, observed: true, actor: null,
  values: { fields: { c_total: "$6,900.00", "wall.SQM": "80 m²", "ceiling.SQM": "—", c_gst: "—" }, extras: [] },
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

it("opens current and reconstructed read-only versions even when the total is unchanged", async () => {
  let result: History = { revision: 1, events: [baseline], lastSend: null, changedSinceSend: false, next: null, pending: false };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("version=latest")) return Response.json(current);
    if (url.includes("version=1")) return Response.json(older);
    return Response.json(result);
  }));
  const view = render(quoteCard());
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Quote versions" })).toBeNull();

  result = { ...result, revision: 2, events: [send, baseline], lastSend: send, changedSinceSend: true };
  view.rerender(quoteCard("2"));
  const trigger = await screen.findByRole("button", { name: "Quote versions" });
  expect(within(screen.getByRole("banner")).getByRole("button", { name: "Quote versions" })).toBe(trigger);
  expect(screen.queryByRole("region", { name: "Quote versions" })).toBeNull();
  expect(screen.getByText(/last send acknowledged/i).textContent).toContain("$6,900.00");
  expect(screen.getByText(/saved quote changed since/)).toBeTruthy();

  fireEvent.click(trigger);
  const panel = within(screen.getByRole("region", { name: "Quote versions" }));
  expect(await panel.findByText("92 m²")).toBeTruthy();
  expect(panel.getByText("Version 2 of 2")).toBeTruthy();
  expect(panel.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(true);
  fireEvent.click(panel.getByRole("button", { name: "Previous" }));
  expect(await panel.findByText("80 m²")).toBeTruthy();
  expect(panel.getByText("Version 1 of 2")).toBeTruthy();
  expect(panel.getByText("Reconstructed from edit history")).toBeTruthy();
  expect(panel.getByRole<HTMLButtonElement>("button", { name: "Previous" }).disabled).toBe(true);
  fireEvent.click(panel.getByRole("button", { name: "Next" }));
  expect(await panel.findByText("92 m²")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide versions" }));
  expect(screen.queryByRole("region", { name: "Quote versions" })).toBeNull();
});

it("keeps the link hidden when a quote has only been sent or accepted", async () => {
  const accepted: QuoteEvent = { ...baseline, id: "3", kind: "accepted" };
  const result: History = { revision: 1, events: [accepted, send, baseline], lastSend: send, changedSinceSend: false, next: null, pending: false };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(result)));
  render(quoteCard());
  expect(await screen.findByText(/Last send acknowledged/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Quote versions" })).toBeNull();
});

it("uses the legacy email-log match when history is disabled", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  render(quoteCard("1", "2026-11-27T01:00:00Z"));
  expect(await screen.findByText(/email log match/iu)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Quote versions" })).toBeNull();
});
