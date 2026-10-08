// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import Connections from "../../app/jobs/finance/connections/page";
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) || null,
    setItem: (k: string, v: string) => store.set(k, v),
    clear: () => store.clear(),
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
it("shows sign-in requirement without making finance requests", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<Connections />);
  await screen.findByText("Sign in to Insulhub to continue.");
  expect(fetcher).not.toHaveBeenCalled();
});
it("stops before source data for an unpinned identity", async () => {
  localStorage.setItem("token", "session");
  const fetcher = vi.fn(async () =>
    Response.json({ userId: "verified-id", ownerPinned: false }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<Connections />);
  await screen.findByText("Owner verification required");
  expect(screen.getByText("verified-id")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("renders restricted access without financial cards", async () => {
  localStorage.setItem("token", "other");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "Finance access is restricted to the owner." },
        { status: 403 },
      ),
    ),
  );
  render(<Connections />);
  await screen.findByText("Finance access is restricted to the owner.");
  expect(screen.queryByText("Bank cash")).toBeNull();
});
it("labels stale data and source failure rather than showing a zero balance", async () => {
  localStorage.setItem("token", "session");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).includes("/identity"))
        return Response.json({ userId: "owner", ownerPinned: true });
      if (String(url).includes("/organisation"))
        return Response.json({ error: "Not connected" }, { status: 409 });
      return Response.json({
        bank: {
          status: "unavailable",
          error: "Bank disconnected",
          checkedAt: "2026-09-27T00:00:00Z",
        },
        crm: {
          status: "unavailable",
          error: "CRM unavailable",
          checkedAt: "2026-09-27T00:00:00Z",
        },
        xero: {
          status: "unavailable",
          error: "Connect Xero",
          checkedAt: "2026-09-27T00:00:00Z",
        },
      });
    }),
  );
  render(<Connections />);
  await waitFor(() =>
    expect(screen.getByText("Bank disconnected")).toBeTruthy(),
  );
  expect(screen.queryByText("$0.00")).toBeNull();
});
