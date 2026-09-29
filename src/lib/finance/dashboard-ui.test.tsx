// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import Page from "../../app/jobs/finance/page";
import { calculateFinance } from "./calculate";
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => values.set(k, v),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it.each([
  {
    creditCard: {
      name: "Visa Business",
      currentCents: -358530,
      owedCents: 358530,
      creditCents: 0,
      balanceUpdatedAt: "2026-09-29T06:47:00Z",
      stale: false,
    },
    label: "Credit card owed",
    amount: "$3,585.30",
  },
  {
    creditCard: {
      name: "Visa Business",
      currentCents: 12345,
      owedCents: 0,
      creditCents: 12345,
      balanceUpdatedAt: "2026-09-29T06:47:00Z",
      stale: false,
    },
    label: "Credit card · in credit",
    amount: "$123.45",
  },
  {
    creditCard: { error: "Card unavailable" },
    label: "Credit card owed",
    amount: "Unavailable",
  },
])(
  "keeps the credit card separate from cash and filtered detail: $label $amount",
  async ({ creditCard, label, amount }) => {
    localStorage.setItem("token", "test-session");
    const input = {
      creditCard,
      checkedAt: "2026-09-27T10:00:00Z",
      bank: {
        accountName: "Trading",
        currentCents: 1199317,
        balanceUpdatedAt: "2026-09-27T09:00:00Z",
        transactionsUpdatedAt: "2026-09-27T09:00:00Z",
        stale: false,
      },
      historyStart: "2024-09-27",
      historyEnd: "2026-09-27",
      jobs: [],
      invoices: [],
      payments: [],
      receipts: [
        {
          id: "r",
          date: "2026-09-27",
          amount: 10000,
          description: "Unidentified receipt",
          reference: "",
        },
      ],
      warnings: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...calculateFinance(input, []),
          jobs: [],
          decisions: [],
          staleDecisions: [],
          history: [],
          payments: [],
          fingerprints: {},
        }),
      ),
    );
    render(<Page />);
    await screen.findByText("Deposits held for work to do");
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(amount)).toBeTruthy();
    expect(screen.getByText("Owed for completed jobs")).toBeTruthy();
    expect(screen.queryByText("Bank less known deposits")).toBeNull();
    fireEvent.click(
      screen.getByText("View invoices and how these figures are worked out"),
    );
    expect(screen.getAllByText("$11,993.17").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Bank review" }));
    await screen.findByText("Unidentified receipt");
    fireEvent.change(screen.getByLabelText("Search financial records"), {
      target: { value: "no match" },
    });
    expect(screen.queryByText("Unidentified receipt")).toBeNull();
    expect(screen.getAllByText("$11,993.17").length).toBeGreaterThan(0);
  },
);
it("failed sources do not show invented zero totals", async () => {
  localStorage.setItem("token", "test-session");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "Xero unavailable" }, { status: 502 }),
    ),
  );
  render(<Page />);
  await screen.findByRole("alert");
  expect(screen.getByText("Xero unavailable")).toBeTruthy();
  expect(screen.queryByText("$0.00")).toBeNull();
});
it("a missing login does not request financial data", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<Page />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(fetcher).not.toHaveBeenCalled();
});
