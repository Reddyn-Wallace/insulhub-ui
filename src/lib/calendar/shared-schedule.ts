import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { getCache } from "@vercel/functions";

export const sharedScheduleTtlSeconds = 60;
const cacheWaitMs = 250;
const maximumPayloadBytes = 1_000_000;
const namespace = "insulhub-ui-calendar-v1";

type Schedule = { jobs: unknown[]; unscheduled: unknown[]; checkedAt: number };

function encryptionKey(token: string) {
  return createHmac("sha256", token).update(namespace).digest();
}

// The cache is optional and shared with other projects on this hosting plan.
// Store authenticated ciphertext and let normal CRM reads handle misses.
async function optionalCache<T>(work: () => Promise<T>): Promise<T | undefined> {
  if (process.env.VERCEL !== "1") return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<undefined>(resolve => { timer = setTimeout(resolve, cacheWaitMs); }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const runtimeCache = () => getCache({ namespace });

export function readSharedSchedule<T extends Schedule>(token: string, key: string): Promise<T | undefined> {
  return optionalCache(async () => {
    const encoded = await runtimeCache().get(key);
    if (typeof encoded !== "string" || encoded.length > maximumPayloadBytes * 1.4) return undefined;
    const packed = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(token), packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(packed.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString());
    if (!Array.isArray(value?.jobs) || !Array.isArray(value?.unscheduled) || !Number.isFinite(value?.checkedAt)) {
      return undefined;
    }
    return value as T;
  });
}

export function writeSharedSchedule(token: string, key: string, tag: string, snapshot: Schedule) {
  return optionalCache(async () => {
    const plaintext = Buffer.from(JSON.stringify(snapshot));
    if (plaintext.length > maximumPayloadBytes) return;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(token), iv);
    cipher.setAAD(Buffer.from(key));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
    await runtimeCache().set(key, packed, { ttl: sharedScheduleTtlSeconds, tags: [tag] });
  });
}

export function forgetSharedSchedule(tag: string) {
  return optionalCache(() => runtimeCache().expireTag(tag));
}
