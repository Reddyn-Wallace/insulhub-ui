import "server-only";
import { FinanceError, required, safeFetch } from "./errors";
export const XERO_SCOPES =
  "offline_access accounting.invoices.read accounting.payments.read accounting.settings.read";
export type XeroTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
export async function exchangeXeroTokens(
  params: URLSearchParams,
): Promise<XeroTokens> {
  const response = await safeFetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          required("XERO_CLIENT_ID") + ":" + required("XERO_CLIENT_SECRET"),
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!response.ok)
    throw new FinanceError(502, "Xero authorisation failed. Reconnect Xero.");
  const data = await response.json();
  const scope = typeof data.scope === "string" ? data.scope.split(" ") : [];
  const requiredScopes = XERO_SCOPES.split(" ");
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    typeof data.refresh_token !== "string" ||
    !data.refresh_token ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    data.expires_in > 86400 ||
    !requiredScopes.every((s) => scope.includes(s)) ||
    scope.some((s: string) => !requiredScopes.includes(s))
  )
    throw new FinanceError(
      502,
      "Xero returned an incomplete or unexpected authorisation.",
    );
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}
