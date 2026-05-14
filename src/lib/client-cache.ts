export type BrowserCacheStorage = "session" | "local";

type CacheEnvelope<T> = {
  ts: number;
  data: T;
};

function storageFor(kind: BrowserCacheStorage) {
  if (typeof window === "undefined") return null;
  return kind === "local" ? window.localStorage : window.sessionStorage;
}

export function readBrowserCache<T>(
  key: string,
  ttlMs: number,
  storage: BrowserCacheStorage = "session",
): T | null {
  const store = storageFor(storage);
  if (!store) return null;

  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > ttlMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeBrowserCache<T>(
  key: string,
  data: T,
  storage: BrowserCacheStorage = "session",
) {
  const store = storageFor(storage);
  if (!store) return;

  try {
    store.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Storage can fail in private mode or if quota is exceeded.
  }
}

export function clearBrowserCachePrefixes(
  prefixes: string[],
  storageKinds: BrowserCacheStorage[] = ["session"],
) {
  if (typeof window === "undefined") return;

  for (const kind of storageKinds) {
    const store = storageFor(kind);
    if (!store) continue;

    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => store.removeItem(key));
    } catch {
      // Best-effort invalidation only.
    }
  }
}
