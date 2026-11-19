const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

const base = process.env.CALENDAR_SMOKE_BASE_URL || process.env.INSTALLATION_SPLITS_SMOKE_BASE_URL || "http://127.0.0.1:3116";
const novemberStart = "2026-10-26";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", timezoneId: "Pacific/Auckland" });
    await context.addInitScript(() => localStorage.setItem("token", "calendar-test-only"));
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-11-19T00:00:00Z"));
    const failures = new Set();
    const reads = new Map();
    let finishPlanning;
    const pendingPlanning = new Promise(resolve => { finishPlanning = resolve; });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      const send = (json, status = 200) => route.fulfill({ status, json });
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (failures.has(url.pathname)) return send({ error: "Source temporarily unavailable" }, 503);
      if (url.pathname === "/api/calendar/placeholders") return send({ placeholders: [] });
      if (url.pathname === "/api/install-planning") {
        await pendingPlanning;
        return send({ planning: [{ jobId: "2026-11-19", status: "pencilled", installScope: "internal", note: "Keep this booking note" }] });
      }
      if (url.pathname !== "/api/calendar/jobs") return send({}, 404);
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      assert.equal(url.searchParams.get("includeUnscheduled"), "0");
      reads.set(start, (reads.get(start) || 0) + 1);
      // Make a network wait distinguishable from cached navigation.
      await new Promise(resolve => setTimeout(resolve, 350));
      const jobs = ["2026-10-06", "2026-11-19"].filter(date => date >= start && date <= end).map(date => ({
        _id: date,
        jobNumber: date.endsWith("19") ? 19 : 6,
        client: { contactDetails: { name: date.endsWith("19") ? "November sample" : "October sample" } },
        stage: "INSTALLATION",
        installation: { installDate: date + "T00:00:00Z" },
        quote: { c_total: 1200, wall: { SQM: 30 } },
      }));
      return send({ jobs });
    });

    await page.goto(base + "/jobs/calendar");
    await page.getByText("November sample", { exact: true }).first().waitFor();
    const grid = page.locator("[data-calendar-ready-ms]");
    await grid.waitFor();
    const coldMs = Number(await grid.getAttribute("data-calendar-ready-ms"));
    assert(coldMs > 0 && coldMs < 2000, `Synthetic first open took ${coldMs} ms`);
    await page.getByRole("button").filter({ hasText: "November sample" }).first().click();
    await page.getByText("Checking install planning…").waitFor();
    assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isEnabled(), false);
    finishPlanning();
    await page.locator("textarea").filter({ visible: true }).waitFor();
    assert.equal(await page.locator("textarea").filter({ visible: true }).inputValue(), "Keep this booking note");
    await page.getByRole("button", { name: "×", exact: true }).click();

    await page.getByRole("button", { name: "← Prev month" }).click();
    await page.getByText("October sample", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Next month →" }).click();
    await page.getByText("November sample", { exact: true }).first().waitFor();
    await grid.waitFor();
    const warmMs = Number(await grid.getAttribute("data-calendar-ready-ms"));
    assert(warmMs >= 0 && warmMs < 300, `Previously viewed month took ${warmMs} ms`);
    assert.equal(reads.get(novemberStart), 1);

    failures.add("/api/calendar/jobs");
    failures.add("/api/calendar/placeholders");
    failures.add("/api/install-planning");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByText("Scheduled jobs couldn’t refresh. Showing the last loaded schedule.").waitFor();
    await page.getByRole("button", { name: "Retry placeholders", exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry install planning", exact: true }).waitFor();
    assert.equal(await page.getByText("November sample", { exact: true }).first().isVisible(), true);
    assert.equal(await page.getByText("Week totals", { exact: true }).first().isVisible(), true);

    failures.delete("/api/calendar/placeholders");
    await page.getByRole("button", { name: "Retry placeholders", exact: true }).click();
    await page.getByRole("button", { name: "Retry placeholders", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Retry install planning", exact: true }).isVisible(), true);

    await page.evaluate(() => {
      localStorage.removeItem("token");
      window.dispatchEvent(new StorageEvent("storage", { key: "token", newValue: null }));
    });
    await page.waitForURL("**/login");
    await grid.waitFor({ state: "detached" });
    console.log(`PASS calendar first open ${coldMs} ms, cached month ${warmMs} ms, and independent retries with the grid visible`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
