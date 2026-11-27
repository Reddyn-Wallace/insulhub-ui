import { campaignOpenTokenPattern, classifyCampaignOpen, emailOpenPixelResponse } from "@/lib/campaign-open-tracking-server";
import { overlaySql } from "@/lib/overlay-db";

export function HEAD() {
  return emailOpenPixelResponse(true);
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (campaignOpenTokenPattern.test(token)) {
    try {
      if (classifyCampaignOpen(request.headers) === "ambiguous") {
        await overlaySql`
          UPDATE job_email_messages SET ambiguous_open_seen = true
          WHERE open_tracking_token = ${token}::uuid AND status IN ('sending', 'sent')
            AND NOT ambiguous_open_seen
        `;
      } else {
        await overlaySql`
          UPDATE job_email_messages
          SET likely_open_count = likely_open_count + 1, last_likely_open_at = statement_timestamp()
          WHERE open_tracking_token = ${token}::uuid AND status IN ('sending', 'sent')
            AND (last_likely_open_at IS NULL OR last_likely_open_at <= statement_timestamp() - interval '1 minute')
        `;
      }
    } catch {
      console.error("Job email open tracking write failed");
    }
  }
  return emailOpenPixelResponse();
}
