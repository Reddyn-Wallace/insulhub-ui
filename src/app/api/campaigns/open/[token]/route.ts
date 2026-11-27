import { campaignOpenTokenPattern, classifyCampaignOpen, emailOpenPixelResponse, recordCampaignOpen } from "@/lib/campaign-open-tracking-server";

export function HEAD() {
  return emailOpenPixelResponse(true);
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (campaignOpenTokenPattern.test(token)) {
    try {
      await recordCampaignOpen(token, classifyCampaignOpen(request.headers));
    } catch {
      console.error("Campaign open tracking write failed");
    }
  }

  return emailOpenPixelResponse();
}
