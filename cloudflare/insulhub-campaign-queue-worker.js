async function processCampaignQueue(env) {
  const baseUrl = env.INSULHUB_BASE_URL || "https://insulhub-ui.vercel.app";
  const response = await fetch(`${baseUrl}/api/cron/process-campaigns`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${env.CRON_SECRET}`,
      "user-agent": "insulhub-campaign-queue-worker",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`InsulHub queue processing failed: ${response.status} ${body}`);
  }
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    try {
      const body = await processCampaignQueue(env);
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Queue processing failed" },
        { status: 500 }
      );
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processCampaignQueue(env));
  },
};
