// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import JobPage from "@/app/jobs/[id]/page";

const state = vi.hoisted(() => ({
  id: "69ea7a15a5185b0a06d7615e",
  router: { push: vi.fn() },
  save: vi.fn(),
  acceptedScenario: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => state.router,
  useParams: () => ({ id: state.id }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/graphql", () => {
  const originalJob = {
    _id: state.id,
    jobNumber: 123,
    stage: "QUOTE",
    updatedAt: "2026-11-26T00:00:00Z",
    client: { contactDetails: { name: "Test owner" } },
    quote: {
      quoteNumber: "123",
      date: "2026-11-26T00:00:00Z",
      wall: { SQM: 10, SQMPrice: 100 },
      extras: [{ name: "Council Fee", price: 350 }, { name: "Existing discount", price: -50 }],
    },
  };

  let savedJob = originalJob;
  return {
    gql: async (query: string, variables?: { input: { quote: typeof originalJob.quote; stage: string } }) => {
      if (query.includes("mutation UpdateJobQuote") && variables) {
        state.save(variables.input.quote, variables.input.stage);
        savedJob = { ...originalJob, stage: variables.input.stage, quote: variables.input.quote };
        return { updateJob: savedJob };
      }
      if (state.acceptedScenario && !state.save.mock.calls.length) {
        return {
          job: {
            ...originalJob,
            stage: "SCHEDULED",
            quote: {
              ...originalJob.quote, status: "ACCEPTED", c_total: 5612, c_deposit: 0, depositPercentage: 25,
              wall: { SQM: 61, SQMPrice: 80 },
              ceiling: { SQM: null, c_thickness: 0, c_bagCount: 0 },
              extras: [],
            },
          },
          users: { results: [] },
        };
      }
      return { job: state.save.mock.calls.length ? savedJob : originalJob, users: { results: [] } };
    },
  };
});

beforeEach(() => {
  state.acceptedScenario = false;
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "token" ? "test" : null });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [], templates: [], senders: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("adds and edits quote discounts using decimal amounts without a minus key", async () => {
  const user = userEvent.setup();
  render(<JobPage />);
  const quoteHeading = await screen.findByRole("heading", { name: "Quote" });
  const editQuote = within(quoteHeading.parentElement!).getByRole("button", { name: "Edit" });
  fireEvent.click(editQuote);

  const discountAmounts = () => screen.getAllByRole("spinbutton", { name: "Discount amount excluding GST" });
  const setAmount = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

  const [existingDiscount] = discountAmounts();
  expect(existingDiscount).toHaveProperty("value", "50");
  setAmount(existingDiscount, "");
  setAmount(existingDiscount, "75");

  const addDiscount = screen.getByRole("button", { name: /Add discount/ });
  fireEvent.click(addDiscount);
  const newDiscount = discountAmounts()[1];
  expect(newDiscount).toHaveProperty("inputMode", "decimal");
  fireEvent.change(screen.getAllByRole("textbox", { name: "Discount name" })[1], {
    target: { value: "Winter offer" },
  });
  await user.type(newDiscount, "120.50");
  fireEvent.click(addDiscount);

  fireEvent.click(screen.getByRole("button", { name: /Add charge/ }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "Charge name" })[1], {
    target: { value: "Access fee" },
  });
  setAmount(screen.getAllByRole("spinbutton", { name: "Charge amount excluding GST" })[1], "25");

  fireEvent.click(screen.getByRole("button", { name: /Add charge/ }));
  const desktopAmount = screen.getAllByRole("spinbutton", { name: "Charge amount excluding GST" })[2];
  await user.type(desktopAmount, "-10");
  expect(discountAmounts()[3]).toHaveProperty("value", "10");
  fireEvent.click(screen.getByRole("button", { name: "Remove discount" }));

  fireEvent.click(screen.getByRole("button", { name: "Save Quote" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const saved = state.save.mock.calls[0][0];
  expect(saved.extras).toEqual([
    { name: "Council Fee", price: 350 },
    { name: "Existing discount", price: -75 },
    { name: "Winter offer", price: -120.5 },
    { name: "Access fee", price: 25 },
  ]);
  expect(saved.c_contractPrice).toBe(1179.5);
  expect(saved.c_gst).toBeCloseTo(176.925);
  expect(saved.c_total).toBeCloseTo(1356.425);
  expect(saved.c_deposit).toBeCloseTo(339.10625);

  await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Quote" })).toBeNull());
  const savedQuote = screen.getByRole("heading", { name: "Quote" });
  fireEvent.click(within(savedQuote.parentElement!).getByRole("button", { name: "Edit" }));
  expect(discountAmounts().map((input) => Number((input as HTMLInputElement).value))).toEqual([75, 120.5]);
});


it("keeps an accepted quote in its stage with its saved zero deposit and untouched ceiling when adding a discount", async () => {
  state.acceptedScenario = true;
  render(<JobPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Quote Info" }));
  const quoteHeading = await screen.findByRole("heading", { name: "Quote" });
  fireEvent.click(within(quoteHeading.parentElement!).getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: /Add discount/ }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Discount amount excluding GST" }), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Quote" }));

  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const [saved, stage] = state.save.mock.calls[0];
  expect(stage).toBe("SCHEDULED");
  expect(saved).toMatchObject({
    status: "ACCEPTED",
    c_deposit: 0,
    depositPercentage: 25,
    ceiling: { SQM: null, c_thickness: 0, c_bagCount: 0 },
    extras: [{ name: "Discount", price: -10 }],
  });
  expect(saved.c_total).toBeCloseTo(5600.5);
});
