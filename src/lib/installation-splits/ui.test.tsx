// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), invalidate: vi.fn() }));
vi.mock("./client", () => ({
  splitRequest: mocks.request,
  invalidateSplitCaches: mocks.invalidate,
}));
import InstallationVisits from "@/components/InstallationVisits";
import { initialSplit } from "./projection";
import { completeVisit } from "./model";
const source = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  jobNumber: 42,
  stage: "INSTALLATION",
  quote: { c_total: 10000, wall: { SQM: 200, c_bagCount: 30 } },
  installation: { installDate: "2026-11-06T00:00:00Z" },
  installerChecksheet: { complete: false, actualBags: 999 },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ job: source, split: null });
});
afterEach(cleanup);
it("saves real progress and exposes planned remainder and estimated usage without a final-actual input", async () => {
  const next = {
    ...initialSplit(source),
    ...completeVisit(initialSplit(source), "initial", 60, null),
    version: 1,
  };
  mocks.request
    .mockResolvedValueOnce({ job: source, split: null })
    .mockResolvedValueOnce({ split: next });
  render(<InstallationVisits jobId={source._id} />);
  await screen.findByLabelText("Completed this visit (% of whole job)");
  fireEvent.change(
    screen.getByLabelText("Completed this visit (% of whole job)"),
    { target: { value: "60" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Record completed work" }),
  );
  await screen.findByText(/Visit 2 · Unscheduled/);
  expect(mocks.request.mock.calls[1][1]).toMatchObject({
    version: 0,
    percent: 60,
    date: null,
    action: "complete",
  });
  expect(screen.queryByLabelText("Final actual bags")).toBeNull();
  expect(screen.getByText(/18 bags/).textContent).toContain(
    "estimated from quoted budget",
  );
  expect(mocks.invalidate).toHaveBeenCalled();
});
it("shows revision conflicts without claiming save success", async () => {
  mocks.request
    .mockResolvedValueOnce({ job: source, split: null })
    .mockRejectedValueOnce(
      Error("This job changed. Reload the visits before trying again."),
    );
  render(<InstallationVisits jobId={source._id} />);
  await screen.findByLabelText("Completed this visit (% of whole job)");
  fireEvent.change(
    screen.getByLabelText("Completed this visit (% of whole job)"),
    { target: { value: "60" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Record completed work" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Reload"),
  );
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("uses actual total allocations automatically when checksheet is completed", async () => {
  const split = {
    ...initialSplit(source),
    ...completeVisit(initialSplit(source), "initial", 60, "2026-11-10"),
    version: 1,
  };
  mocks.request.mockResolvedValue({
    job: { ...source, installerChecksheet: { complete: true, actualBags: 32 } },
    split,
  });
  render(<InstallationVisits jobId={source._id} />);
  await screen.findByText(/19.2 bags/);
  expect(screen.getByText(/19.2 bags/).textContent).toContain(
    "revised allocation",
  );
  expect(screen.getByRole("alert").textContent).toContain("remaining");
});

it("offers a historical split for a completed checksheet and requires a correction reason", async () => {
  mocks.request.mockResolvedValue({
    job: { ...source, installerChecksheet: { complete: true, actualBags: 32 } },
    split: null,
  });
  render(<InstallationVisits jobId={source._id} />);
  await screen.findByLabelText("Completed this visit (% of whole job)");
  expect(screen.getByLabelText("Reason for historical split")).toHaveProperty(
    "required",
    true,
  );
  expect(screen.queryByText(/requires reviewed backfill/)).toBeNull();
});

it('removes the revisit date with one action without changing recorded work', async () => {
 const split={...initialSplit(source),...completeVisit(initialSplit(source),'initial',60,'2026-11-10'),version:1};
 const cleared={...split,version:2,visits:split.visits.map(v=>v.state==='planned'?{...v,date:null}:v)};
 mocks.request.mockResolvedValueOnce({job:source,split}).mockResolvedValueOnce({split:cleared});
 render(<InstallationVisits jobId={source._id}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Remove revisit date'}));
 await waitFor(()=>expect(mocks.request.mock.calls[1][1]).toMatchObject({action:'reschedule',date:null,visitId:split.visits[1].id,version:1}));
 await screen.findByText(/Visit 2 · Unscheduled/);
 expect(screen.getByText(/Visit 1 · 2026-11-06/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Remove revisit date'})).toBeNull();
});
