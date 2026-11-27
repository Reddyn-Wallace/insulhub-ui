import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { GET, HEAD } from "@/app/api/campaigns/open/[token]/route";
import { campaignOpenTrackingOrigin, campaignTrackedEmailHtml, classifyCampaignOpen } from "@/lib/campaign-open-tracking-server";
import { campaignOpenStatus, selectCampaignOpenRecipients, serializeCampaignOpenTracking, summarizeCampaignOpens } from "@/lib/campaign-open-tracking";
import { deliverCommunication } from "@/lib/communication-delivery";

const { query } = vi.hoisted(() => ({ query: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: query }));

afterEach(() => {
  query.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ["Mozilla/5.0", "", "ambiguous"],
  ["GoogleImageProxy", "prefetch", "ambiguous"],
  ["GoogleImageProxy", "", "likely"],
  ["Mozilla/5.0 Thunderbird/128.0", "", "likely"],
  ["Proofpoint scanner Microsoft Outlook", "", "ambiguous"],
  ["Unknown client", "", "ambiguous"],
])("classifies %s with purpose %s as %s", (ua, purpose, expected) => {
  expect(classifyCampaignOpen(new Headers({ "user-agent": ua, "sec-purpose": purpose }))).toBe(expected);
});

it("requires explicit HTTPS tracking configuration in previews", () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CAMPAIGN_OPEN_TRACKING_ORIGIN", "");
  expect(campaignOpenTrackingOrigin()).toBeNull();
  vi.stubEnv("CAMPAIGN_OPEN_TRACKING_ORIGIN", "http://localhost:3000");
  expect(campaignOpenTrackingOrigin()).toBeNull();
  vi.stubEnv("CAMPAIGN_OPEN_TRACKING_ORIGIN", "https://preview.example/path");
  expect(campaignOpenTrackingOrigin()).toBe("https://preview.example");
});

it("adds a unique pixel only to the HTML MIME part and keeps the signature and escaped message", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "sent-message" })));
  vi.stubGlobal("fetch", fetcher);
  const token = randomUUID();
  const body = "Hi <Customer>\nThanks";
  const trustedHtml = campaignTrackedEmailHtml(body, "https://tracking.example", token);
  const result = await deliverCommunication({
    channel: "email", provider: "gmail", from: "sender@example.com", to: "customer@example.com",
    subject: "Your quote", body, trustedHtml, accessToken: "access-token",
    providerConfig: { gmailSignature: "<b>Insulmax</b>" },
  });
  expect(result.ok).toBe(true);
  const { raw } = JSON.parse(fetcher.mock.calls[0][1].body);
  const mime = Buffer.from(raw, "base64url").toString();
  const parts = [...mime.matchAll(/Content-Type: text\/(plain|html);[^\r]+\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]+?)\r\n--/g)];
  const decoded = Object.fromEntries(parts.map(([, type, encoded]) => [type, Buffer.from(encoded, "base64").toString()]));
  expect(decoded.plain).toContain(body);
  expect(decoded.plain).toContain("Insulmax");
  expect(decoded.plain).not.toContain(token);
  expect(decoded.html).toContain("Hi &lt;Customer&gt;<br>Thanks");
  expect(decoded.html).toContain(`https://tracking.example/api/campaigns/open/${token}`);
  expect(decoded.html).toContain("<b>Insulmax</b>");
});

it("returns the same non-cacheable pixel for every token and records only valid GETs", async () => {
  const token = randomUUID();
  const request = new Request("https://tracking.example/api/campaigns/open/test", {
    headers: { "user-agent": "GoogleImageProxy" },
  });
  const response = await GET(request, { params: Promise.resolve({ token }) });
  const invalid = await GET(request, { params: Promise.resolve({ token: "invalid" }) });
  expect(HEAD().headers.get("Content-Type")).toBe("image/gif");
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1]).toBe(token);
  expect(query.mock.calls[0][0].join("")).toContain("interval '1 minute'");
  expect(response.headers.get("Cache-Control")).toBe("private, no-cache, no-store, max-age=0");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Expires")).toBe("-1");
  expect(HEAD().headers.get("Cache-Control")).toBe(response.headers.get("Cache-Control"));
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(await invalid.arrayBuffer()));
});

it("counts unique sent recipients and filters and sorts them by likely activity", () => {
  const older = { id: "older", status: "sent", openTracking: { likelyCount: 3, lastLikelyAt: "2026-11-25", ambiguousSeen: true } };
  const recent = { id: "recent", status: "sent", openTracking: { likelyCount: 1, lastLikelyAt: "2026-11-27", ambiguousSeen: false } };
  const unclear = { id: "unclear", status: "sent", openTracking: { likelyCount: 0, lastLikelyAt: null, ambiguousSeen: true } };
  const undetected = { id: "undetected", status: "sent", openTracking: { likelyCount: 0, lastLikelyAt: null, ambiguousSeen: false } };
  const legacy = { id: "legacy", status: "sent" };
  const failed = { ...legacy, status: "failed" };
  const rows = [unclear, undetected, legacy, failed, older, recent];
  expect(summarizeCampaignOpens(rows)).toEqual({ tracked: 4, opened: 2, unopened: 2, repeat: 1, totalOpens: 4 });
  expect(selectCampaignOpenRecipients(rows, "opened", "recent")).toEqual([recent, older]);
  expect(selectCampaignOpenRecipients(rows, "opened", "count")).toEqual([older, recent]);
  expect(selectCampaignOpenRecipients(rows, "repeat", "recent")).toEqual([older]);
  expect(selectCampaignOpenRecipients(rows, "unopened", "recipient")).toEqual([unclear, undetected]);
  expect(campaignOpenStatus(failed)).toBeNull();
  const token = randomUUID();
  expect(serializeCampaignOpenTracking({ status: "sent", open_tracking_token: token })).toEqual(undetected.openTracking);
  expect(serializeCampaignOpenTracking({ status: "pending", open_tracking_token: token })).toBeNull();
});
