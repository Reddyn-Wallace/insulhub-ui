import { createTrustedEmailHtml, emailContent } from "@/lib/communication-delivery";
import { overlaySql } from "@/lib/overlay-db";

export const campaignOpenTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function campaignOpenTrackingOrigin() {
  const configured = process.env.CAMPAIGN_OPEN_TRACKING_ORIGIN?.trim();
  const production = process.env.VERCEL_ENV === "production";
  const origin = configured || (production && (process.env.INSULHUB_PUBLIC_URL?.trim() || "https://insulhub-ui.vercel.app"));
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

export function campaignTrackedEmailHtml(body: string, origin: string, token: string) {
  return trackedEmailHtml(body, new URL(`/api/campaigns/open/${token}`, origin));
}

export function trackedEmailHtml(body: string, pixel: URL) {
  return createTrustedEmailHtml(
    `${emailContent(body).htmlBody}<img src="${pixel.href}" width="1" height="1" alt="" aria-hidden="true">`,
  );
}

const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const pixelHeaders = {
  "Content-Type": "image/gif",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function emailOpenPixelResponse(head = false) {
  return new Response(head ? null : new Uint8Array(pixel), { headers: pixelHeaders });
}

export function classifyCampaignOpen(headers: Headers): "likely" | "ambiguous" {
  const userAgent = headers.get("user-agent") || "";
  const purpose = `${headers.get("purpose") || ""} ${headers.get("sec-purpose") || ""}`;
  if (/prefetch|prerender|preview/i.test(purpose) ||
      /bot\b|scanner|preview|headless|proofpoint|mimecast|barracuda|apple.*(?:proxy|privacy)/i.test(userAgent)) {
    return "ambiguous";
  }
  // Apple Mail Privacy Protection can send a generic Mozilla/5.0 user agent.
  // Unknown clients stay out of the likely count. Gmail proxy traffic is a heuristic.
  return /\b(?:GoogleImageProxy|Thunderbird|Postbox|Microsoft Outlook)\b/i.test(userAgent)
    ? "likely"
    : "ambiguous";
}

export async function recordCampaignOpen(token: string, classification: "likely" | "ambiguous") {
  if (classification === "ambiguous") {
    await overlaySql`
      UPDATE campaign_recipients
      SET ambiguous_open_seen = true
      WHERE open_tracking_token = ${token}::uuid AND selected = true AND status IN ('pending', 'sent')
        AND NOT ambiguous_open_seen
    `;
    return;
  }

  // The conditional UPDATE deduplicates concurrent loads for the same recipient.
  await overlaySql`
    UPDATE campaign_recipients
    SET likely_open_count = likely_open_count + 1, last_likely_open_at = statement_timestamp()
    WHERE open_tracking_token = ${token}::uuid AND selected = true AND status IN ('pending', 'sent')
      AND (last_likely_open_at IS NULL OR last_likely_open_at <= statement_timestamp() - interval '1 minute')
  `;
}
