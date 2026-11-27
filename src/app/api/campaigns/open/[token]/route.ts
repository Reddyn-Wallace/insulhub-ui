import { campaignOpenTokenPattern, classifyCampaignOpen, recordCampaignOpen } from "@/lib/campaign-open-tracking-server";

const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const headers = {
  "Content-Type": "image/gif",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function HEAD() {
  return new Response(null, { headers });
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

  return new Response(new Uint8Array(pixel), { headers });
}
