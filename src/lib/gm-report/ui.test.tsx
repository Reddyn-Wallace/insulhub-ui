// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildSnapshot } from "./model";
import { initialSplit } from "../installation-splits/projection";
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
  expect(screen.queryByRole("link", { name: "Report settings" })).toBeNull();
  expect(screen.queryByLabelText("Saved reports")).toBeNull();
  expect(
    screen
      .getAllByRole("heading", { level: 2 })
      .slice(0, 3)
      .map((heading) => heading.textContent),
  ).toEqual(["Leads by day", "Jobs sold", "Installs for the week"]);
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
it("loads a saved week without fetching saved-report navigation", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  expect(
    vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/gm-reports"),
  ).toBe(false);
  expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next week" })).toBeTruthy();
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
it("shows compact install and sales cards and a completed-only weekly P&L", async () => {
  const jobs = [
    {
      _id: "done",
      jobNumber: 123456,
      acceptedAt: "2026-11-09",
      client: {
        contactDetails: {
          name: "Completed customer",
          streetAddress: "12 Test Street",
          city: "Wellington",
        },
      },
      stage: "INSTALLATION",
      quote: {
        c_total: 1150,
        wall: { SQM: 80, c_bagCount: 10 },
        ceiling: { SQM: 20, c_bagCount: 2 },
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
  await screen.findByText("Leads by day");
  expect(
    screen.getAllByText("12 Test Street, Wellington", { exact: true }),
  ).toHaveLength(2);
  expect(screen.getByText("Bag variance: −2")).toBeTruthy();
  expect(
    screen.queryByText(/budgeted|8 used|COGS — wall|COGS — ceiling/),
  ).toBeNull();
  const cogsInfo = screen.getByRole("button", {
    name: "COGS details",
  });
  const description = document.getElementById(
    cogsInfo.getAttribute("aria-describedby")!,
  );
  expect(description?.textContent).toMatch(/12% of revenue.*10 bags/);
  expect(description?.hidden).toBe(true);
  fireEvent.mouseEnter(cogsInfo);
  expect(screen.getByRole("tooltip").textContent).toMatch(
    /12% of revenue.*10 bags/,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(cogsInfo);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.blur(cogsInfo);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(cogsInfo);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.getByText("$120", { exact: true })).toBeTruthy();
  expect(screen.getByText(/Accepted Mon, 9 Nov/)).toBeTruthy();
  expect(
    screen.queryByText(
      /123456|Council extras|Whole jobs counted once|Full schedule/,
    ),
  ).toBeNull();
  expect(screen.getByRole("heading", { name: "Weekly P&L" })).toBeTruthy();
  expect(screen.getAllByText("$330", { exact: true })).toHaveLength(1);
});

it("omits the COGS percentage when revenue is zero", async () => {
  render(<WeeklyGmReport />);
  await screen.findByText("Leads by day");
  expect(screen.getAllByText("COGS", { exact: true })).toHaveLength(3);
  expect(screen.queryByText(/of revenue|NaN|Infinity/)).toBeNull();
  expect(screen.queryByRole("button", { name: "COGS details" })).toBeNull();
});

it("still shows known bag usage when non-revenue work has no COGS percentage", async () => {
  current.snapshot = buildSnapshot(
    current.week,
    [
      {
        _id: "no-charge",
        stage: "COMPLETED",
        quote: { c_total: 0, wall: { SQM: 6.5, c_bagCount: 1 } },
        installation: { installDate: "2026-11-10" },
        installerChecksheet: { actualBags: 1 },
      },
    ],
    {},
    [],
    settings,
  );
  render(<WeeklyGmReport />);
  fireEvent.click(await screen.findByRole("button", { name: "COGS details" }));
  expect(screen.getByRole("tooltip").textContent).toBe("1 bag");
});

it("colours confirmed and pencilled installs differently and leaves missing booking status neutral", () => {
  const scheduled = {
    stage: "SCHEDULED",
    quote: { c_total: 1150, wall: { SQM: 80, c_bagCount: 10 } },
    installation: { installDate: "2026-11-17" },
  };
  const week = buildSnapshot(
    "2026-11-09",
    [
      { ...scheduled, _id: "confirmed", bookingStatus: "confirmed" },
      { ...scheduled, _id: "pencilled", bookingStatus: "pencilled" },
      { ...scheduled, _id: "unknown" },
    ],
    {},
    [],
    settings,
  ).upcoming[0];
  render(<Schedule week={week} />);
  expect(screen.getByText("Confirmed").closest("article")?.className).toContain(
    "border-l-emerald-500",
  );
  expect(screen.getByText("Pencilled").closest("article")?.className).toContain(
    "border-l-amber-500",
  );
  expect(screen.getByText("Planned").closest("article")?.className).toContain(
    "border-l-slate-300",
  );
});

it("keeps the calendar's blue styling for split visits regardless of status", () => {
  const job = {
    _id: "split",
    stage: "SCHEDULED",
    bookingStatus: "pencilled" as const,
    quote: { c_total: 1150, wall: { SQM: 80, c_bagCount: 10 } },
  };
  const split = {
    ...initialSplit(job),
    visits: [
      {
        id: "first",
        date: "2026-11-10",
        percent: 20,
        state: "completed" as const,
      },
      {
        id: "next",
        date: "2026-11-12",
        percent: 80,
        state: "planned" as const,
      },
    ],
  };
  const { current } = buildSnapshot(
    "2026-11-09",
    [job],
    { split },
    [],
    settings,
    "2026-11-11T00:00:00Z",
  );
  render(<Schedule week={current} />);
  for (const status of ["Completed · 20%", "Pencilled · 80%"]) {
    expect(screen.getByText(status).closest("article")?.className).toContain(
      "border-l-blue-500 bg-blue-50",
    );
  }
});
