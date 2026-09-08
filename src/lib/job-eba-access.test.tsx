// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({ push: vi.fn(), job: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => state, useParams: () => ({ id: "new-job" }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/graphql", () => ({ gql: vi.fn(async () => ({ job: state.job, users: { results: [] } })) }));
import { gql } from "@/lib/graphql";
import JobPage from "@/app/jobs/[id]/page";
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "token" ? "test" : null });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [], templates: [], senders: [], enabled: false })));
  sessionStorage.clear();
  state.job = { _id: "new-job", jobNumber: 123, stage: "LEAD", updatedAt: "2026-09-08", client: { contactDetails: { name: "Test owner" } }, lead: {} };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each(["LEAD", "QUOTE"])("opens an EBA without a quote at %s stage and does not write job data", async (stage) => {
  state.job.stage = stage;
  render(<JobPage />);
  const button = await screen.findByRole("button", { name: /Complete EBA/ });
  vi.mocked(gql).mockClear();
  fireEvent.click(button);
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/jobs/new-job/eba"));
  expect(vi.mocked(gql).mock.calls.filter(([query]) => /\bmutation\b/.test(query))).toHaveLength(0);
});
it("keeps a client-signed EBA locked", async () => {
  state.job.stage = "QUOTE";
  state.job.ebaForm = { complete: true, clientApproved: true };
  render(<JobPage />);
  expect(await screen.findByRole("button", { name: /EBA Signed/ })).toHaveProperty("disabled", true);
});
