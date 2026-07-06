#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");

function loadEnvFile(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeUrlJoin(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
}

async function waitForReportOutcome(page, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await bodyText(page);
    const lower = text.toLowerCase();

    if (lower.includes("failed to verify your browser") || lower.includes("vercel security checkpoint")) {
      throw new Error("Blocked by Vercel Security Checkpoint. Add VERCEL_AUTOMATION_BYPASS_SECRET.");
    }

    if (
      lower.includes("unexpected token") ||
      lower.includes("failed to load weekly report") ||
      lower.includes("database_url is required") ||
      lower.includes("unauthorized") ||
      lower.includes("wrong email or password")
    ) {
      throw new Error(`Visible report error: ${text.slice(0, 500)}`);
    }

    if (lower.includes("new leads") && lower.includes("sales") && lower.includes("installs") && lower.includes("upcoming")) {
      return Date.now() - startedAt;
    }

    await page.waitForTimeout(1_000);
  }

  const text = await bodyText(page);
  throw new Error(`Timed out waiting for report results after ${timeoutMs}ms. Visible text: ${text.slice(0, 500)}`);
}

async function countAcceptedAtCache(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("report:weekly-sales-usage:accepted-at:v1");
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.data ? Object.keys(parsed.data).length : 0;
    } catch {
      return 0;
    }
  });
}

async function main() {
  loadEnvFile(".credentials/insulhub-login.env");
  loadEnvFile(".credentials/vercel.env");

  const baseUrl = process.env.INSULHUB_BASE_URL || "https://insulhub-ui.vercel.app";
  const username = requiredEnv("INSULHUB_USERNAME");
  const password = requiredEnv("INSULHUB_PASSWORD");
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const timeoutMs = Number(process.env.REPORT_SMOKE_TIMEOUT_MS || 240_000);
  const screenshotPath = path.join(root, process.env.REPORT_SMOKE_SCREENSHOT || "tmp/prod-smoke-sales-report.png");
  const userDataDir = path.join(root, process.env.REPORT_SMOKE_USER_DATA_DIR || "tmp/prod-smoke-profile");

  const launchOptions = {
    headless: process.env.HEADLESS !== "false",
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  } else {
    const openClawChromium = "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
    if (fs.existsSync(openClawChromium)) {
      launchOptions.executablePath = openClawChromium;
    }
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...launchOptions,
    extraHTTPHeaders: bypassSecret
      ? {
          "x-vercel-protection-bypass": bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }
      : {},
  });
  const page = await context.newPage();

  const failedRequests = [];
  const badResponses = [];
  const consoleErrors = [];
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText || "unknown",
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      badResponses.push({
        url: response.url(),
        status: response.status(),
        contentType: response.headers()["content-type"] || "",
      });
    }
  });

  try {
    await page.goto(safeUrlJoin(baseUrl, "/login"), { waitUntil: "domcontentloaded", timeout: 60_000 });
    if ((await bodyText(page)).includes("Failed to verify your browser")) {
      throw new Error("Blocked by Vercel Security Checkpoint before login. Add VERCEL_AUTOMATION_BYPASS_SECRET.");
    }

    await page.locator('input[type="email"]').fill(username);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForFunction(() => Boolean(localStorage.getItem("token")), null, { timeout: 45_000 });

    await page.goto(safeUrlJoin(baseUrl, "/jobs/reports/sales-installs"), { waitUntil: "domcontentloaded", timeout: 60_000 });

    if (process.env.CLEAR_REPORT_CACHE === "1") {
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("report:weekly-sales-usage:v2:")) localStorage.removeItem(key);
        }
      });
    }

    if (process.env.CLEAR_ACCEPTED_AT_CACHE === "1") {
      await page.evaluate(() => localStorage.removeItem("report:weekly-sales-usage:accepted-at:v1"));
    }

    await page.getByRole("button", { name: /run report/i }).click();
    const elapsedMs = await waitForReportOutcome(page, timeoutMs);
    const acceptedAtCacheCount = await countAcceptedAtCache(page);

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      elapsedMs,
      acceptedAtCacheCount,
      screenshotPath,
      failedRequests: failedRequests.slice(-10),
      badResponses: badResponses.slice(-10),
      consoleErrors: consoleErrors.slice(-10),
    }, null, 2));
  } catch (error) {
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    console.error(JSON.stringify({
      ok: false,
      baseUrl,
      error: error instanceof Error ? error.message : String(error),
      screenshotPath,
      failedRequests: failedRequests.slice(-10),
      badResponses: badResponses.slice(-10),
      consoleErrors: consoleErrors.slice(-10),
      visibleText: (await bodyText(page)).slice(0, 800),
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
