import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encryptTokens, decryptTokens } from "./crypto";
it("encrypts tokens with owner binding and refuses tampering", () => {
  vi.stubEnv("FINANCE_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  const plain = {
    accessToken: "secret",
    refreshToken: "refresh",
    expiresAt: 123,
  };
  const a = encryptTokens("owner", plain),
    b = encryptTokens("owner", plain);
  expect(a).not.toContain("secret");
  expect(a).not.toBe(b);
  expect(decryptTokens("owner", a)).toEqual(plain);
  expect(() => decryptTokens("other", a)).toThrow();
  expect(() => decryptTokens("owner", a.slice(0, -4) + "AAAA")).toThrow();
});
it("requires a full length encryption key", () => {
  vi.stubEnv("FINANCE_ENCRYPTION_KEY", "short");
  expect(() => encryptTokens("owner", {})).toThrow();
});
