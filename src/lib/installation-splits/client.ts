import { clearBrowserCachePrefixes } from "@/lib/client-cache";
import type { SavedSplit } from "./projection";
export async function splitRequest<T>(url: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem("token");
  if (!token) throw Error("Please sign in to manage installation visits.");
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-access-token": token },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "Could not load installation visits.");
  return data;
}
export async function loadSplits(jobIds: string[]) {
  const combined: Record<string, SavedSplit> = {};
  for (let start = 0; start < jobIds.length; start += 1000) {
    const { splits } = await splitRequest<{
      splits: Record<string, SavedSplit>;
    }>("/api/installation-splits", {
      jobIds: jobIds.slice(start, start + 1000),
    });
    Object.assign(combined, splits);
  }
  return combined;
}
let splitRevision = 0;
export function getSplitRevision() { return splitRevision; }
export function invalidateSplitCaches() {
  splitRevision++;
  clearBrowserCachePrefixes(
    [
      "calendar:",
      "calendar-view:",
      "calendar-raw",
      "gql:",
      "job-cache:",
      "jobs-cache:",
    ],
    ["session", "local"],
  );
}


export async function loadPendingSplits() {
  const {splits} = await splitRequest<{splits:Record<string,SavedSplit>}>("/api/installation-splits",{pending:true});
  return splits;
}
