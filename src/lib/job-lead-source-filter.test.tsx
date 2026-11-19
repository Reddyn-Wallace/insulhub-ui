// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const navigation = vi.hoisted(() => ({ params: new URLSearchParams("stage=LEAD"), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.params, useRouter: () => navigation }));
vi.mock("@/lib/graphql", () => ({ gql: vi.fn(async () => ({ jobs: { results: [], total: 0 }, users: { results: [] }, listEmailLogs: { results: [] } })) }));
import { gql } from "@/lib/graphql";
import JobsPage from "@/app/jobs/page";
beforeEach(() => {
  const storage = new Map<string, string>([["token", "test"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  sessionStorage.clear(); navigation.params = new URLSearchParams("stage=LEAD");
  navigation.replace.mockImplementation((url: string) => { navigation.params = new URL(url, "http://localhost").searchParams; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("keeps sources open through URL updates so several can be selected and deselected", async () => {
  const view = render(<JobsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /^Filters/ }));
  fireEvent.click(screen.getByRole("button", { name: /All lead sources/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Contact Form/ }));
  view.rerender(<JobsPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: /^Social Media/ })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /^Social Media/ })); view.rerender(<JobsPage />);
  expect(navigation.params.getAll("leadSource")).toEqual(["contact form", "social media"]);
  fireEvent.click(screen.getByRole("button", { name: /^Contact Form/, pressed: true })); view.rerender(<JobsPage />);
  expect(navigation.params.getAll("leadSource")).toEqual(["social media"]);
  fireEvent.click(screen.getByRole("button", { name: "Clear sources" })); view.rerender(<JobsPage />);
  expect(navigation.params.getAll("leadSource")).toEqual([]);
  expect(screen.getByRole("button", { name: /^Social Media/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("button", { name: /^Social Media/ })).toBeNull();
});

it("restores a search after leaving the jobs list and returning", async () => {
  const view = render(<JobsPage />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Wallace" } });
  await waitFor(() => expect(navigation.params.get("search")).toBe("Wallace"));
  view.unmount();
  render(<JobsPage />);
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Wallace");
  expect(await screen.findByText('No results for "Wallace"')).toBeTruthy();
});

it("clears the saved search and cancels pending input", async () => {
  navigation.params = new URLSearchParams("stage=LEAD&search=Wallace");
  const view = render(<JobsPage />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Smith" } });
  fireEvent.click(screen.getByRole("button", { name: "×" }));
  await new Promise(resolve => setTimeout(resolve, 500));
  expect(navigation.params.has("search")).toBe(false);
  view.unmount();
  render(<JobsPage />);
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
});

it("uses the same lead read for subtabs, sorting and pagination", async () => {
  const leads = Array.from({ length: 42 }, (_, index) => ({
    _id: `lead-${index}`, jobNumber: index, stage: "LEAD", updatedAt: "2026-11-12",
    lead: { leadStatus: index ? "CALLBACK" : "NEW" },
    client: { contactDetails: { name: `Lead example ${index}` } },
  }));
  const jobs = { results: leads, total: leads.length };
  vi.mocked(gql).mockResolvedValue({ jobs, listEmailLogs: { total: 0, results: [] } });
  vi.stubGlobal("scrollTo", vi.fn());
  const view = render(<JobsPage />);
  expect(await screen.findByText("Lead example 0")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Callback/ }));
  view.rerender(<JobsPage />);
  expect(await screen.findByText("Lead example 1")).toBeTruthy();
  expect(screen.queryByText("Lead example 0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
  expect(await screen.findByText("Lead example 41")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Sort/ }));
  expect(vi.mocked(gql).mock.calls.filter(([query]) => query.includes("query Jobs"))).toHaveLength(1);
  expect(vi.mocked(gql).mock.calls.filter(([query]) => query.includes("listEmailLogs"))).toHaveLength(0);
});
