import { partnerDemoModeEnabled } from "./demo";

export const GENERIC_LOGIN_ERROR = "Email or password is incorrect";

export function genericLoginFailure(upstreamStatus: number): { status: 401 | 429; body: { error: string } } {
  return { status: upstreamStatus === 429 ? 429 : 401, body: { error: GENERIC_LOGIN_ERROR } };
}

export function normalizedOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}

export function allowedPartnerOrigins(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  partnerDemoModeEnabled(env);
  const values = [env.PARTNER_APP_ORIGIN, ...(env.PARTNER_ADDITIONAL_ORIGINS ?? "").split(",")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map(normalizedOrigin);
  return new Set(values);
}

export function verifyPartnerRequestHost(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!partnerDemoModeEnabled(env)) return true;
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const rawHost = forwarded ?? headers.get("host");
  if (!rawHost) return false;
  try {
    const hostname = new URL(`http://${rawHost}`).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function withPartnerNoStore<T extends Response>(response: T): T {
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export function verifyMutationOrigin(headers: Headers, origins = allowedPartnerOrigins()): boolean {
  const origin = headers.get("origin");
  if (!origin || origins.size === 0) return false;
  try {
    return origins.has(normalizedOrigin(origin));
  } catch {
    return false;
  }
}

export function clientAddress(headers: Headers): string {
  return headers.get("cf-connecting-ip")
    ?? headers.get("x-real-ip")
    ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}
