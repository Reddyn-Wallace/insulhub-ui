import { NextRequest, NextResponse } from "next/server";
import { loadDueCampaignIds, processCampaignQueue } from "@/lib/campaign-queue";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const campaignIds = await loadDueCampaignIds(10);
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

    return NextResponse.json({
      ok: true,
      checkedCampaigns: campaignIds.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process campaign queue" },
      { status: 500 }
    );
  }
}
