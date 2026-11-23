// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const view = vi.hoisted(() => ({
  params: new URLSearchParams("stage=QUOTE&subTab=OPEN"),
  replace: vi.fn(),
  push: vi.fn(),
  gql: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => view.params, useRouter: () => view }));
vi.mock("@/lib/graphql", () => ({ gql: view.gql }));
vi.mock("@/lib/dead-followups/queue-cache", () => ({ fetchQueue: vi.fn(() => new Promise(() => {})) }));

import JobsPage from "@/app/jobs/page";
import { CrmReadAccessDenied, CrmReadUnavailable } from "./session";
import { QuoteSelectionChanged, readQuoteContacts } from "./quotes";

const numbers = Array.from({ length: 1002 }, (_, index) => ({
  _id: `quote-${index}`, jobNumber: index, stage: "QUOTE", updatedAt: "2026-11-12",
  lead: { leadStatus: index < 2 ? "NEW" : "DEAD", allocatedTo: { _id: `staff-${index % 2}` } },
  quote: { date: "2026-11-12", c_total: 1000 },
}));

let sessionNumber = 0;
beforeEach(() => {
  const values = new Map([["token", `sales-user-${++sessionNumber}`]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  sessionStorage.clear();
  view.params = new URLSearchParams("stage=QUOTE&subTab=OPEN");
  view.replace.mockImplementation((href: string) => { view.params = new URL(href, "https://example.test").searchParams; });
  view.gql.mockImplementation(async (query: string, variables: Record<string, string>) => {
    if (query.includes("query QuoteCardDetails")) {
      return Object.fromEntries(Object.entries(variables).map(([key, id]) => [
        key.replace("quote", "card"),
        { _id: id, stage: "QUOTE", updatedAt: "2026-11-12", quote: { quoteNumber: `TEST-${id}`, c_total: 123.45 },
          client: { contactDetails: { name: `Customer ${id}` } } },
      ]));
    }
    return { jobs: { total: numbers.length, results: numbers } };
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("preserves the full quote counts while reading contacts for just the visible page", async () => {
  const page = render(<JobsPage />);
  expect(await screen.findByText("Customer quote-0")).toBeTruthy();
  expect(screen.getByText(/#TEST-quote-0 \$123\.45/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Open\s*\(2\)/ })).toBeTruthy();
  const dead = screen.getByRole("button", { name: /^Dead\s*\(1000\)/ });
  const contactReads = () => view.gql.mock.calls.filter(([query]) => query.includes("query QuoteCardDetails"));
  expect(Object.values(contactReads()[0][1])).toEqual(["quote-0", "quote-1"]);

  fireEvent.click(dead);
  page.rerender(<JobsPage />);
  expect(await screen.findByText("Customer quote-41")).toBeTruthy();
  expect(screen.queryByText("Customer quote-42")).toBeNull();
  expect(screen.queryByText("Customer quote-0")).toBeNull();
  expect(contactReads().slice(1).flatMap(([, variables]) => Object.values(variables))).toHaveLength(40);
  expect(view.gql.mock.calls.filter(([query]) => query.includes("query Jobs"))).toHaveLength(1);
});

it("uses salesperson filters before it reads the displayed quote contacts", async () => {
  view.params.append("salesperson", "staff-1");
  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
  expect(screen.queryByText("Customer quote-0")).toBeNull();
  const [, variables] = view.gql.mock.calls.find(([query]) => query.includes("query QuoteCardDetails"))!;
  expect(variables).toEqual({ quote0: "quote-1" });
});

it("refreshes the list if a quote moves before its contact is read", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  let reads = 0;
  view.gql.mockImplementation(async (query: string, variables: Record<string, string>) => {
    if (query.includes("query Jobs") && ++reads > 1) {
      return { jobs: { total: numbers.length - 1, results: numbers.slice(1) } };
    }
    const data = await originalFetch(query, variables);
    if (query.includes("query QuoteCardDetails") && variables.quote0 === "quote-0") {
      data.card0.stage = "INSTALLATION";
    }
    return data;
  });
  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Open\s*\(1\)/ })).toBeTruthy();
  expect(screen.queryByText("Customer quote-0")).toBeNull();
  expect(reads).toBe(2);
});

it("shows a sent badge as soon as the customer's send is found", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  const email = "customer@example.test";
  let releaseHistory!: (data: unknown) => void;
  view.gql.mockImplementation(async (query: string, variables: Record<string, string | number>) => {
    if (query.includes("query EmailLogs")) {
      if (variables.skip === 0) {
        return { listEmailLogs: { total: 2, results: [{ _id: "quote-log", to_email: email, type: "quote", createdAt: "2026-11-20T02:00:00Z" }] } };
      }
      return new Promise(resolve => { releaseHistory = resolve; });
    }
    const data = await originalFetch(query, variables);
    if (query.includes("query QuoteCardDetails")) data.card0.client.contactDetails.email = email;
    return data;
  });

  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-0")).toBeTruthy();
  expect(await screen.findByText(/^Sent at /)).toBeTruthy();
  expect(releaseHistory).toBeTypeOf("function");
  releaseHistory({ listEmailLogs: { total: 2, results: [{ _id: "other-log", type: "unrelated", createdAt: "2026-11-01" }] } });
});

it("shows verified Open cards during the full scan and reconciles any missing cards", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  let finishBoard!: (data: unknown) => void;
  view.gql.mockImplementation(async (query: string, variables: Record<string, string>) => {
    if (query.includes("query QuoteFirstPageCheck")) {
      return { jobs: { total: 1, results: [{ ...numbers[0], client: { contactDetails: { name: "Customer quote-0" } } }] } };
    }
    if (query.includes("query Jobs")) return new Promise(resolve => { finishBoard = resolve; });
    return originalFetch(query, variables);
  });
  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-0")).toBeTruthy();
  expect(screen.getByText("Checking for more open quotes…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Open\s*\(1\)/ })).toBeNull();

  finishBoard({ jobs: { total: numbers.length, results: numbers } });
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Open\s*\(2\)/ })).toBeTruthy();
  expect(screen.queryByText("Checking for more open quotes…")).toBeNull();
});

it("keeps matching Open cards visible while retrying a temporary card failure", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  let finishBoard!: (data: unknown) => void;
  let finishCards!: (data: unknown) => void;
  let cardReads = 0;
  view.gql.mockImplementation(async (query, variables) => {
    if (query.includes("query QuoteFirstPageCheck")) {
      return { jobs: { total: 1, results: [{ ...numbers[0], client: { contactDetails: { name: "Customer quote-0" } } }] } };
    }
    if (query.includes("query Jobs")) return new Promise(resolve => { finishBoard = resolve; });
    if (query.includes("query QuoteCardDetails")) {
      if (++cardReads === 1) throw new CrmReadUnavailable("Temporary failure.");
      const data = await originalFetch(query, variables);
      return new Promise(resolve => { finishCards = () => resolve(data); });
    }
    return originalFetch(query, variables);
  });
  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-0")).toBeTruthy();
  finishBoard({ jobs: { total: numbers.length, results: numbers } });
  await waitFor(() => expect(finishCards).toBeTypeOf("function"));
  expect(screen.getByText("Customer quote-0")).toBeTruthy();
  expect(await screen.findByText("Loading remaining quote details…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  finishCards(null);
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
  expect(cardReads).toBe(2);
});

it("surfaces a changed quote even if another card batch temporarily fails", async () => {
  view.gql.mockImplementation(async (_query, variables) => {
    const ids = Object.values(variables);
    if (ids.length > 1) throw new CrmReadUnavailable("Temporary failure.");
    return { card0: { _id: ids[0], stage: "INSTALLATION" } };
  });
  await expect(readQuoteContacts(numbers.slice(0, 21), localStorage.getItem("token")!)).rejects.toBeInstanceOf(QuoteSelectionChanged);
});

it("reports denied card access immediately while the other batch is still pending", async () => {
  const denial = new CrmReadAccessDenied("Access denied");
  view.gql.mockImplementation(async (_query, variables) => {
    if (Object.keys(variables).length > 1) return new Promise(() => {});
    throw denial;
  });
  await expect(readQuoteContacts(numbers.slice(0, 21), localStorage.getItem("token")!)).rejects.toBe(denial);
});

it("retries the missing card details without rescanning a verified board", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  let cardReads = 0;
  view.gql.mockImplementation(async (query, variables) => {
    if (query.includes("query QuoteCardDetails") && ++cardReads <= 2) {
      throw new CrmReadUnavailable("Temporary failure.");
    }
    return originalFetch(query, variables);
  });
  render(<JobsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
  expect(view.gql.mock.calls.filter(([query]) => query.includes("query Jobs"))).toHaveLength(1);
});

it("keeps filtered Opens on the full stage path", async () => {
  view.params.append("salesperson", "staff-1");
  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
  expect(view.gql.mock.calls.some(([query]) => query.includes("query QuoteFirstPageCheck"))).toBe(false);
  expect(view.gql.mock.calls.find(([query]) => query.includes("query Jobs"))?.[0]).toContain("allocatedTo { _id }");
});

it("starts verifying the complete list even while the first Open preview is waiting", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  view.gql.mockImplementation(async (query, variables) => {
    if (query.includes("query QuoteFirstPageCheck")) return new Promise(() => {});
    return originalFetch(query, variables);
  });
  render(<JobsPage />);
  await waitFor(() => {
    expect(view.gql.mock.calls.some(([query]) => query.includes("query Jobs"))).toBe(true);
  }, { timeout: 600 });
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
});

it("does not show a pending Open preview after a job changes", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  let finishPreview!: (data: unknown) => void;
  let finishList!: (data: unknown) => void;
  view.gql.mockImplementation(async (query: string, variables: Record<string, string>) => {
    if (query.includes("query QuoteFirstPageCheck")) return new Promise(resolve => { finishPreview = resolve; });
    if (query.includes("query Jobs")) return new Promise(resolve => { finishList = resolve; });
    return originalFetch(query, variables);
  });
  render(<JobsPage />);
  await waitFor(() => {
    expect(finishPreview).toBeTypeOf("function");
    expect(finishList).toBeTypeOf("function");
  }, { timeout: 2600 });
  localStorage.setItem("calendar-last-write", String(Date.now() + 1));
  finishPreview({ jobs: { total: 1, results: [{ ...numbers[0], client: { contactDetails: { name: "Outdated preview" } } }] } });
  finishList({ jobs: { total: numbers.length, results: numbers } });
  expect(await screen.findByText(/changed while loading/)).toBeTruthy();
  expect(screen.queryByText("Outdated preview")).toBeNull();
});

