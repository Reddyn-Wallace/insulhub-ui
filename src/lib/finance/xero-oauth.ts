import "server-only";
import { randomBytes } from "node:crypto";
import { FinanceError, financeOrigin, required, safeFetch } from "./errors";
import {
  saveState,
  consumeState,
  saveTokens,
  withTokens,
  pinTenant,
} from "./connection-store";
import { exchangeXeroTokens, XERO_SCOPES } from "./xero-tokens";
export { XERO_SCOPES };
export const XERO_COOKIE = "insulhub_finance_xero";
export const XERO_CALLBACK = "/api/finance/xero/callback";
export const EXPECTED_ORGANISATION =
  "Insulmax Insulation (Wellington and Wairarapa) Limited";
export async function startXeroConnection(ownerId: string) {
  if (ownerId !== required("FINANCE_OWNER_USER_ID"))
    throw new FinanceError(403, "Finance access is restricted to the owner.");
  const state = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: required("XERO_CLIENT_ID"),
    redirect_uri: financeOrigin() + XERO_CALLBACK,
    scope: XERO_SCOPES,
    state,
  });
  await saveState(state, ownerId);
  return {
    state,
    url: "https://login.xero.com/identity/connect/authorize?" + query,
  };
}
export async function finishXeroConnection(
  code: string,
  state: string,
  cookie: string,
) {
  if (
    !code ||
    code.length > 4096 ||
    !/^[\w-]{43}$/.test(state) ||
    state !== cookie
  )
    throw new FinanceError(
      400,
      "Xero connection request is invalid. Start again.",
    );
  const owner = await consumeState(state);
  if (!owner)
    throw new FinanceError(
      400,
      "Xero connection request expired or was already used.",
    );
  if (owner !== required("FINANCE_OWNER_USER_ID"))
    throw new FinanceError(403, "The finance owner has changed. Start again.");
  const tokens = await exchangeXeroTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: financeOrigin() + XERO_CALLBACK,
    }),
  );
  await saveTokens(owner, tokens);
}
export type Organisation = { id: string; name: string; eligible: boolean };
async function organisationsWithToken(
  accessToken: string,
): Promise<Organisation[]> {
  const response = await safeFetch("https://api.xero.com/connections", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!response.ok)
    throw new FinanceError(502, "Could not read connected Xero organisations.");
  const rows = await response.json();
  if (!Array.isArray(rows))
    throw new FinanceError(502, "Xero returned invalid organisations.");
  const result: Organisation[] = [];
  for (const r of rows) {
    if (typeof r.tenantId !== "string" || typeof r.tenantName !== "string")
      throw new FinanceError(502, "Xero returned invalid organisations.");
    if (
      r.tenantType === "ORGANISATION" &&
      !result.some((x) => x.id === r.tenantId)
    )
      result.push({
        id: r.tenantId,
        name: r.tenantName,
        eligible: r.tenantName === EXPECTED_ORGANISATION,
      });
  }
  return result;
}
export async function listXeroOrganisations(
  owner: string,
): Promise<Organisation[]> {
  return withTokens(owner, ({ accessToken }) =>
    organisationsWithToken(accessToken),
  );
}
export async function selectXeroOrganisation(owner: string, id: string) {
  return withTokens(owner, async ({ accessToken, generation }) => {
    const rows = await organisationsWithToken(accessToken);
    const row = rows.find((r) => r.id === id && r.eligible);
    if (!row)
      throw new FinanceError(
        400,
        "Select the Insulmax Wellington and Wairarapa organisation.",
      );
    await pinTenant(owner, row.id, row.name, generation);
  });
}
export async function withXeroAccess<T>(
  owner: string,
  operation: (accessToken: string, tenantId: string) => Promise<T>,
) {
  return withTokens(owner, ({ accessToken, tenantId }) => {
    if (!tenantId)
      throw new FinanceError(409, "Select your Xero organisation first.");
    return operation(accessToken, tenantId);
  });
}
