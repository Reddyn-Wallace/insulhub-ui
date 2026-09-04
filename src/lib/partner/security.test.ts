import { describe, expect, it } from "vitest";
import { genericLoginFailure, verifyMutationOrigin, verifyPartnerRequestHost } from "./security";
import { PARTNER_DEMO_CONFIRMATION } from "./demo";

describe("partner mutation security", () => {
  it("requires an exact allowed Origin", () => {
    const allowed = new Set(["https://portal.example.test"]);
    expect(verifyMutationOrigin(new Headers({ origin: "https://portal.example.test" }), allowed)).toBe(true);
    expect(verifyMutationOrigin(new Headers({ origin: "https://evil.example.test" }), allowed)).toBe(false);
    expect(verifyMutationOrigin(new Headers(), allowed)).toBe(false);
  });

  it("rejects public Host headers while explicit demo mode is active", () => {
    const env = { NODE_ENV: "test", PARTNER_DEMO_MODE: "true", PARTNER_DEMO_CONFIRM: PARTNER_DEMO_CONFIRMATION, PARTNER_APP_ORIGIN: "http://127.0.0.1:3000" } as NodeJS.ProcessEnv;
    expect(verifyPartnerRequestHost(new Headers({ host: "127.0.0.1:3000" }), env)).toBe(true);
    expect(verifyPartnerRequestHost(new Headers({ host: "localhost:3000" }), env)).toBe(true);
    expect(verifyPartnerRequestHost(new Headers({ host: "portal.example.com" }), env)).toBe(false);
    expect(verifyPartnerRequestHost(new Headers({ host: "localhost:3000", "x-forwarded-host": "public.example.com" }), env)).toBe(false);
    expect(verifyPartnerRequestHost(new Headers(), env)).toBe(false);
  });

  it("maps unknown, wrong and disabled credential failures to one response", () => {
    expect(genericLoginFailure(400)).toEqual(genericLoginFailure(401));
    expect(genericLoginFailure(403)).toEqual(genericLoginFailure(401));
    expect(genericLoginFailure(401)).toEqual({ status: 401, body: { error: "Email or password is incorrect" } });
    expect(genericLoginFailure(429)).toEqual({ status: 429, body: { error: "Email or password is incorrect" } });
  });
});
