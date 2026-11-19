import { clearBrowserCachePrefixes } from "@/lib/client-cache";

type Entry<T> = { data: T; at: number };
const limit = 18;
const maxAge = 30 * 60_000;

export class CalendarCacheInvalidated extends Error {}

let dataRevision = 0;
export const calendarDataRevision = () => dataRevision;
export const calendarLastWriteKey = "calendar-last-write";
export function calendarLastWrite() {
  try { return Number(localStorage.getItem(calendarLastWriteKey)) || 0; }
  catch { return 0; }
}
export function invalidateCalendarData() {
  dataRevision++;
  try { localStorage.setItem(calendarLastWriteKey, String(Math.max(Date.now(), calendarLastWrite() + 1))); }
  catch { /* Browser storage unavailable. */ }
}

export function invalidateCalendarPlanning() {
  invalidateCalendarData();
  clearBrowserCachePrefixes(["calendar:planning:", "install-planning:"]);
}

let session: { token: string; scope: Promise<string> } | undefined;
export function calendarCacheScope(token: string) {
  if (session?.token !== token) {
    const scope = crypto.subtle
      ? crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
        .then(hash => Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""))
      : Promise.resolve(String(Math.random()));
    session = { token, scope };
  }
  return session.scope;
}

export function createCalendarCache<T>(name: string) {
  const prefix = (scope: string) => `calendar:${name}:v4:${scope}:`;
  const pending = new Map<string, { request: Promise<T>; live: boolean }>();
  const fallback = new Map<string, Entry<T>>();
  let fallbackRevision = dataRevision;

  function checkRevision() {
    if (fallbackRevision !== dataRevision) {
      fallback.clear();
      fallbackRevision = dataRevision;
    }
  }

  function keys(scope: string) {
    try {
      return Object.keys(sessionStorage).filter(key => key.startsWith(prefix(scope)));
    } catch {
      return [...fallback.keys()].filter(key => key.startsWith(prefix(scope)));
    }
  }

  function read(scope: string, key: string): Entry<T> | null {
    const id = prefix(scope) + key;
    checkRevision();
    let entry = fallback.get(id) ?? null;
    if (!entry) {
      try { entry = JSON.parse(sessionStorage.getItem(id) || "null"); }
      catch { /* Storage unavailable. */ }
    }
    return entry && Date.now() - entry.at < maxAge ? entry : null;
  }

  function remove(id: string) {
    fallback.delete(id);
    try { sessionStorage.removeItem(id); } catch { /* Storage unavailable. */ }
  }

  function write(id: string, entry: Entry<T>) {
    checkRevision();
    try {
      sessionStorage.setItem(id, JSON.stringify(entry));
      fallback.delete(id);
    } catch {
      fallback.set(id, entry);
      if (fallback.size > limit) fallback.delete(fallback.keys().next().value!);
    }
  }

  function refresh(scope: string, key: string, load: () => Promise<T>, live = false): Promise<T> {
    const id = prefix(scope) + key;
    const current = pending.get(id);
    if (current && (!live || current.live)) return current.request;

    const request = load().then(data => {
      if (pending.get(id)?.request !== request) throw new CalendarCacheInvalidated();
      const older = keys(scope).filter(existing => existing !== id);
      for (const key of older.slice(0, Math.max(0, older.length - limit + 1))) remove(key);
      write(id, { data, at: Date.now() });
      return data;
    }).finally(() => {
      if (pending.get(id)?.request === request) pending.delete(id);
    });
    pending.set(id, { request, live });
    return request;
  }

  function patch(scope: string, update: (key: string, data: T) => T | undefined) {
    const scopePrefix = prefix(scope);
    for (const id of pending.keys()) {
      if (id.startsWith(scopePrefix)) pending.delete(id);
    }
    for (const id of new Set([...keys(scope), ...fallback.keys()])) {
      if (!id.startsWith(scopePrefix)) continue;
      const key = id.slice(scopePrefix.length);
      const entry = read(scope, key);
      const data = entry ? update(key, entry.data) : undefined;
      if (!entry || data === undefined) remove(id);
      else if (data !== entry.data) write(id, { ...entry, data });
    }
  }

  return { read, refresh, patch };
}
