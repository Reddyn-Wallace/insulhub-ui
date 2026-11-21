import { calendarCacheScope } from "@/lib/calendar/cache";
import { readBrowserCache, writeBrowserCache } from "@/lib/client-cache";
import { gql } from "@/lib/graphql";
import { persistSharedBrowser, readSharedBrowser } from "./shared-browser";

type SentKind = "quote" | "eba";
type EmailIndex = Record<SentKind, Record<string, string>>;
type EmailLog = { _id: string; createdAt?: string; type?: string; subject?: string; to_email?: string };
type EmailPage = { total: number; results: EmailLog[] };
type Listener = (index: EmailIndex) => void;
type Scan = { listeners: Set<Listener>; current?: EmailIndex; done: Promise<EmailIndex> };
const indexFreshMs = 10 * 60_000;
const indexDisplayMs = 60 * 60_000;
const firstPageSize = 500;
const pageSize = 1500;
const scans = new Map<string, Scan>();
export const sendReceiptPrefix = "crm-sent-cache:shared-v1:sent-receipt:";

export function laterSend(first?: string | null, second?: string | null) {
  if (!first) return second || undefined;
  if (!second) return first;
  return Date.parse(second) > Date.parse(first) ? second : first;
}

function publish(scan: Scan, index: EmailIndex, token: string) {
  if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed.");
  scan.current = index;
  for (const listener of scan.listeners) {
    try { listener(index); } catch { /* Other subscribers can still use this scan. */ }
  }
}

async function emailPage(token: string, skip: number, limit: number) {
  if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed.");
  const data = await gql<{ listEmailLogs?: EmailPage }>(
    `query EmailLogs($skip:Int,$limit:Int){listEmailLogs(skip:$skip,limit:$limit){total results{_id createdAt type subject to_email}}}`,
    { skip, limit },
    { token, timeoutMs: 12000 },
  );
  const page = data?.listEmailLogs;
  if (!page || !Number.isSafeInteger(page.total) || page.total < 0 || !Array.isArray(page.results) ||
      page.results.length > limit || page.results.length > page.total || (!page.results.length && skip < page.total)) {
    throw Error("Email history unavailable.");
  }
  return page;
}

async function scanEmailHistory(token: string, onProgress: Listener, previous?: EmailIndex) {
  const seen = new Set<string>();
  const index: EmailIndex = { quote: Object.create(null), eba: Object.create(null) };
  const found: EmailIndex = {
    quote: Object.assign(Object.create(null), previous?.quote),
    eba: Object.assign(Object.create(null), previous?.eba),
  };

  function consume(rows: EmailLog[]) {
    let changed = false;
    for (const row of rows) {
      if (!row || typeof row._id !== "string" || !row._id || seen.has(row._id)) throw Error("Email history changed while loading.");
      seen.add(row._id);
      const recipient = row.to_email?.trim().toLowerCase();
      if (!recipient || !row.createdAt || !Number.isFinite(Date.parse(row.createdAt))) continue;
      const subject = row.subject?.toLowerCase() || "";
      const type = row.type?.toLowerCase() || "";
      const kinds: SentKind[] = [];
      if (subject.includes("quote") || type === "quote") kinds.push("quote");
      if (type.includes("eba") || subject.includes("eba") || subject.includes("existing building assessment")) kinds.push("eba");
      for (const kind of kinds) {
        index[kind][recipient] = laterSend(index[kind][recipient], row.createdAt)!;
        const newest = laterSend(found[kind][recipient], row.createdAt)!;
        if (newest !== found[kind][recipient]) {
          found[kind][recipient] = newest;
          changed = true;
        }
      }
    }
    if (changed) onProgress({ quote: { ...found.quote }, eba: { ...found.eba } });
  }

  const first = await emailPage(token, 0, firstPageSize);
  consume(first.results);
  async function readRange(start: number, end: number) {
    let limitCap = pageSize;
    for (let skip = start; skip < end;) {
      const limit = Math.min(limitCap, end - skip);
      const page = await emailPage(token, skip, limit).catch(error => {
        if (limit <= 500 || localStorage.getItem("token") !== token) throw error;
        limitCap = 500;
        return emailPage(token, skip, limitCap);
      });
      consume(page.results);
      if (page.total !== first.total) throw Error("Email history changed while loading.");
      skip += page.results.length;
    }
  }

  // Check both ends of a large history promptly. Its API exposes no sort or
  // recipient filter, so a partial scan only supplies positive send evidence.
  const tail = first.total > pageSize * 2 ? first.total - pageSize : first.total;
  const head = first.results.length;
  const middle = tail - head > pageSize * 2 ? head + Math.ceil((tail - head) / 2) : tail;
  const ranges = await Promise.allSettled([readRange(head, middle), readRange(middle, tail), readRange(tail, first.total)]);
  for (const range of ranges) if (range.status === "rejected") throw range.reason;
  return index;
}

