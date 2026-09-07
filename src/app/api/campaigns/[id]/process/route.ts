import { NextRequest, NextResponse } from "next/server";
import { jobSmsIdentity } from "@/lib/job-sms-access";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import {
  loadCampaignQueueState,
  loadQueuedRecipients,
  processCampaignQueue,
  toQueuedCampaign,
  toQueuedRecipient,
} from "@/lib/campaign-queue";
import { activateCampaignScheduler } from "@/lib/campaign-scheduler";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const { me } = await jobSmsIdentity(request);

    const { id } = await params;
    const result = await processCampaignQueue(id, me._id);
    const recipients = await loadQueuedRecipients(id);
    const queue = await loadCampaignQueueState();
    const scheduler = queue.pendingCount > 0
      ? await activateCampaignScheduler(queue.nextRunAt)
      : { activated: true };

    return NextResponse.json({
      campaign: toQueuedCampaign(result.campaign),
      recipients: recipients.map(toQueuedRecipient),
      processResult: result.processResult,
      counts: result.counts,
      scheduler,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process campaign queue" },
      { status: error instanceof Error && error.message.includes("your own sending connection") ? 403 : 500 }
    );
  }
}
