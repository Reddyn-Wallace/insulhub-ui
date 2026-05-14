import "server-only";
import { NextRequest, NextResponse } from "next/server";

const INSULHUB_GRAPHQL_URL = "https://api.insulhub.nz/graphql";
const AUTH_CACHE_TTL_MS = 60 * 1000;
const authOkCache = new Map<string, number>();

function tokenFromRequest(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-access-token") || "";
}

export async function requireInsulhubAuth(request: NextRequest) {
  const token = tokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cachedAt = authOkCache.get(token);
  if (cachedAt && Date.now() - cachedAt < AUTH_CACHE_TTL_MS) {
    return null;
  }

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
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await response.json();
    if (json.errors?.length) {
      authOkCache.delete(token);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    authOkCache.set(token, Date.now());
    return null;
  } catch {
    return NextResponse.json({ error: "Could not verify auth" }, { status: 503 });
  }
}
