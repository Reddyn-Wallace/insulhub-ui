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

function forceLogout(token: string | null) {
  if (typeof window !== "undefined" && localStorage.getItem("token") === token) {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    window.location.href = "/login";
    return true;
  }
  return false;
}

function isUnauthenticatedMessage(message?: string) {
  const text = (message || "").toLowerCase();
  return text.includes("unauthenticated") || text.includes("unauthorized");
}

function displayError(message: string) {
  // The legacy API sometimes serializes the entire upstream HTTP request,
  // including authorization headers, into a GraphQL error message.
  if (/xero/i.test(message) && /TokenExpired/i.test(message)) {
    return "The CRM's Xero connection has expired. Reconnect Xero in the original InsulHub system before trying again.";
  }
  if (/Unexpected error value:|authorization|Bearer\s|set-cookie/i.test(message)) {
    return "The server could not complete this request. Contact your CRM administrator.";
  }
  return message;
}

async function isSessionInvalid(token: string | null): Promise<boolean> {
  // Invoice integrations can return their own authorization errors. Check CRM
  // identity independently; never replay a mutation to diagnose a failed request.
  try {
    const response = await fetch("https://api.insulhub.nz/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-access-token": token } : {}),
      },
      body: JSON.stringify({ query: "query SessionIdentityCheck { me { _id } }" }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) return true;
    if (!response.ok) return false;
    const result = await response.json();
    if (result.data?.me?._id) return false;
    return result.errors?.some((error: { message?: string }) =>
      /^(unauthenticated|unauthorized)[.!]?$/.test((error.message || "").trim().toLowerCase()),
    ) === true;
  } catch {
    // An outage or timeout is not evidence that the user's session expired.
    return false;
  }
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

    const json = await res.json().catch(() => {
      if (res.status === 401) return null;
      throw new Error("The server returned an unreadable response.");
    });
    if (res.status === 401 || json?.errors?.length) {
      const message = json?.errors?.[0]?.message || (res.status === 401 ? "Unauthorized" : "Request failed");
      if ((res.status === 401 || isUnauthenticatedMessage(message)) &&
          await isSessionInvalid(token) && forceLogout(token)) {
        throw new Error("Unauthorized");
      }
      throw new Error(displayError(message));
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
