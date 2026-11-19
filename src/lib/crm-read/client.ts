import { calendarCacheScope, calendarDataRevision, calendarLastWrite } from "@/lib/calendar/cache";
import { readBrowserCache, writeBrowserCache } from "@/lib/client-cache";
import { persistSharedBrowser, readSharedBrowser, sharesAcrossTabs } from "./shared-browser";

export type RecentCrmRead<T> = { checkedAt: number; writeAt?: number; data: T; recovered?: true };
export const crmFreshMs = 30_000;
const crmDisplayMs = 30 * 60_000;
const detailHandoffs = new Map<string, RecentCrmRead<unknown>>();
const pending = new Map<string, Promise<RecentCrmRead<unknown>>>();

async function readKey(kind: string, id: string, token: string) {
  const scope = await calendarCacheScope(token);
  return localStorage.getItem("token") === token ? `jobs-cache:crm-v1:${kind}:${scope}:${id}` : null;
}

export async function recentCrmRead<T>(kind: string, id: string, token: string, maxAge = crmDisplayMs, consume = false) {
  const key = await readKey(kind, id, token);
  if (!key) return null;
  if (kind === "detail") {
    const entry = detailHandoffs.get(key) as RecentCrmRead<T> | undefined;
    if (consume) detailHandoffs.delete(key);
    return entry && Date.now() - entry.checkedAt < maxAge && entry.checkedAt >= calendarLastWrite() ? entry : null;
  }
  const entry = readBrowserCache<RecentCrmRead<T>>(key, maxAge);
  const latestWrite = calendarLastWrite();
  if (entry && Date.now() - entry.checkedAt <= maxAge &&
      (entry.writeAt === undefined ? entry.checkedAt >= latestWrite : entry.writeAt === latestWrite)) return entry;
  if (!sharesAcrossTabs(kind)) return null;
  const shared = await readSharedBrowser<T>(kind, key, token, maxAge);
  if (!shared) return null;
  const recovered = { ...shared, recovered: true as const };
  writeBrowserCache(key, recovered);
  return recovered;
}

export async function loadCrmRead<T>(kind: string, id: string, token: string, read: () => Promise<T>, revision = 0) {
  const key = await readKey(kind, id, token);
  if (!key) throw Error("Your sign-in changed. Please try again.");
  const writeAt = calendarLastWrite();
  const writeRevision = calendarDataRevision();
  const requestKey = `${key}:${writeAt}:${writeRevision}:${revision}`;
  const existing = pending.get(requestKey);
  if (existing) return existing as Promise<RecentCrmRead<T>>;
  const checkedAt = Date.now();
  const request = (async () => {
    const data = await read();
    if (localStorage.getItem("token") !== token || calendarLastWrite() !== writeAt || calendarDataRevision() !== writeRevision) {
      throw Error("The record changed while loading. Please try again.");
    }
    const result = { checkedAt, writeAt, data };
    if (kind === "detail") {
      detailHandoffs.delete(key);
      if (detailHandoffs.size >= 12) detailHandoffs.delete(detailHandoffs.keys().next().value!);
      detailHandoffs.set(key, result);
    } else {
      writeBrowserCache(key, result);
      if (sharesAcrossTabs(kind)) void persistSharedBrowser(kind, key, token, result, writeAt, writeRevision);
    }
    return result;
  })().finally(() => { pending.delete(requestKey); });
  pending.set(requestKey, request);
  return request;
}
