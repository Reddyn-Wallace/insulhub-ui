// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import JobsPage from "@/app/jobs/page";
import JobsLayout from "@/app/jobs/layout";
const mocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), requests: [] as Record<string, unknown>[], params: new URLSearchParams("stage=JOBS") }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks, usePathname: () => "/jobs", useSearchParams: () => mocks.params }));
vi.mock("@/lib/graphql", () => ({ gql: async (query: string, variables: Record<string, unknown> = {}) => {
  if (query.includes("query Users")) return { users: { results: [] } };
  if (query.includes("query EmailLogs")) return { listEmailLogs: { results: [] } };
  if (query.includes("query Jobs(")) mocks.requests.push(variables);
  return { jobs: { total: 3, results: [
    { _id: "installed", jobNumber: 26487, stage: "INVOICE", updatedAt: "2026-08-03", installation: { installStatus: "INSTALLED_AS_QUOTED", installDate: "2026-07-23" }, client: { contactDetails: { name: "Installed customer" } } },
    { _id: "completed", jobNumber: 1, stage: "COMPLETED", updatedAt: "2026-08-03", installation: { installStatus: "INSTALLED_AS_QUOTED" }, client: { contactDetails: { name: "Completed customer" } } },
    { _id: "pending", jobNumber: 2, stage: "INSTALLATION", updatedAt: "2026-08-03", client: { contactDetails: { name: "Pending customer" } } },
  ] } };
} }));
beforeEach(() => {
  mocks.requests = [];
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    vi.stubGlobal(name, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear(), removeItem: (key: string) => values.delete(key) });
  }
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); mocks.params = new URLSearchParams("stage=JOBS"); vi.clearAllMocks(); });
it("keeps installed and upcoming jobs together until completed", async () => {
  localStorage.setItem("token", "test");
  render(<JobsPage />);
  expect(await screen.findByText("Installed customer")).toBeTruthy();
  expect(screen.queryByText("Completed customer")).toBeNull();
  expect(screen.getByText("Pending customer")).toBeTruthy();
  expect(screen.getByText("Installed customer").closest("a")?.firstElementChild?.className).toContain("bg-amber-50");
  expect(screen.getByRole("button", { name: /Sort: Install date Earliest first/ })).toBeTruthy();
  expect(screen.getByText("Installed customer").closest("a")?.getAttribute("href")).toContain("returnTo=%2Fjobs%3Fstage%3DJOBS");
});
it("removes the separate queue from navigation", () => {
  render(<JobsLayout><div /></JobsLayout>);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("button", { name: "Awaiting completion" })).toBeNull();
  expect(screen.getByRole("button", { name: "Completion" })).toBeTruthy();
});
it("redirects old queue links to Jobs", async () => {
  mocks.params = new URLSearchParams("stage=AWAITING_COMPLETION");
  localStorage.setItem("token", "test");
  render(<JobsPage />);
  await screen.findByText("Pending customer");
  expect(mocks.replace).toHaveBeenCalledWith("/jobs?stage=JOBS");
});

it("loads only active job stages instead of scanning the entire history", async () => {
  localStorage.setItem("token", "test");
  render(<JobsPage />);
  await screen.findByText("Pending customer");
  expect(mocks.requests.length).toBeGreaterThan(0);
  expect(mocks.requests.every((request) => Array.isArray(request.stages))).toBe(true);
  expect(mocks.requests).toContainEqual({ stages: ["SCHEDULED", "INSTALLATION", "INVOICE"], skip: 0, limit: 5000 });
});
