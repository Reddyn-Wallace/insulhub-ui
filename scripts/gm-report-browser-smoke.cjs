require("tsx/cjs");
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { buildSnapshot } = require("../src/lib/gm-report/model.ts");
const base = process.env.GM_REPORT_SMOKE_BASE_URL || process.env.INSTALLATION_SPLITS_SMOKE_BASE_URL || "http://127.0.0.1:3129";
const settings = {
  wallBagCost: 3100,
  ceilingBagCost: 2700,
  weeklyWages: 1050000,
  weeklyOpex: 300000,
  profitBudget: 500000,
  salesSqmBudget: 400,
  councilAliases: [],
};
const job = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  jobNumber: 123,
  stage: "INSTALLATION",
  createdAt: "2026-11-09T00:00:00Z",
  acceptedAt: "2026-11-10T00:00:00Z",
  client: { contactDetails: { name: "Fictional report customer" } },
  quote: {
    status: "ACCEPTED",
    c_total: 11500,
    wall: { SQM: 160, c_bagCount: 25 },
    ceiling: { SQM: 40, c_bagCount: 8 },
    extras: [{ name: "Council application fee", price: 330 }],
  },
  installation: {
    installDate: "2026-11-10T00:00:00Z",
    installStatus: "INSTALLED_AS_QUOTED",
  },
  installerChecksheet: { complete: true, actualBags: 27 },
};
const future = {
  ...job,
  _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
  jobNumber: 124,
  installation: {
    installDate: "2026-11-17T00:00:00Z",
    installStatus: "SCHEDULED",
  },
  installerChecksheet: { complete: false, actualBags: null },
};
const placeholder = {
  id: "note",
  title: "Extra painting",
  startsAt: "2026-11-11T00:00:00Z",
};
function report(week) {
  return {
    week,
    revision: 1,
    status: "draft",
    commentary: { profit: "", upcoming: "", pipeline: "" },
    snapshot: buildSnapshot(
      week,
      [job, future],
      {},
      [placeholder],
      settings,
      "2026-11-16T00:00:00Z",
    ),
    updatedAt: "2026-11-16T00:00:00Z",
    finalisedAt: null,
    refreshing: false,
  };
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await context.addInitScript(() => {
        localStorage.setItem("token", "fictional-test-token");
        localStorage.setItem(
          "me",
          JSON.stringify({
            _id: "fictional-admin",
            firstname: "Test",
            role: "ADMIN",
          }),
        );
      });
      const reports = new Map(
        ["2026-11-09", "2026-11-02", "2026-11-16"].map((w) => [w, report(w)]),
      );
      let failSaves = false;
      let writes = 0,
        sourceLoads = 0;
      await context.route("**/*", async (route) => {
        const r = route.request(),
          u = new URL(r.url());
        const send = (data, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(data),
          });
        if (u.origin !== new URL(base).origin) {
          if (u.href === "https://api.insulhub.nz/graphql") {
            assert.match(r.postDataJSON().query, /^\s*query\b/);
            sourceLoads++;
            return send({
              data: {
                jobs: { total: 0, results: [] },
                users: { results: [] },
                me: { _id: "fictional-admin", role: "ADMIN" },
              },
            });
          }
          return route.abort();
        }
        if (u.pathname === "/api/gm-reports/settings")
          return send({ settings, revision: 1 });
        if (u.pathname === "/api/gm-reports")
          return send({
            reports: [...reports.values()].map((v) => ({
              week: v.week,
              status: v.status,
            })),
          });
        if (u.pathname.startsWith("/api/gm-reports/")) {
          const week = u.pathname.split("/").at(-1);
          let value = reports.get(week);
          if (r.method() === "POST") {
            const input = r.postDataJSON();
            writes++;
            if (input.action === "commentary" && failSaves)
              return send({ error: "Simulated save failure" }, 409);
            assert.ok(
              ["refresh", "commentary", "finalise"].includes(input.action),
            );
            if (value.status === "finalised")
              return send({ error: "Locked" }, 409);
            if (input.action === "commentary") {
              assert.equal(input.revision, value.revision);
              value = { ...value, commentary: input.commentary };
            }
            if (input.action === "finalise")
              value = {
                ...value,
                status: "finalised",
                finalisedAt: "2026-11-16T01:00:00Z",
              };
            value = { ...value, revision: value.revision + 1 };
            reports.set(week, value);
          }
          return send({ report: value || null });
        }
        if (u.pathname.startsWith("/api/")) {
          assert.equal(
            r.method(),
            "GET",
            "No business writes in browser smoke",
          );
          return send({});
        }
        return route.continue();
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/jobs/reports/weekly-gm?week=2026-11-09`, {
        waitUntil: "networkidle",
      });
      await page.getByText("Leads by day", { exact: true }).waitFor();
      await page.getByText("Extra painting", { exact: true }).waitFor();
      const schedules = page.getByRole("region", { name: /Calendar for week of/ });
      assert.equal(await schedules.count(), 3);
      for (const schedule of await schedules.all()) {
        const days = await schedule.getByRole("heading").evaluateAll((headings) =>
          headings.map((heading) => {
            const { x, y } = heading.getBoundingClientRect();
            return { x, y };
          }),
        );
        assert.equal(days.length, 7);
        assert.ok(days.every((day, i) => day.y === days[0].y && (i === 0 || day.x > days[i - 1].x)), "Days run left to right on a single row");
        if (width < 500)
          assert.ok(await schedule.evaluate((el) => el.scrollWidth > el.clientWidth), "Narrow screens scroll inside the calendar");
      }
      assert.equal(await page.locator("textarea").count(), 3);
      // Back/Forward is same-document navigation and must recover a failed save.
      await page
        .getByRole("link", { name: "Report settings", exact: true })
        .click();
      await page
        .getByRole("link", { name: "← Weekly GM report", exact: true })
        .click();
      await page.getByText("Leads by day", { exact: true }).waitFor();
      failSaves = true;
      await page.locator("#comment-profit").fill("Recover after browser Back");
      await page
        .getByRole("alert")
        .filter({ hasText: "Simulated save failure" })
        .waitFor();
      await page.goBack();
      await page
        .getByRole("heading", { name: "Costs & targets", exact: true })
        .waitFor();
      await page.goForward();
      await page.getByText("Leads by day", { exact: true }).waitFor();
      assert.equal(
        await page.locator("#comment-profit").inputValue(),
        "Recover after browser Back",
      );
      failSaves = false;
      await page
        .getByRole("button", { name: "Retry save", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role="status"]')?.textContent === "Saved",
      );
      await page
        .getByLabel("Was the week over or under budget? What was this due to?")
        .fill("Fictional weekly commentary");
      await page.waitForFunction(
        () =>
          document.querySelector('[role="status"]')?.textContent === "Saved",
      );
      assert.equal(
        reports.get("2026-11-09").commentary.profit,
        "Fictional weekly commentary",
      );
      await page
        .getByRole("button", { name: "Refresh data", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role="status"]')?.textContent === "Saved",
      );
      assert.equal(
        await page.locator("#comment-profit").inputValue(),
        "Fictional weekly commentary",
      );
      const start = Date.now();
      await page
        .getByRole("button", { name: "Previous week", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#report-week")?.value === "2026-11-02",
      );
      await page.getByText("Leads by day", { exact: true }).waitFor();
      const navigationMs = Date.now() - start;
      assert.ok(navigationMs < 1000, `Saved navigation ${navigationMs}ms`);
      await page
        .getByRole("button", { name: "Next week", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#report-week")?.value === "2026-11-09",
      );
      await page.getByRole("button", { name: "Finalise", exact: true }).click();
      await page.getByRole("button", { name: "Finalise permanently" }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role="status"]')?.textContent ===
          "Locked permanent record",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Refresh data", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
        "No horizontal overflow",
      );
      fs.mkdirSync("outputs/gm-report", { recursive: true });
      await page.screenshot({
        path: `outputs/gm-report/weekly-gm-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "Report settings", exact: true })
        .click();
      await page.getByLabel("Wall bag cost", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("Wall bag cost", { exact: true }).inputValue(),
        "31",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
      console.log(
        JSON.stringify({
          width,
          navigationMs,
          writes,
          sourceLoads,
          pageErrors: errors.length,
        }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
