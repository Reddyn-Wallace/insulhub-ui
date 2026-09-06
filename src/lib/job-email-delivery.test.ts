import { afterEach, expect, it, vi } from "vitest";
import { deliverCommunication, GmailPreflightError, type DeliveryMessage } from "./communication-delivery";
const input: DeliveryMessage = { channel: "email", provider: "gmail", strictGmailConnection: true, from: "staff@example.com", to: "customer@example.com", subject: "Booking", body: "Exact message", accessToken: "selected-token", tokenExpiresAt: new Date(Date.now() + 3600000).toISOString() };
afterEach(() => vi.unstubAllGlobals());
it("retains Gmail message and conversation identifiers", async () => {
  vi.stubGlobal("fetch", async (url: string) => Response.json(url.includes("sendAs") ? { sendAsEmail: input.from, isPrimary: true } : { id: "gmail-message", threadId: "gmail-thread" }));
  expect(await deliverCommunication(input)).toMatchObject({ ok: true, providerMessageId: "gmail-message", providerThreadId: "gmail-thread" });
});
it("marks a server error as uncertain rather than a definite rejection", async () => {
  vi.stubGlobal("fetch", async (url: string) => url.includes("sendAs") ? Response.json({ sendAsEmail: input.from, isPrimary: true }) : Response.json({ error: "Unavailable" }, { status: 503 }));
  expect(await deliverCommunication(input)).toMatchObject({ ok: false, uncertain: true });
});
it("does not treat a definite recipient rejection as uncertain", async () => {
  vi.stubGlobal("fetch", async (url: string) => url.includes("sendAs") ? Response.json({ sendAsEmail: input.from, isPrimary: true }) : Response.json({ error: "Invalid recipient" }, { status: 400 }));
  expect(await deliverCommunication(input)).toMatchObject({ ok: false, uncertain: false });
});
it("records an RFC message identifier in the outgoing email and preserves signature content", async () => {
  let raw = "";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("sendAs")) return Response.json({ sendAsEmail: input.from, isPrimary: true });
    raw = Buffer.from(JSON.parse(String(init.body)).raw, "base64url").toString();
    return Response.json({ id: "gmail-message", threadId: "gmail-thread" });
  });
  await deliverCommunication({ ...input, ...{ messageId: "<attempt@insulhub.nz>" }, providerConfig: { gmailSignature: "<b>Staff</b>" } });
  expect(raw).toContain("Message-ID: <attempt@insulhub.nz>");
  expect(raw).toContain(Buffer.from("Exact message\n\nStaff").toString("base64"));
});
it("does not retry a send when the provider response is lost", async () => {
  let submissions = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("sendAs")) return Response.json({ sendAsEmail: input.from, isPrimary: true });
    submissions++; throw Error("response lost");
  });
  await expect(deliverCommunication(input)).rejects.toThrow("response lost"); expect(submissions).toBe(1);
});
it("never sends through a connection that does not authorise the selected From address", async () => {
  let submissions = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("sendAs")) return Response.json({ sendAsEmail: "wrong@example.com", isPrimary: true });
    submissions++; return Response.json({ id: "unexpected" });
  });
  await expect(deliverCommunication(input)).rejects.toBeInstanceOf(GmailPreflightError); expect(submissions).toBe(0);
});
it("treats revoked refresh credentials as definitely unsent", async () => {
  vi.stubEnv("GMAIL_CLIENT_ID", "test-client"); vi.stubEnv("GMAIL_CLIENT_SECRET", "test-secret");
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { urls.push(url); return Response.json({ error: "invalid_grant" }, { status: 400 }); });
  try {
    await expect(deliverCommunication({ ...input, accessToken: "", tokenExpiresAt: null, refreshToken: "revoked" })).rejects.toBeInstanceOf(GmailPreflightError);
    expect(urls).toEqual(["https://oauth2.googleapis.com/token"]);
  } finally { vi.unstubAllEnvs(); }
});
