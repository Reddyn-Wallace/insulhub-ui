// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const navigation = vi.hoisted(() => ({ params: new URLSearchParams("stage=LEAD"), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.params, useRouter: () => navigation }));
vi.mock("@/lib/graphql", () => ({ gql: vi.fn(async () => ({ jobs: { results: [], total: 0 }, users: { results: [] }, listEmailLogs: { results: [] } })) }));
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
