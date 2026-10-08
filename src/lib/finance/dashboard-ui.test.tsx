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
    label: "Visa Business",
    amount: "-$3,585.30",
    net: "$8,407.87",
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
    label: "Visa Business · in credit",
    amount: "+$123.45",
    net: "$12,116.62",
  },
  {
    creditCard: { error: "Card unavailable" },
    label: "Credit card",
    amount: "Unavailable",
    net: "Unavailable",
  },
])(
  "shows signed card component and combined cash without changing filtered detail: $label $amount",
  async ({ creditCard, label, amount, net }) => {
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
    expect(screen.getAllByText(amount).length).toBeGreaterThan(0);
    expect(screen.getAllByText(net).length).toBeGreaterThan(0);
    expect(screen.getByText("Bank less credit card")).toBeTruthy();
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
it("shows a pending invoice separately from the amount to collect and leaves bank cash unchanged", async () => {
  localStorage.setItem("token", "test-session");
  const data = calculateFinance(
    {
      creditCard: {
        name: "Visa",
        currentCents: -10000,
        owedCents: 10000,
        creditCents: 0,
        balanceUpdatedAt: "2026-09-29T09:26:00Z",
        stale: false,
      },
      checkedAt: "2026-09-29T10:00:00Z",
      recentBankChecked: true,
      bank: {
        accountName: "Trading",
        currentCents: 1988521,
        balanceUpdatedAt: "2026-09-29T09:26:00Z",
        transactionsUpdatedAt: "2026-09-29T09:26:00Z",
        stale: false,
      },
      historyStart: "2026-09-22",
      historyEnd: "2026-09-29",
      jobs: [
        {
          id: "j",
          number: "28218",
          quote: "AP28218",
          status: "INSTALLED_AS_QUOTED",
          archived: false,
          name: "55 Owen Street",
          invoiceNumbers: [],
        },
      ],
      invoices: [
        {
          id: "i",
          number: "INV-0445",
          reference: "AP28218",
          contact: "Kimberly Da Silva",
          date: "2026-09-21",
          dueDate: "2026-09-29",
          status: "AUTHORISED",
          currency: "NZD",
          total: 333825,
          paid: 0,
          due: 333825,
          credited: 0,
          description: "Installation",
        },
      ],
      payments: [],
      receipts: [],
      warnings: [],
      pendingBank: {
        receipts: [
          {
            date: "2026-09-28T20:44:29Z",
            amount: 333825,
            description: "Da Silva K Inv 0445 Kdasilva",
            updatedAt: "2026-09-29T09:26:41Z",
          },
        ],
      },
    },
    [],
  );
  const unfinished = {
    ...data.rows[0].job!,
    id: "unfinished",
    status: "JOB_NOT_STARTED_YET",
  };
  data.rows.push({
    ...data.rows[0],
    id: "deposit",
    number: "INV-DEPOSIT",
    job: unfinished,
    paid: 10000,
    due: 0,
    reserved: 10000,
    owed: 0,
    pendingSettlement: 0,
    pendingEvidence: [],
  });
  data.rows.push({
    ...data.rows[0],
    id: "unpaid-future",
    number: "INV-FUTURE",
    job: unfinished,
    reserved: 0,
    owed: 0,
    pendingSettlement: 0,
    pendingEvidence: [],
  });
  data.reserved = 10000;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...data,
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
  await screen.findByText(
    /Already factors in \$3,338.25 in payments received, awaiting reconciliation/,
  );
  expect(screen.queryByText("Unpaid in Xero")).toBeNull();
  expect(screen.queryByText(/Kimberly Da Silva · INV-0445:/)).toBeNull();
  expect(screen.getByText("$19,885.21")).toBeTruthy();
  expect(screen.getByText("Net position")).toBeTruthy();
  expect(screen.getByText("$19,685.21")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: /Owed for completed jobs: \$0.00/ }),
  );
  expect(screen.getByText("Unpaid in Xero")).toBeTruthy();
  expect(screen.getByText("−$3,338.25")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Less: pending bank settlement" }),
  );
  expect(
    screen
      .getByRole("tab", { name: "Pending settlement" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByText("INV-0445")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: /Deposits held for work to do: \$100.00/,
    }),
  );
  expect(screen.queryByText("INV-0445")).toBeNull();
  expect(screen.getByText("INV-DEPOSIT")).toBeTruthy();
  expect(screen.queryByText("INV-FUTURE")).toBeNull();
  expect(
    screen.getByText(/1 invoice · \$100.00 held for work to do/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search financial records"), {
    target: { value: "no such invoice" },
  });
  expect(screen.queryByText("INV-DEPOSIT")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: /Owed for completed jobs: \$0.00/,
    }),
  );
  expect(
    screen
      .getByRole("tab", { name: "To collect" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen.getByText("Payment received — awaiting settlement"),
  ).toBeTruthy();
});
it("adds uninvoiced completed work to net and opens a searchable job breakdown", async () => {
  localStorage.setItem("token", "test-session");
  const calculated = calculateFinance(
    {
      checkedAt: "2026-10-04T07:00:00Z",
      bank: {
        currentCents: 100000,
        balanceUpdatedAt: "2026-10-04",
        transactionsUpdatedAt: "2026-10-04",
        stale: false,
        accountName: "Trading",
      },
      creditCard: {
        name: "Visa",
        currentCents: 0,
        owedCents: 0,
        creditCents: 0,
        stale: false,
        balanceUpdatedAt: "2026-10-04",
      },
      pendingBank: { receipts: [] },
      historyStart: "",
      historyEnd: "",
      jobs: [
        {
          id: "j",
          number: "28697",
          quote: "BW28697",
          name: "44 Watt Street",
          contact: "Alan Mirza",
          archived: false,
          status: "INSTALLED_AS_QUOTED",
          invoiceNumbers: [],
          installDate: "2026-10-01T19:00:00Z",
          quoteCents: 222525,
          finalInvoiceChecked: true,
          finalInvoiceNumber: null,
        },
      ],
      invoices: [],
      receipts: [],
      payments: [],
      warnings: [],
    },
    [],
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...calculated,
        jobs: [],
        decisions: [],
        history: [],
        staleDecisions: [],
        fingerprints: {},
        payments: [],
      }),
    ),
  );
  render(<Page />);
  const button = await screen.findByRole("button", {
    name: /Owed for completed jobs: \$2,225.25/,
  });
  expect(screen.getByText("$3,225.25")).toBeTruthy();
  fireEvent.click(button);
  expect(screen.getByText("Plus: work awaiting invoice")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /1 job needs invoicing/ }));
  expect(screen.getByRole("link", { name: "Alan Mirza" })).toBeTruthy();
  expect(screen.getByText("44 Watt Street")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search financial records"), {
    target: { value: "absent" },
  });
  expect(screen.queryByRole("link", { name: "Alan Mirza" })).toBeNull();
  expect(screen.getByText("$3,225.25")).toBeTruthy();
});