async function indexKey(token: string) {
  const scope = await calendarCacheScope(token);
  return `crm-sent-cache:history-v1:${scope}`;
}

function validIndex(value: unknown): value is EmailIndex {
  if (!value || typeof value !== "object") return false;
  const index = value as Partial<EmailIndex>;
  return [index.quote, index.eba].every(map => map && typeof map === "object" && !Array.isArray(map) &&
    Object.values(map).every(date => typeof date === "string" && Number.isFinite(Date.parse(date))));
}

async function refreshIndex(scan: Scan, token: string) {
  const key = await indexKey(token);
  if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed.");
  type Snapshot = { checkedAt: number; startedAt?: number; data: EmailIndex };
  const remembered = readBrowserCache<Snapshot>(key, indexDisplayMs);
  const snapshotIsUsable = (item?: Snapshot | null): item is Snapshot => !!item && Number.isFinite(item.checkedAt) &&
    item.checkedAt <= Date.now() && Date.now() - item.checkedAt <= indexDisplayMs && validIndex(item.data);
  const candidate = snapshotIsUsable(remembered) ? remembered : await readSharedBrowser<EmailIndex>("sent-history", key, token, indexDisplayMs);
  const cached = snapshotIsUsable(candidate) ? candidate : null;
  if (cached) {
    publish(scan, cached.data, token);
    if (Date.now() - cached.checkedAt < indexFreshMs) return cached.data;
  }
  const progressKey = `${key}:progress`;
  const progress = readBrowserCache<Snapshot>(progressKey, indexDisplayMs) ??
    await readSharedBrowser<EmailIndex>("sent-history", progressKey, token, indexDisplayMs);
  let previous = cached?.data;
  if (snapshotIsUsable(progress) && (!cached || (progress.startedAt ?? progress.checkedAt) > cached.checkedAt)) {
    previous = { quote: {}, eba: {} };
    for (const kind of ["quote", "eba"] as const) {
      const earlier = cached?.data[kind] || {};
      previous[kind] = {
        ...earlier,
        ...Object.fromEntries(Object.entries(progress.data[kind]).map(([email, date]) => [email, laterSend(earlier[email], date)!])),
      };
    }
    publish(scan, previous, token);
  }

  let savedAt = 0;
  const checkedAt = Date.now();
  const data = await scanEmailHistory(token, index => {
    publish(scan, index, token);
    const now = Date.now();
    if (now - savedAt < 2000) return;
    savedAt = now;
    const snapshot = { checkedAt: now, startedAt: checkedAt, data: index };
    writeBrowserCache(progressKey, snapshot);
    void persistSharedBrowser("sent-history", progressKey, token, snapshot, 0, 0);
  }, previous);
  publish(scan, data, token);
  const snapshot = { checkedAt, data };
  writeBrowserCache(key, snapshot);
  void persistSharedBrowser("sent-history", key, token, snapshot, 0, 0);
  return data;
}

export async function loadCrmEmailIndex(token: string, onProgress?: Listener, signal?: AbortSignal) {
  if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed.");
  let scan = scans.get(token);
  if (!scan) {
    const started: Scan = {
      listeners: new Set(),
      done: Promise.resolve().then(() => refreshIndex(started, token)).finally(() => scans.delete(token)),
    };
    scans.set(token, started);
    scan = started;
  }
  const unsubscribe = () => { if (onProgress) scan.listeners.delete(onProgress); };
  if (onProgress && !signal?.aborted) {
    scan.listeners.add(onProgress);
    signal?.addEventListener("abort", unsubscribe, { once: true });
    if (scan.current) {
      try { onProgress(scan.current); } catch { /* The scan is available to other subscribers. */ }
    }
  }
  try {
    return await scan.done;
  } finally {
    unsubscribe();
    signal?.removeEventListener("abort", unsubscribe);
  }
}

async function recordedKey(kind: SentKind, jobId: string, email: string, token: string) {
  const scope = await calendarCacheScope(token);
  return localStorage.getItem("token") === token ? `crm-sent-cache:${kind}:${scope}:${jobId}:${email}` : null;
}

export async function readRecordedSend(kind: SentKind, jobId: string, email: string, token: string) {
  const key = await recordedKey(kind, jobId, email, token);
  if (!key) return null;
  const session = readBrowserCache<string>(key, indexFreshMs);
  const shared = await readSharedBrowser<string>("sent-receipt", key, token, indexFreshMs);
  return localStorage.getItem("token") === token ? laterSend(session, shared?.data) || null : null;
}

export async function rememberRecordedSend(kind: SentKind, jobId: string, email: string, token: string, sentAt: string) {
  const key = await recordedKey(kind, jobId, email, token);
  if (!key) return;
  writeBrowserCache(key, sentAt);
  await persistSharedBrowser("sent-receipt", key, token, { checkedAt: Date.now(), data: sentAt }, 0, 0);
}
