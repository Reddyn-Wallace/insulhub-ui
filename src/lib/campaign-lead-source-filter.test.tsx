// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "campaign" }), useRouter: () => router }));
vi.mock("@/lib/graphql", () => ({ gql: vi.fn(async () => ({ users: { results: [] }, jobs: { results: [
  { _id: "1", jobNumber: 1, stage: "LEAD", lead: { leadSource: [" Referral ", "Custom Partner"] }, client: { contactDetails: { name: "Matching customer", email: "one@example.com" } } },
  { _id: "2", jobNumber: 2, stage: "QUOTE", lead: { leadSource: ["Referral"] }, client: { contactDetails: { name: "Quote customer", email: "two@example.com" } } },
  { _id: "3", jobNumber: 3, stage: "LEAD", client: { contactDetails: { name: "No source customer", email: "three@example.com" } } },
] } })) }));
import AudienceBuilder from "@/app/jobs/campaigns/[id]/audience-builder/page";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("combines lead source with status and applies the matching audience, using the same source options as the leads page", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "test-token" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ campaign: { id: "campaign", name: "Test", channel: "email", status: "draft", recipientCount: 0 }, recipients: [] }) })));
  render(<AudienceBuilder />);
  const source = await screen.findByRole("combobox", { name: "Lead source" });
  fireEvent.change(source, { target: { value: "referral" } });
  expect(screen.getByText("2 jobs match the current filters.")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Status", exact: true }), { target: { value: "LEAD" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
  expect(screen.getByText("Matching customer")).toBeTruthy();
  expect(screen.queryByText("Quote customer")).toBeNull();
  expect(screen.queryByText("No source customer")).toBeNull();
  expect(Array.from((source as HTMLSelectElement).options, (option) => option.text)).toEqual([
    "All lead sources", "Contact Form", "Social Media", "Phone Call", "Referral", "Homeshow",
  ]);
  fireEvent.change(source, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
  expect(screen.getByText("No source customer")).toBeTruthy();
});
