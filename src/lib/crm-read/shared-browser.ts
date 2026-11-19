import { calendarCacheScope, calendarDataRevision, calendarLastWrite } from "@/lib/calendar/cache";
import type { RecentCrmRead } from "./client";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const maximumBytes = 1_000_000;
const maximumQuotePages = 8;
let encryption: { token: string; key: Promise<CryptoKey> } | undefined;

export const sharesAcrossTabs = (kind: string) => kind === "board" || kind === "quote-cards";

function encode(bytes: Uint8Array) {
  let value = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    value += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(value);
}

function decode(encoded: string) {
  return Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
}

async function storageKey(kind: string, cacheKey: string, token: string) {
  const [scope, hash] = await Promise.all([
    calendarCacheScope(token),
    crypto.subtle.digest("SHA-256", encoder.encode(cacheKey)),
  ]);
  const prefix = `jobs-cache:shared-v1:${kind}:${scope}:`;
  return { key: prefix + encode(new Uint8Array(hash)), prefix };
}

function keyFor(token: string) {
  if (encryption?.token !== token) {
    // Use separate material from the login fingerprint exposed in cache keys.
    const key = crypto.subtle.digest("SHA-256", encoder.encode(`insulhub-crm-read-v1:${token}`))
      .then(material => crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]));
    encryption = { token, key };
  }
  return encryption.key;
}

type EncryptedSnapshot = { checkedAt: number; nonce: string; ciphertext: string };

export async function readSharedBrowser<T>(kind: string, cacheKey: string, token: string, maxAge: number) {
  if (!crypto.subtle) return null;
  try {
    const { key } = await storageKey(kind, cacheKey, token);
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > maximumBytes * 1.4) return null;
    const envelope = JSON.parse(raw) as EncryptedSnapshot;
    if (!Number.isFinite(envelope.checkedAt) || envelope.checkedAt > Date.now() ||
        Date.now() - envelope.checkedAt > maxAge || envelope.checkedAt < calendarLastWrite()) return null;
    const decrypted = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: decode(envelope.nonce), additionalData: encoder.encode(key),
    }, await keyFor(token), decode(envelope.ciphertext));
    const entry = JSON.parse(decoder.decode(decrypted)) as RecentCrmRead<T>;
    if (localStorage.getItem("token") !== token || entry.checkedAt !== envelope.checkedAt || entry.writeAt !== calendarLastWrite()) return null;
    return entry;
  } catch {
    return null;
  }
}

function previousReadAt(key: string) {
  try {
    const value = Number(JSON.parse(localStorage.getItem(key) || "{}")?.checkedAt);
    return value <= Date.now() && value > 0 ? value : 0;
  }
  catch { return 0; }
}

function pruneQuotePages(prefix: string, current: string) {
  const entries = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix) || key === current) continue;
    entries.push({ key, at: previousReadAt(key) });
  }
  entries.sort((a, b) => b.at - a.at);
  for (const { key } of entries.slice(maximumQuotePages - 1)) localStorage.removeItem(key);
}

export async function persistSharedBrowser<T>(
  kind: string, cacheKey: string, token: string, entry: RecentCrmRead<T>, writeAt: number, writeRevision: number,
) {
  if (!crypto.subtle) return;
  try {
    const { key, prefix } = await storageKey(kind, cacheKey, token);
    const plaintext = encoder.encode(JSON.stringify(entry));
    if (plaintext.byteLength > maximumBytes) return;
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM", iv: nonce, additionalData: encoder.encode(key),
    }, await keyFor(token), plaintext);
    if (localStorage.getItem("token") !== token || writeAt !== calendarLastWrite() || writeRevision !== calendarDataRevision()) return;
    if (previousReadAt(key) >= entry.checkedAt) return;
    if (kind === "quote-cards") pruneQuotePages(prefix, key);
    localStorage.setItem(key, JSON.stringify({
      checkedAt: entry.checkedAt,
      nonce: encode(nonce),
      ciphertext: encode(new Uint8Array(ciphertext)),
    } satisfies EncryptedSnapshot));
  } catch {
    // Normal session caching and the upstream reads work without shared storage.
  }
}
