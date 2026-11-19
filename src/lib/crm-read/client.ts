import { calendarCacheScope, calendarDataRevision, calendarLastWrite } from "@/lib/calendar/cache";
import { readBrowserCache, writeBrowserCache } from "@/lib/client-cache";

export type RecentCrmRead<T> = { checkedAt: number; data: T };
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
  return entry && entry.checkedAt >= calendarLastWrite() ? entry : null;
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
    const result = { checkedAt, data };
    if (kind === "detail") {
      detailHandoffs.delete(key);
      if (detailHandoffs.size >= 12) detailHandoffs.delete(detailHandoffs.keys().next().value!);
      detailHandoffs.set(key, result);
    } else {
      writeBrowserCache(key, result);
    }
    return result;
  })().finally(() => { pending.delete(requestKey); });
  pending.set(requestKey, request);
  return request;
}
