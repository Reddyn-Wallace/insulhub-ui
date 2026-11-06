require("tsx/cjs");
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const {
  completeVisit,
  rescheduleVisit,
} = require("../src/lib/installation-splits/model.ts");
const {
  initialSplit,
  projectVisits,
} = require("../src/lib/installation-splits/projection.ts");
const base =
  process.env.INSTALLATION_SPLITS_SMOKE_BASE_URL || "http://127.0.0.1:3128";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const width of [1440, 390]) {
      const historical = width === 390;
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await context.addInitScript(() => {
        localStorage.setItem("token", "test-only-token");
        localStorage.setItem(
          "me",
          JSON.stringify({
            _id: "test-staff",
            firstname: "Test",
            role: "ADMIN",
          }),
        );
      });
      let split = null;
      const job = {
        _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        jobNumber: 42,
        stage: "INSTALLATION",
        quote: {
          status: "ACCEPTED",
          c_total: 10000,
          wall: { SQM: 120, c_bagCount: 30 },
          ceiling: { SQM: 80 },
        },
        installation: {
          installDate: "2026-11-06T00:00:00Z",
          installStatus: "INSTALL_NOT_FINISHED",
        },
        client: {
          contactDetails: {
            name: "Browser regression job",
            streetAddress: "Test address",
          },
        },
        installerChecksheet: { complete: historical, actualBags: historical ? 32 : null },
      };
      const errors = [];
      const page = await context.newPage();
      await page.clock.install({ time: new Date("2026-11-06T00:00:00Z") });
      page.on("pageerror", (e) => errors.push(e.message));
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        const send = (body, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          });
        if (url.origin !== new URL(base).origin) {
          if (url.href === "https://api.insulhub.nz/graphql") {
            const body = request.postDataJSON();
            assert.match(
              body.query,
              /^\s*query /,
              "No real upstream mutations in browser verification",
            );
            return send({
              data: {
                jobs: { total: 1, results: [job] },
                job,
                users: { results: [] },
              },
            });
          }
          return route.abort();
        }
        if (url.pathname === `/api/jobs/${job._id}/installation-splits`) {
          if (request.method() === "GET") return send({ job, split });
          const input = request.postDataJSON();
          if (input.version !== (split?.version || 0))
            return send({ error: "Reload visits." }, 409);
          const previous = split || initialSplit(job);
          const changed =
            input.action === "complete"
              ? completeVisit(
                  previous,
                  input.visitId,
                  input.percent,
                  input.date,
                )
              : rescheduleVisit(previous, input.visitId, input.date);
          split = { ...previous, ...changed, version: previous.version + 1 };
          return send({ split });
        }
        if (url.pathname === "/api/installation-splits")
          return send({ splits: split ? { [job._id]: split } : {} });
        if (url.pathname === "/api/calendar/jobs") {
          const projected = split ? projectVisits(job, split) : [job];
          return send({
            jobs: projected.filter((j) => j.installation.installDate),
            unscheduled: projected.filter((j) => !j.installation.installDate),
          });
        }
        if (url.pathname === "/api/install-planning")
          return send({ planning: [] });
        if (url.pathname === "/api/calendar/placeholders")
          return send({ placeholders: [] });
        if (url.pathname.startsWith("/api/"))
          return send({ error: "Not part of this browser test" }, 503);
        return route.continue();
      });
      await page.goto(base + "/jobs/calendar");
      await page
        .getByRole("button")
        .filter({ hasText: "Browser regression job" })
        .first()
        .click();
      await page.getByLabel("Completed this visit (% of whole job)").fill("60");
      await page.getByLabel("Return date (optional)").fill("2026-11-10");
      if (historical) await page.getByLabel("Reason for historical split").fill("Correct weekly allocation after completion");
      await page
        .getByRole("button", { name: "Record completed work", exact: true })
        .click();
      await page.getByText("40% · Planned", { exact: true }).waitFor();
      assert.equal(split.visits[0].percent, 60);
      await page.goto(base + "/jobs/reports");
      const run = page.getByRole("button", {
        name: /Run dashboard|Run report/,
      });
      await page.locator('input[type="date"]').first().fill("2026-11-01");
      await page.locator('input[type="date"]').nth(1).fill("2026-11-30");
      await run.click();
      let row = page.locator("tbody tr").filter({ hasText: "#42" });
      await row
        .getByText(historical ? "Revised · allocated actual total" : "Estimated · quoted budget", { exact: false })
        .waitFor();
      assert.match(await row.innerText(), historical ? /19\.2/ : /18/);
      assert.equal(
        await row.count(),
        1,
        "Planned return must not count as usage",
      );
      // Simulate a final checksheet arriving from the original backend, without touching that backend.
      job.installerChecksheet = { complete: true, actualBags: 32 };
      await run.click();
      await row
        .getByText("Revised · allocated actual total", { exact: false })
        .waitFor();
      assert.match(await row.innerText(), /19\.2/);
      assert.match(await row.innerText(), /remaining visit/);
      split.budgetBags = null;
      await run.click();
      await row
        .getByText("Revised · allocated actual total", { exact: false })
        .waitFor();
      assert.equal(
        (await row.locator("td").nth(3).innerText()).trim(),
        "-",
        "Missing frozen budget must not fall back to whole current quote",
      );
      split.budgetBags = 30;
      await run.click();
      await page.screenshot({
        path: `/tmp/installation-splits-real-report-${width}.png`,
        fullPage: true,
      });
      await page.goto(base + "/jobs/calendar");
      await page
        .getByRole("button")
        .filter({ hasText: "40% · Planned" })
        .click();
      await page.getByLabel("Remaining visit date").fill("");
      await page
        .getByRole("button", { name: "Save remaining visit date", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Unscheduled return visits" })
        .waitFor();
      assert.equal(split.visits[0].date, "2026-11-06");
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}px: real calendar editor, saved-visit API requests, partial usage without installed status, final checksheet recalculation, unscheduled queue`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
