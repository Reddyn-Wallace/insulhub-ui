import "server-only";

export type CampaignSchedulerActivation = {
  activated: boolean;
  error?: string;
};

export async function activateCampaignScheduler(
  runAt: string | null
): Promise<CampaignSchedulerActivation> {
  const workerUrl = process.env.CAMPAIGN_QUEUE_WORKER_URL?.trim();
  const secret = process.env.CRON_SECRET?.trim();

  if (!workerUrl || !secret) {
    const error = "Campaign scheduler is not configured";
    console.error(error);
    return { activated: false, error };
  }

  try {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/activate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ runAt }),
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Scheduler activation failed: ${response.status} ${body}`);
    }

    return { activated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduler activation failed";
    console.error(message);
    return { activated: false, error: message };
  }
}
