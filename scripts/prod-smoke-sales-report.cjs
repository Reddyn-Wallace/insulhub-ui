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

function isVercelCheckpointText(text) {
  const lower = text.toLowerCase();
  return lower.includes("failed to verify your browser")
    || lower.includes("vercel security checkpoint")
    || lower.includes("/.well-known/vercel/security/request-challenge");
}

async function waitForReportOutcome(page, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await bodyText(page);
    const lower = text.toLowerCase();

    if (isVercelCheckpointText(text)) {
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

async function reportCacheStatus(page) {
  const text = await bodyText(page);
  if (text.includes("Loaded from shared cache")) return "hit";
  if (text.includes("Refreshed from InsulHub")) return "refresh";
  if (text.includes("Built and cached")) return "miss";
  return "unknown";
}

async function hasToken(page) {
  return page.evaluate(() => Boolean(localStorage.getItem("token"))).catch(() => false);
}

async function pageHasLoginForm(page) {
  const emailCount = await page.locator('input[type="email"]').count().catch(() => 0);
  const passwordCount = await page.locator('input[type="password"]').count().catch(() => 0);
  return emailCount > 0 && passwordCount > 0;
}

async function waitForLoginOutcome(page) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    if (await hasToken(page)) return;
    const text = await bodyText(page);
    if (text.toLowerCase().includes("wrong email or password")) {
      throw new Error("Login rejected by InsulHub. Refresh .credentials/insulhub-login.env or reuse a valid persistent profile.");
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for InsulHub login token.");
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
    const reportUrl = safeUrlJoin(baseUrl, "/jobs/reports/sales-installs");

    await page.goto(reportUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (isVercelCheckpointText(await bodyText(page))) {
      throw new Error("Blocked by Vercel Security Checkpoint. Add VERCEL_AUTOMATION_BYPASS_SECRET.");
    }

    if (!(await hasToken(page)) || await pageHasLoginForm(page)) {
      await page.goto(safeUrlJoin(baseUrl, "/login"), { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (isVercelCheckpointText(await bodyText(page))) {
        throw new Error("Blocked by Vercel Security Checkpoint before login. Add VERCEL_AUTOMATION_BYPASS_SECRET.");
      }

      await page.locator('input[type="email"]').fill(username);
      await page.locator('input[type="password"]').fill(password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await waitForLoginOutcome(page);

      await page.goto(reportUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (isVercelCheckpointText(await bodyText(page))) {
        throw new Error("Blocked by Vercel Security Checkpoint. Add VERCEL_AUTOMATION_BYPASS_SECRET.");
      }
    }

    const buttonName = process.env.FORCE_REPORT_REFRESH === "1" ? /^refresh$/i : /run report/i;
    await page.getByRole("button", { name: buttonName }).click();
    const elapsedMs = await waitForReportOutcome(page, timeoutMs);
    const cacheStatus = await reportCacheStatus(page);

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      elapsedMs,
      cacheStatus,
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
