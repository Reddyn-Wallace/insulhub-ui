// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

const numbers = Array.from({ length: 1002 }, (_, index) => ({
  _id: `quote-${index}`, jobNumber: index, stage: "QUOTE", updatedAt: "2026-11-12",
  lead: { leadStatus: index < 2 ? "NEW" : "DEAD", allocatedTo: { _id: `staff-${index % 2}` } },
  quote: { date: "2026-11-12", c_total: 1000 },
}));

beforeEach(() => {
  const values = new Map([["token", "sales-user"]]);
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
        { _id: id, stage: "QUOTE", updatedAt: "2026-11-12", client: { contactDetails: { name: `Customer ${id}` } } },
      ]));
    }
    return { jobs: { total: numbers.length, results: numbers } };
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("preserves the full quote counts while reading contacts for just the visible page", async () => {
  const page = render(<JobsPage />);
  expect(await screen.findByText("Customer quote-0")).toBeTruthy();
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
        return { listEmailLogs: { total: 2, results: [{ to_email: email, type: "quote", createdAt: "2026-11-20T02:00:00Z" }] } };
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
  releaseHistory({ listEmailLogs: { total: 2, results: [{ type: "unrelated", createdAt: "2026-11-01" }] } });
});
