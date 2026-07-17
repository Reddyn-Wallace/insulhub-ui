import { DurableObject } from "cloudflare:workers";

const SCHEDULER_NAME = "insulhub";
const MINIMUM_RETRY_DELAY_MS = 60_000;
const INITIAL_ERROR_RETRY_DELAY_MS = 15 * 60_000;
const MAX_ERROR_RETRY_DELAY_MS = 6 * 60 * 60_000;
const FAILURE_COUNT_KEY = "consecutiveFailures";

async function authorized(request, env) {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const encoder = new TextEncoder();
  const supplied = request.headers.get("authorization") || "";
  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${secret}`)),
  ]);
  return crypto.subtle.timingSafeEqual(suppliedDigest, expectedDigest);
}

function queueEndpoint(env) {
  const baseUrl = env.INSULHUB_BASE_URL || "https://insulhub-ui.vercel.app";
  return `${baseUrl.replace(/\/$/, "")}/api/cron/process-campaigns`;
}

function validRunAt(value) {
  if (typeof value !== "string" || !value) return Date.now();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

async function processCampaignQueue(env) {
  const response = await fetch(queueEndpoint(env), {
    method: "GET",
    headers: {
      authorization: `Bearer ${env.CRON_SECRET}`,
      "user-agent": "insulhub-campaign-queue-worker",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Insulhub queue processing failed: ${response.status} ${body}`);
  }

  const result = JSON.parse(body);
  const pendingCount = Number(result.queue?.pendingCount || 0);
  const nextRunAt = typeof result.queue?.nextRunAt === "string" ? result.queue.nextRunAt : null;
  const hadErrors = Array.isArray(result.results)
    && result.results.some((item) => Boolean(item?.error));
  return { pendingCount, nextRunAt, hadErrors };
}

export class CampaignQueueScheduler extends DurableObject {
  async activate(runAt) {
    const requestedAt = validRunAt(runAt);
    const currentAlarm = await this.ctx.storage.getAlarm();
    await this.ctx.storage.put("initialized", true);

    if (currentAlarm === null || requestedAt < currentAlarm) {
      await this.ctx.storage.setAlarm(Math.max(Date.now(), requestedAt));
    }

    return this.status();
  }

  async ensureInitialized() {
    const initialized = await this.ctx.storage.get("initialized");
    if (!initialized) {
      // One migration-time discovery run picks up campaigns that were queued
      // before this event-driven scheduler was deployed.
      return this.activate(new Date().toISOString());
    }
    return this.status();
  }

  async status() {
    const alarmAt = await this.ctx.storage.getAlarm();
    return {
      scheduled: alarmAt !== null,
      alarmAt: alarmAt === null ? null : new Date(alarmAt).toISOString(),
    };
  }

  async applyQueueState(queue) {
    if (Number(queue?.pendingCount || 0) === 0 || !queue?.nextRunAt) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete(FAILURE_COUNT_KEY);
      return this.status();
    }

    if (queue.hadErrors) {
      await this.scheduleFailureRetry();
      return this.status();
    }

    await this.ctx.storage.delete(FAILURE_COUNT_KEY);
    const requestedAt = validRunAt(queue.nextRunAt);
    await this.ctx.storage.setAlarm(
      Math.max(requestedAt, Date.now() + MINIMUM_RETRY_DELAY_MS)
    );
    return this.status();
  }

  async scheduleFailureRetry() {
    const previousFailures = Number(
      (await this.ctx.storage.get(FAILURE_COUNT_KEY)) || 0
    );
    const failureCount = previousFailures + 1;
    const retryDelay = Math.min(
      MAX_ERROR_RETRY_DELAY_MS,
      INITIAL_ERROR_RETRY_DELAY_MS * (2 ** Math.min(previousFailures, 8))
    );
    await this.ctx.storage.put(FAILURE_COUNT_KEY, failureCount);
    await this.ctx.storage.setAlarm(Date.now() + retryDelay);
  }

  async alarm() {
    try {
      const queue = await processCampaignQueue(this.env);
      await this.applyQueueState(queue);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Campaign queue alarm failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      // Retry temporary Vercel, Neon, or provider outages without keeping the
      // database awake continuously.
      await this.scheduleFailureRetry();
    }
  }
}

function scheduler(env) {
  return env.CAMPAIGN_QUEUE_SCHEDULER.getByName(SCHEDULER_NAME);
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (!(await authorized(request, env))) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (request.method === "POST" && url.pathname === "/activate") {
      const input = await request.json().catch(() => ({}));
      const result = await scheduler(env).activate(input.runAt);
      return Response.json({ ok: true, ...result });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const result = await scheduler(env).status();
      return Response.json({ ok: true, ...result });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    // The legacy one-minute Cron Trigger is now a cheap Cloudflare-only safety
    // check. It never contacts Neon after the scheduler has been initialized.
    ctx.waitUntil(scheduler(env).ensureInitialized());
  },
};

export default worker;
