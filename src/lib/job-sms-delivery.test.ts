import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverJobSms, checkJobSms } from "./job-sms-delivery";
const config = { smsgateBaseUrl: "https://sms.example.test", smsgateUsername: "test", smsgatePassword: "secret", smsgateDeviceId: "chosen-device" };
const input = { id: "attempt", to: "+64211234567", body: "Exact text", providerConfig: config };
afterEach(() => vi.unstubAllGlobals());
describe("job SMS provider", () => {
  it("passes the stable ID and selected device, preserving the exact body", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: input.id, state: "Pending" })); vi.stubGlobal("fetch", fetcher);
    expect((await deliverJobSms(input)).status).toBe("accepted");
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ id: input.id, deviceId: "chosen-device", textMessage: { text: "Exact text" } });
  });
  it("does not fall back to another device on rejection", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "device not found" }, { status: 400 })); vi.stubGlobal("fetch", fetcher);
    expect((await deliverJobSms(input)).status).toBe("failed"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([408,409,500,502])("keeps HTTP %s outcomes uncertain", async status => {
    vi.stubGlobal("fetch", async () => Response.json({}, { status })); expect((await deliverJobSms(input)).status).toBe("unknown");
  });
  it("never converts status lookup failures into permission to resend", async () => {
    const fetcher = vi.fn(async () => Response.json({}, { status: 404 })); vi.stubGlobal("fetch", fetcher);
    await expect(checkJobSms("attempt", config)).rejects.toThrow("Do not resend"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
