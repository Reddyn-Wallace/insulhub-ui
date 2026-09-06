import { describe, expect, it } from "vitest";
import { validateSmsInput, smsProviderOutcome, runSmsAttempt } from "./job-sms";

describe("job SMS", () => {
  it("normalises NZ numbers and rejects invalid input", () => {
    expect(validateSmsInput({ body: " Hi ", destination: "021 123 4567" })).toEqual({ body: " Hi ", destination: "+64211234567" });
    expect(() => validateSmsInput({ body: " ", destination: "0211234567" })).toThrow();
    expect(() => validateSmsInput({ body: "Hi", destination: "abc0211234567" })).toThrow();
    expect(() => validateSmsInput({ body: "Hi", destination: "123" })).toThrow();
  });
  it("does not confuse service acceptance with delivery", () => {
    expect(smsProviderOutcome({ state: "Pending" }).status).toBe("accepted");
    expect(smsProviderOutcome({ state: "Delivered" }).status).toBe("delivered");
    expect(smsProviderOutcome({ state: "Failed", reason: "No service" })).toEqual({ status: "failed", failureReason: "No service" });
    expect(smsProviderOutcome({}).status).toBe("unknown");
  });
  it("only the atomic claim winner sends", async () => {
    let claimed = false; let sends = 0;
    const dependencies = {
      claim: async () => { if (claimed) return false; claimed = true; return true; },
      deliver: async () => { sends++; return { status: "accepted" as const, failureReason: "" }; },
      save: async () => {},
    };
    await Promise.all([runSmsAttempt(dependencies), runSmsAttempt(dependencies)]);
    expect(sends).toBe(1);
  });
  it("persists uncertainty after a transport failure without resending", async () => {
    let outcome: unknown;
    await runSmsAttempt({ claim: async () => true, deliver: async () => { throw Error("timeout"); }, save: async value => { outcome = value; } });
    expect(outcome).toMatchObject({ status: "unknown" });
  });
  it("does not send if persistence is unavailable", async () => {
    let sent = false;
    await expect(runSmsAttempt({ claim: async () => { throw Error("database"); }, deliver: async () => { sent = true; return { status: "accepted", failureReason: "" }; }, save: async () => {} })).rejects.toThrow("database");
    expect(sent).toBe(false);
  });
});
