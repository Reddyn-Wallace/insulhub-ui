import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { FinanceError, required } from "./errors";
function key() {
  const k = Buffer.from(required("FINANCE_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32)
    throw new FinanceError(503, "Finance encryption is not configured.");
  return k;
}
export function encryptTokens(owner: string, value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((v) => v.toString("base64"))
    .join(".");
}
export function decryptTokens<T>(owner: string, value: string): T {
  try {
    const [iv, tag, data] = value
      .split(".")
      .map((v) => Buffer.from(v, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"),
    );
  } catch {
    throw new FinanceError(503, "Finance credentials could not be opened.");
  }
}
