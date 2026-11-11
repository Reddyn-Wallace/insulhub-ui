// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildSnapshot } from "./model";
import type { Report } from "./types";
import WeeklyGmReport from "@/components/gm-report/WeeklyGmReport";
import GmSettings from "@/components/gm-report/GmSettings";
import { Schedule, day } from "@/components/gm-report/ReportSections";
const settings = {
  wallBagCost: 1000,
  ceilingBagCost: 2000,
  weeklyWages: 10000,
  weeklyOpex: 5000,
  profitBudget: 10000,
  salesSqmBudget: 400,
  councilAliases: [],
};
let current: Report;
let failSave = false;
let holdRefresh: ((v: Response) => void) | null = null;
let deferRefresh = false;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  window.history.replaceState(
    {},
    "",
    "/jobs/reports/weekly-gm?week=2026-11-09",
  );
  vi.stubGlobal("localStorage", { getItem: () => "test" });
  current = {
    week: "2026-11-09",
    revision: 1,
    status: "draft",
    commentary: { profit: "", upcoming: "", pipeline: "" },
    snapshot: buildSnapshot("2026-11-09", [], {}, [], settings),
    updatedAt: new Date().toISOString(),
    finalisedAt: null,
    refreshing: false,
  };
  failSave = false;
  deferRefresh = false;
  holdRefresh = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/settings"))
        return Response.json({ settings, revision: 1 });
      if (url === "/api/gm-reports")
        return Response.json({
          reports: [{ week: current.week, status: current.status }],
        });
      if (init?.method === "POST") {
        const b = JSON.parse(init.body as string);
        if (b.action === "commentary") {
          if (failSave)
            return Response.json({ error: "Save failed" }, { status: 409 });
          current = {
            ...current,
            revision: current.revision + 1,
            commentary: b.commentary,
          };
        }
        if (b.action === "refresh" && deferRefresh)
          return new Promise<Response>((r) => {
            holdRefresh = r;
          });
        if (b.action === "finalise")
          current = {
            ...current,
            revision: current.revision + 1,
            status: "finalised",
          };
      }
      return Response.json({ report: current });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("renders all report sections and autosaves commentary without a manual save action", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  expect(
    screen.getByRole("link", { name: "Report settings" }).getAttribute("href"),
  ).toContain("week=2026-11-09");
  expect(screen.getByText("Jobs sold")).toBeTruthy();
  expect(screen.getByText("Booked pipeline")).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Was the week/), {
    target: { value: "Good result" },
  });
  await waitFor(() => expect(current.commentary.profit).toBe("Good result"));
});
it("marks the sales comparison incomplete when accepted jobs have unknown dates", async () => {
  current.snapshot!.sales.undatedJobs = [
    { id: "unknown", number: "42", customer: "Undated example", sqm: 80 },
  ];
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  expect(
    screen.getByText(/1 accepted job has no acceptance date/),
  ).toBeTruthy();
  expect(screen.getByText("Sales comparison incomplete")).toBeTruthy();
});
it("preserves text typed during a refresh and saves it afterwards", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  deferRefresh = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(holdRefresh).not.toBeNull());
  fireEvent.change(screen.getByLabelText(/Was the week/), {
    target: { value: "Written while refreshing" },
  });
  holdRefresh!(Response.json({ report: { ...current, revision: 2 } }));
  await waitFor(() =>
    expect(current.commentary.profit).toBe("Written while refreshing"),
  );
  expect(
    (screen.getByLabelText(/Was the week/) as HTMLTextAreaElement).value,
  ).toBe("Written while refreshing");
});
it("keeps unsaved text and stops week navigation when a save fails", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  failSave = true;
  fireEvent.change(screen.getByLabelText(/Was the week/), {
    target: { value: "Do not lose" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Save failed"),
  );
  expect(window.location.search).toContain("2026-11-09");
  expect(
    (screen.getByLabelText(/Was the week/) as HTMLTextAreaElement).value,
  ).toBe("Do not lose");
  failSave = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
it("requires confirmation and makes finalised commentary read-only", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  fireEvent.click(screen.getByRole("button", { name: "Finalise" }));
  fireEvent.click(screen.getByRole("button", { name: "Finalise permanently" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText(/Was the week/) as HTMLTextAreaElement).readOnly,
    ).toBe(true),
  );
  expect(screen.queryByRole("button", { name: "Refresh data" })).toBeNull();
});
it("loads financial settings in dollars and saves whole cents", async () => {
  render(<GmSettings />);
  const cost = await screen.findByLabelText("Wall bag cost");
  await waitFor(() => expect((cost as HTMLInputElement).value).toBe("10"));
  fireEvent.change(cost, { target: { value: "12.50" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText(/Settings saved/);
  const calls = vi.mocked(fetch).mock.calls;
  const write = calls.find((c) => c[1]?.method === "PUT");
  expect(JSON.parse(write![1]!.body as string).settings.wallBagCost).toBe(1250);
});

it("flushes the latest edit once when blur and week navigation occur during an autosave", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  const field = screen.getByLabelText(/Was the week/);
  fireEvent.change(field, { target: { value: "Latest" } });
  fireEvent.blur(field);
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
  await waitFor(() => expect(current.commentary.profit).toBe("Latest"));
  const saves = vi
    .mocked(fetch)
    .mock.calls.filter(
      (c) =>
        c[1]?.method === "POST" &&
        JSON.parse(c[1].body as string).action === "commentary",
    );
  expect(saves).toHaveLength(1);
});
it("adopts another GM commentary on a clean refresh without sending a stale autosave", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  deferRefresh = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(holdRefresh).not.toBeNull());
  current = {
    ...current,
    revision: 2,
    commentary: { ...current.commentary, profit: "Other GM saved this" },
  };
  holdRefresh!(Response.json({ report: current }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText(/Was the week/) as HTMLTextAreaElement).value,
    ).toBe("Other GM saved this"),
  );
  const writes = vi
    .mocked(fetch)
    .mock.calls.filter(
      (c) =>
        c[1]?.method === "POST" &&
        JSON.parse(c[1].body as string).action === "commentary",
    );
  expect(writes).toHaveLength(0);
});
it("preserves both remote and local text when another GM edits during a dirty refresh", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  deferRefresh = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(holdRefresh).not.toBeNull());
  fireEvent.change(screen.getByLabelText(/Was the week/), {
    target: { value: "My unsaved change" },
  });
  current = {
    ...current,
    revision: 2,
    commentary: { ...current.commentary, profit: "Other GM change" },
  };
  holdRefresh!(Response.json({ report: current }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("another window"),
  );
  expect(current.commentary.profit).toBe("Other GM change");
  expect(
    (screen.getByLabelText(/Was the week/) as HTMLTextAreaElement).value,
  ).toBe("My unsaved change");
});
it("blocks leaving through shared navigation when a refresh still holds unsaved commentary", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  deferRefresh = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(holdRefresh).not.toBeNull());
  fireEvent.change(screen.getByLabelText(/Was the week/), {
    target: { value: "Still typing" },
  });
  window.dispatchEvent(
    new CustomEvent("gm-report-navigate", {
      cancelable: true,
      detail: { href: "/jobs" },
    }),
  );
  try {
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("refresh"),
    );
  } finally {
    holdRefresh!(Response.json({ report: current }));
  }
});
it("renders a calendar placeholder on its NZ day rather than its previous UTC day", () => {
  const week = buildSnapshot(
    "2026-11-09",
    [],
    {},
    [{ id: "p", title: "Morning painting", startsAt: "2026-11-10T20:00:00Z" }],
    settings,
  ).current;
  render(<Schedule week={week} />);
  expect(screen.getByText(day("2026-11-11"))).toBeTruthy();
});
it("recovers unsaved commentary after a failed save and history-navigation unmount", async () => {
  const first = render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  failSave = true;
  fireEvent.change(screen.getByLabelText(/Was the week/), {
    target: { value: "Recover after Back" },
  });
  fireEvent.blur(screen.getByLabelText(/Was the week/));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Save failed"),
  );
  first.unmount();
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  expect(
    (screen.getByLabelText(/Was the week/) as HTMLTextAreaElement).value,
  ).toBe("Recover after Back");
});
it("does not reset a newly saved edit when cached week navigation finishes a slower history read", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  let reads = 0,
    finish: ((r: Response) => void) | null = null;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (url === "/api/gm-reports" && ++reads === 3)
      return new Promise<Response>((r) => {
        finish = r;
      });
    return original(url, init);
  });
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Report week") as HTMLInputElement).value,
    ).toBe("2026-11-02"),
  );
  await screen.findByText("Leads by day");
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  await waitFor(() => expect(finish).not.toBeNull());
  fireEvent.change(screen.getByLabelText(/Was the week/), {
    target: { value: "Latest cached edit" },
  });
  fireEvent.blur(screen.getByLabelText(/Was the week/));
  await waitFor(() =>
    expect(current.commentary.profit).toBe("Latest cached edit"),
  );
  await act(async () => {
    finish!(
      Response.json({ reports: [{ week: "2026-11-09", status: "draft" }] }),
    );
  });
  expect(
    (screen.getByLabelText(/Was the week/) as HTMLTextAreaElement).value,
  ).toBe("Latest cached edit");
});
it("shows each forward week as its own Monday–Sunday calendar row", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  expect(
    screen.getAllByRole("region", { name: /calendar for week of/i }),
  ).toHaveLength(3);
  expect(screen.getByRole("heading", { name: day("2026-11-16") })).toBeTruthy();
  expect(screen.getByRole("heading", { name: day("2026-11-22") })).toBeTruthy();
});
it("reconciles gross scheduled value, completed revenue and planned council costs on the same P&L", async () => {
  const jobs = [
    {
      _id: "done",
      stage: "INSTALLATION",
      quote: {
        c_total: 1150,
        wall: { SQM: 80, c_bagCount: 10 },
        extras: [{ name: "Council Fee", price: 330 }],
      },
      installation: {
        installDate: "2026-11-10",
        installStatus: "INSTALLED_AS_QUOTED",
      },
      installerChecksheet: { actualBags: 8 },
    },
    {
      _id: "planned",
      stage: "SCHEDULED",
      quote: {
        c_total: 1250,
        consentFee: 100,
        wall: { SQM: 80, c_bagCount: 10 },
        extras: [{ name: "Council Fee", price: 350 }],
      },
      installation: { installDate: "2026-11-12", installStatus: "SCHEDULED" },
    },
  ];
  current.snapshot = buildSnapshot(current.week, jobs, {}, [], settings);
  render(<WeeklyGmReport />);
  await screen.findByRole("columnheader", { name: "Full schedule" });
  expect(
    screen.getByRole("row", {
      name: /Calendar value incl GST.*\$1,150.*\$2,400/,
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("row", { name: /Revenue excl GST.*\$1,000.*\$2,100/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("row", { name: /Council fees.*\$330.*\$680/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("row", { name: /Operating profit.*\$440.*\$1,090/ }),
  ).toBeTruthy();
});