it("keeps verified Open cards available after the full list times out and while retrying", async () => {
  const originalFetch = view.gql.getMockImplementation()!;
  let rejectFirst!: (reason: Error) => void;
  let finishRetry!: (data: unknown) => void;
  let fullReads = 0;
  view.gql.mockImplementation(async (query: string, variables: Record<string, string>) => {
    if (query.includes("query QuoteFirstPageCheck")) {
      return { jobs: { total: 1, results: [{ ...numbers[0], client: { contactDetails: { name: "Customer quote-0" } } }] } };
    }
    if (query.includes("query Jobs")) {
      return new Promise((resolve, reject) => {
        if (++fullReads === 1) rejectFirst = reject;
        else finishRetry = resolve;
      });
    }
    return originalFetch(query, variables);
  });
  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-0")).toBeTruthy();
  await waitFor(() => expect(rejectFirst).toBeTypeOf("function"));
  rejectFirst(Error("signal timed out"));
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(screen.getByText("Customer quote-0")).toBeTruthy();
  expect(screen.getByText(/Couldn’t verify the full Open list/)).toBeTruthy();

  fireEvent.click(retry);
  await waitFor(() => expect(finishRetry).toBeTypeOf("function"));
  expect(screen.getByText("Customer quote-0")).toBeTruthy();
  finishRetry({ jobs: { total: numbers.length, results: numbers } });
  expect(await screen.findByText("Customer quote-1")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Open\s*\(2\)/ })).toBeTruthy();
});

it("removes preview cards after a confirmed denial even if the error message is generic", async () => {
  const { CrmReadAccessDenied } = await import("./session");
  const originalFetch = view.gql.getMockImplementation()!;
  let deny!: (reason: Error) => void;
  let retryReads = 0;
  view.gql.mockImplementation(async (query: string, variables: Record<string, string>) => {
    if (query.includes("query QuoteFirstPageCheck")) {
      return { jobs: { total: 1, results: [{ ...numbers[0], client: { contactDetails: { name: "Customer quote-0" } } }] } };
    }
    if (query.includes("query Jobs")) return new Promise((_, reject) => { if (++retryReads === 1) deny = reject; });
    return originalFetch(query, variables);
  });
  render(<JobsPage />);
  expect(await screen.findByText("Customer quote-0")).toBeTruthy();
  await waitFor(() => expect(deny).toBeTypeOf("function"));
  deny(new CrmReadAccessDenied("Request failed."));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(retryReads).toBe(2));
  expect(screen.queryByText("Customer quote-0")).toBeNull();
});
