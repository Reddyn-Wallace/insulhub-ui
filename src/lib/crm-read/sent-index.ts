import { calendarCacheScope } from "@/lib/calendar/cache";
import { readBrowserCache, writeBrowserCache } from "@/lib/client-cache";
import { gql } from "@/lib/graphql";
import { loadCrmRead, recentCrmRead } from "./client";

type EmailIndex = { quote: Record<string, string>; eba: Record<string, string> };
type EmailLog = { createdAt?: string; type?: string; subject?: string; to_email?: string };
const indexAgeMs = 10 * 60_000;

async function readEmailIndex(token: string): Promise<EmailIndex> {
  const index: EmailIndex = { quote: Object.create(null), eba: Object.create(null) };
  let skip = 0;
  let total = 1;
  while (skip < total) {
    const data = await gql<{ listEmailLogs?: { total: number; results: EmailLog[] } }>(
      `query EmailLogs($skip:Int,$limit:Int){listEmailLogs(skip:$skip,limit:$limit){total results{createdAt type subject to_email}}}`,
      { skip, limit: 500 },
      { token },
    );
    const page = data?.listEmailLogs;
    if (!page || !Number.isSafeInteger(page.total) || !Array.isArray(page.results)) throw Error("Email history unavailable.");
    total = page.total;
    for (const row of page.results) {
      const recipient = row.to_email?.trim().toLowerCase();
      if (!recipient || !row.createdAt || !Number.isFinite(Date.parse(row.createdAt))) continue;
      const subject = row.subject?.toLowerCase() || "";
      const type = row.type?.toLowerCase() || "";
      if ((subject.includes("quote") || type === "quote") &&
          Date.parse(row.createdAt) > (Date.parse(index.quote[recipient]) || 0)) index.quote[recipient] = row.createdAt;
      if ((type.includes("eba") || subject.includes("eba") || subject.includes("existing building assessment")) &&
          Date.parse(row.createdAt) > (Date.parse(index.eba[recipient]) || 0)) index.eba[recipient] = row.createdAt;
    }
    if (!page.results.length) break;
    skip += page.results.length;
  }
  return index;
}

export async function loadCrmEmailIndex(token: string) {
  const cached = await recentCrmRead<EmailIndex>("email", "sent", token, indexAgeMs);
  return cached?.data ?? (await loadCrmRead("email", "sent", token, () => readEmailIndex(token))).data;
}

async function ebaKey(jobId: string, email: string, token: string) {
  const scope = await calendarCacheScope(token);
  return localStorage.getItem("token") === token ? `crm-sent-cache:${scope}:${jobId}:${email}` : null;
}

export async function readRecordedEba(jobId: string, email: string, token: string) {
  const key = await ebaKey(jobId, email, token);
  return key ? readBrowserCache<string>(key, indexAgeMs) : null;
}

export async function rememberRecordedEba(jobId: string, email: string, token: string, sentAt: string) {
  const key = await ebaKey(jobId, email, token);
  if (key) writeBrowserCache(key, sentAt);
}
