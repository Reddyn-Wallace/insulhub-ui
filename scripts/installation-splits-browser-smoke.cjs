require("tsx/cjs");
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const {
  editVisits,
} = require("../src/lib/installation-splits/model.ts");
const {
  initialSplit,
} = require("../src/lib/installation-splits/projection.ts");
const {calendarVisits} = require("../src/lib/installation-splits/views.ts");
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
      let calendarRequests = 0;
      let visitReads = 0;
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
              /^\s*query\b/,
              "No real upstream mutations in browser verification",
            );
            return send({
              data: {
                jobs: { total: 1, results: [job] },
                job,
                users: { results: [] },
                listEmailLogs: {total:0,results:[]},
              },
            });
          }
          return route.abort();
        }
        if (url.pathname === `/api/jobs/${job._id}/installation-splits`) {
          if (request.method() === "GET") { visitReads++; return send({ job, split }); }
          const input = request.postDataJSON();
          if (input.version !== (split?.version || 0))
            return send({ error: "Reload visits." }, 409);
          const previous = split || initialSplit(job);
          const changed = editVisits(previous,input.visits);
          split = { ...previous, ...changed, version: previous.version + 1 };
          return send({ split });
        }
        if (url.pathname === "/api/installation-splits")
          return send({ splits: split ? { [job._id]: split } : {} });
        if (url.pathname === "/api/calendar/jobs") {
          calendarRequests++;
          const projected = calendarVisits(job,split);
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
      await page.getByRole("button",{name:"Split job",exact:true}).click();
      const beforeSave = calendarRequests;
      await page.getByLabel("Visit 1 percentage").fill("60");
      await page.getByLabel("Visit 2 date").fill("2026-11-10");
      if (historical) await page.getByLabel("Reason for historical split").fill("Correct weekly allocation after completion");
      await page
        .getByRole("button", { name: "Save visits", exact: true })
        .click();
      await page.getByRole("button",{name:"Edit visits",exact:true}).waitFor();
      assert.equal(calendarRequests,beforeSave,"Saving must not refetch the calendar");
      assert.equal(visitReads,0,"Seeded popup must not refetch visit details");
      await page.getByRole("button",{name:"Pencilled",exact:true}).waitFor();
      await page.getByText("Planning notes",{exact:true}).waitFor();
      assert.equal(await page.getByText("Usage reporting",{exact:true}).count(),0);
      await page.getByRole("button",{name:"Pencilled",exact:true}).click();
      await page.getByRole("button",{name:"Internal",exact:true}).click();
      await page.locator("textarea").fill("Keep normal planning notes");
      await page.getByRole("button",{name:"Save",exact:true}).click();
      await page.getByRole("heading",{name:"Installation planning",exact:true}).waitFor({state:"detached"});
      assert.equal(split.visits[1].date,"2026-11-10");
      await page.getByText("40% · Planned", { exact: true }).waitFor();
      const splitCard = page.locator('[data-split-visit="true"]').first();
      assert((await splitCard.getAttribute("class")).includes("bg-blue-50"));
      await splitCard.getByText("Split job", { exact: true }).waitFor();
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
      await page.getByRole("button",{name:"Edit visits",exact:true}).click();
      await page.getByRole("button",{name:"Clear visit 2 date",exact:true}).click();
      await page.getByRole("button",{name:"Add visit",exact:true}).click();
      await page.getByLabel("Visit 3 date").fill("2026-11-20");
      await page.getByRole("button",{name:"Save visits",exact:true}).click();
      await page.getByRole("button",{name:"Edit visits",exact:true}).waitFor();
      await page.getByRole("button",{name:"×",exact:true}).click();
      assert.equal(await page.getByRole("heading",{name:"Unscheduled return visits"}).count(),0);
      assert.equal(split.visits[0].date, "2026-11-06");
      assert.deepEqual(split.visits.map(v=>v.percent),[60,20,20]);
      // A completed legacy parent must still expose remaining work in the normal queue.
      job.stage="COMPLETED";
      await page.goto(base+"/jobs?stage=JOBS");
      await page.getByText("Revisit needs scheduling",{exact:true}).waitFor();
      await page.goto(base+"/jobs?stage=JOBS&search=42");
      await page.getByText("Revisit needs scheduling",{exact:true}).waitFor();
      assert.equal(await page.getByRole("button",{name:/Schedule revisit|Manage visit/}).count(),0);
      // The standard job card still links to the job. Manage visits from a calendar card here.
      assert(await page.locator('a[href*="/jobs/'+job._id+'"]').count());
      await page.goto(base+"/jobs/calendar");
      await page.getByRole("button").filter({hasText:"20% · Planned"}).first().click();
      await page.getByRole("button",{name:"Edit visits",exact:true}).click();
      await page.getByLabel("Visit 2 date").fill("2026-11-12");
      await page.getByRole("button",{name:"Save visits",exact:true}).click();
      await page.getByRole("button",{name:"Edit visits",exact:true}).waitFor();
      await page.getByRole("button",{name:"×",exact:true}).click();
      await page.goto(base+"/jobs/calendar");
      await page.getByText("20% · Planned",{exact:true}).first().waitFor();
      await page.getByRole("button").filter({hasText:"20% · Planned"}).first().click();
      await page.getByRole("button",{name:"Edit visits",exact:true}).click();
      await page.screenshot({path:`/tmp/compact-visit-editor-${width}.png`});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
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
