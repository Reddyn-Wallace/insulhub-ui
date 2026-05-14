import {
  type BrowserCacheStorage,
  clearBrowserCachePrefixes,
  readBrowserCache,
  writeBrowserCache,
} from "./client-cache";

type GqlOptions = {
  cacheKey?: string;
  ttlMs?: number;
  storage?: BrowserCacheStorage;
};

const inFlightQueries = new Map<string, Promise<unknown>>();

function forceLogout() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    window.location.href = "/login";
  }
}

function isUnauthenticatedMessage(message?: string) {
  const text = (message || "").toLowerCase();
  return text.includes("unauthenticated") || text.includes("unauthorized");
}

function isQueryOperation(query: string) {
  return query.trim().startsWith("query");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function queryCacheKey(query: string, variables?: Record<string, unknown>, cacheKey?: string) {
  if (cacheKey) return `gql:${cacheKey}`;
  return `gql:${query}:${stableStringify(variables || {})}`;
}

function invalidateDataCachesAfterMutation() {
  clearBrowserCachePrefixes([
    "gql:",
    "jobs-cache:",
    "job-cache:",
    "users-cache",
    "calendar:",
    "calendar-view:",
    "calendar-raw",
    "install-planning:",
    "calendar-placeholders:",
  ], ["session", "local"]);
}

export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
  options: GqlOptions = {},
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const isQuery = isQueryOperation(query);
  const cacheKey = isQuery && options.ttlMs
    ? queryCacheKey(query, variables, options.cacheKey)
    : null;

  if (cacheKey && options.ttlMs) {
    const cached = readBrowserCache<T>(cacheKey, options.ttlMs, options.storage);
    if (cached) return cached;
  }

  const requestKey = isQuery
    ? `${token || ""}:${query}:${stableStringify(variables || {})}`
    : "";

  const run = async () => {
    const res = await fetch("https://api.insulhub.nz/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-access-token": token } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401) {
      forceLogout();
      throw new Error("Unauthorized");
    }

    const json = await res.json();
    if (json.errors?.length) {
      const message = json.errors[0]?.message || "Request failed";
      if (isUnauthenticatedMessage(message)) {
        forceLogout();
        throw new Error("Unauthorized");
      }
      throw new Error(message);
    }

    const data = json.data as T;
    if (cacheKey) writeBrowserCache(cacheKey, data, options.storage);
    if (!isQuery) invalidateDataCachesAfterMutation();
    return data;
  };

  if (!isQuery) return run();

  const existing = inFlightQueries.get(requestKey);
  if (existing) return existing as Promise<T>;

  const promise = run().finally(() => inFlightQueries.delete(requestKey));
  inFlightQueries.set(requestKey, promise);
  return promise;
}
