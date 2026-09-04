import "server-only";
import { NextRequest, NextResponse } from "next/server";

const INSULHUB_GRAPHQL_URL = "https://api.insulhub.nz/graphql";
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const authOkCache = new Map<string, number>();
const authInFlight = new Map<string, Promise<NextResponse | null>>();

export function tokenFromRequest(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-access-token") || "";
}

export async function requireInsulhubAuth(request: NextRequest) {
  const token = tokenFromRequest(request);
  if (!token || token.length > 8192 || /[\r\n]/.test(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cachedAt = authOkCache.get(token);
  if (cachedAt && Date.now() - cachedAt < AUTH_CACHE_TTL_MS) {
    return null;
  }

  const inFlight = authInFlight.get(token);
  if (inFlight) return inFlight;

  const check = (async () => {
    try {
      const response = await fetch(INSULHUB_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({
          query: "query OverlayAuthCheck { users { results { _id } } }",
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const json = await response.json();
      if (json.errors?.length || !Array.isArray(json.data?.users?.results) || !json.data.users.results.every((user: unknown) => user && typeof user === "object" && typeof (user as { _id?: unknown })._id === "string" && Boolean((user as { _id: string })._id))) {
        authOkCache.delete(token);
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (authOkCache.size >= 1000) authOkCache.clear();
      authOkCache.set(token, Date.now());
      return null;
    } catch {
      return NextResponse.json({ error: "Could not verify auth" }, { status: 503 });
    } finally {
      authInFlight.delete(token);
    }
  })();

  authInFlight.set(token, check);
  return check;
}
