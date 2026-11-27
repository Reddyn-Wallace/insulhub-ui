// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QuoteHistory from "@/components/QuoteHistory";
import type { QuoteEvent } from "./model";

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => "test-token" }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the acknowledged revision, alerts on subsequent edits and exposes field changes", async () => {
  const send: QuoteEvent = {
    id: "2", kind: "send", revision: 1, actor: "Andrew", at: "2026-11-27T01:00:00Z", total: 6900, changes: [],
  };
  const edit: QuoteEvent = {
    id: "3", kind: "edit", revision: 2, actor: "Olivia", at: "2026-11-27T03:00:00Z", total: 7590,
    changes: [{ label: "Wall area", before: "80 m²", after: "92 m²" }],
  };
  const result = { revision: 2, events: [edit, send], lastSend: send, changedSinceSend: true, next: null, pending: false };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(result)));
  render(<QuoteHistory jobId="quote" refreshKey="1" legacySentAt={null} />);
  const toggle = await screen.findByRole("button", { name: /Quote history/ });
  expect(screen.getByText(/last send acknowledged.+revision 1/i).textContent).toContain("$6,900.00");
  expect(screen.getByText(/saved quote changed since/)).toBeTruthy();
  fireEvent.click(toggle);
  expect(await screen.findByText("Quote edited by Olivia")).toBeTruthy();
  expect(screen.getByText("80 m²")).toBeTruthy();
  expect(screen.getByText("92 m²")).toBeTruthy();
  expect(screen.getByText(/attachment and delivery are unverified/)).toBeTruthy();
});

it("uses the legacy email-log match when history is disabled", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  render(<QuoteHistory jobId="quote" refreshKey="1" legacySentAt="2026-11-27T01:00:00Z" />);
  expect(await screen.findByText(/email log match/iu)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /quote history/iu })).toBeNull();
});
