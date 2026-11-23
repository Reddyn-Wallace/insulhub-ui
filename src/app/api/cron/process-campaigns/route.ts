import { NextRequest, NextResponse } from "next/server";
import {
  loadCampaignQueueState,
  loadCampaignSchedule,
  processCampaignQueue,
} from "@/lib/campaign-queue";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Older Workers can overwrite an activation received during this request.
    // Keep their existing retry cadence until the safer alarm handling is live.
    const canDeferOvernight = request.headers.get("x-campaign-scheduler-capabilities") === "preserve-earlier-alarm";
    const { dueIds: campaignIds, ...initialQueue } = await loadCampaignSchedule(10, canDeferOvernight);
    const results = [];
    for (const id of campaignIds) {
      try {
        const result = await processCampaignQueue(id);
        results.push({
          campaignId: id,
          processedCount: result.processedCount,
          processResult: result.processResult,
          counts: result.counts,
        });
      } catch (error) {
        results.push({
          campaignId: id,
          error: error instanceof Error ? error.message : "Failed to process campaign",
        });
      }
    }
    const queue = campaignIds.length ? await loadCampaignQueueState(canDeferOvernight) : initialQueue;

    return NextResponse.json({
      ok: true,
      checkedCampaigns: campaignIds.length,
      results,
      queue,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process campaign queue" },
      { status: 500 }
    );
  }
}
