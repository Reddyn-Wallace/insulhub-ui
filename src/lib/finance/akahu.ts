import "server-only";
import { FinanceError, required, safeFetch } from "./errors";
async function akahu(path: string) {
  const r = await safeFetch("https://api.akahu.io/v1/" + path, {
    headers: {
      Authorization: "Bearer " + required("AKAHU_USER_TOKEN"),
      "X-Akahu-Id": required("AKAHU_APP_TOKEN"),
    },
  });
  if (!r.ok)
    throw new FinanceError(
      502,
      "Akahu could not supply account data. Check the connection.",
    );
  const d = await r.json();
  if (d.success !== true)
    throw new FinanceError(502, "Akahu returned an unsuccessful response.");
  return d;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}
export async function getBankSnapshot() {
  const id = required("AKAHU_ACCOUNT_ID");
  const { item } = await akahu("accounts/" + encodeURIComponent(id));
  if (item?._id !== id || item.status !== "ACTIVE")
    throw new FinanceError(502, "The selected bank account is unavailable.");
  if (
    item.balance?.currency !== "NZD" ||
    typeof item.balance.current !== "number" ||
    !Number.isFinite(item.balance.current) ||
    !Number.isSafeInteger(Math.round(item.balance.current * 100))
  )
    throw new FinanceError(
      502,
      "The selected account returned an invalid NZD balance.",
    );
  const balanceUpdatedAt = timestamp(item.refreshed?.balance),
    transactionsUpdatedAt = timestamp(item.refreshed?.transactions);
  if (!balanceUpdatedAt)
    throw new FinanceError(502, "The bank balance has no valid update time.");
  return {
    accountName: String(item.name || "Trading Account"),
    currentCents: Math.round(item.balance.current * 100),
    currency: "NZD",
    balanceUpdatedAt,
    transactionsUpdatedAt,
    stale:
      Date.now() - Date.parse(balanceUpdatedAt) > 26 * 3600000 ||
      !transactionsUpdatedAt ||
      Date.now() - Date.parse(transactionsUpdatedAt) > 26 * 3600000,
  };
}
export async function getBankTransactions(start: string, end: string) {
  const id = required("AKAHU_ACCOUNT_ID");
  const seen = new Set<string>(),
    ids = new Set<string>();
  const result: Array<{
    id: string;
    amount: number;
    date: string | null;
    description: string;
    reference: unknown;
  }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ start, end });
    if (cursor) params.set("cursor", cursor);
    const data = await akahu(
      "accounts/" + encodeURIComponent(id) + "/transactions?" + params,
    );
    if (!Array.isArray(data.items))
      throw new FinanceError(502, "Bank transactions were incomplete.");
    for (const t of data.items) {
      if (
        t._account !== id ||
        typeof t._id !== "string" ||
        typeof t.amount !== "number" ||
        !Number.isFinite(t.amount)
      )
        throw new FinanceError(502, "Invalid bank transaction.");
      if (ids.has(t._id))
        throw new FinanceError(
          502,
          "Bank transaction pages overlapped. Retry the source check.",
        );
      ids.add(t._id);
      result.push({
        id: t._id,
        amount: t.amount,
        date: timestamp(t.date),
        description: String(t.description || ""),
        reference: t.meta || null,
      });
    }
    cursor = data.cursor?.next;
    if (!cursor) return result;
    if (typeof cursor !== "string" || seen.has(cursor))
      throw new FinanceError(
        502,
        "Bank transaction pagination did not complete.",
      );
    seen.add(cursor);
  }
  throw new FinanceError(
    502,
    "Bank transaction pagination exceeded the safety limit.",
  );
}

export async function getCreditCardSnapshot() {
  const id = required("AKAHU_CREDIT_CARD_ACCOUNT_ID");
  const { item } = await akahu("accounts/" + encodeURIComponent(id));
  if (
    item?._id !== id ||
    item.status !== "ACTIVE" ||
    item.type !== "CREDITCARD"
  )
    throw new FinanceError(502, "The selected credit card is unavailable.");
  const current = item.balance?.current;
  if (
    item.balance?.currency !== "NZD" ||
    typeof current !== "number" ||
    !Number.isFinite(current) ||
    !Number.isSafeInteger(Math.round(current * 100))
  )
    throw new FinanceError(
      502,
      "The credit card returned an invalid NZD balance.",
    );
  const balanceUpdatedAt = timestamp(item.refreshed?.balance);
  if (!balanceUpdatedAt)
    throw new FinanceError(502, "The credit card has no valid update time.");
  const currentCents = Math.round(current * 100);
  return {
    name: String(item.name || "Business credit card"),
    currentCents,
    owedCents: Math.max(0, -currentCents),
    creditCents: Math.max(0, currentCents),
    balanceUpdatedAt,
    stale: Date.now() - Date.parse(balanceUpdatedAt) > 26 * 3600000,
  };
}

export async function getPendingBankTransactions() {
  const id = required("AKAHU_ACCOUNT_ID");
  const data = await akahu("transactions/pending");
  if (!Array.isArray(data.items))
    throw new FinanceError(502, "Pending bank transactions unavailable.");
  return {
    receipts: data.items
      .filter((t: { _account?: string }) => t._account === id)
      .map(
        (t: {
          amount?: number;
          date?: string;
          description?: string;
          updated_at?: string;
        }) => {
          if (
            typeof t.amount !== "number" ||
            !Number.isFinite(t.amount) ||
            !Number.isSafeInteger(Math.round(t.amount * 100)) ||
            !timestamp(t.date) ||
            !timestamp(t.updated_at) ||
            typeof t.description !== "string"
          )
            throw new FinanceError(
              502,
              "Pending bank transactions incomplete.",
            );
          return {
            amount: Math.round(t.amount * 100),
            date: t.date!,
            description: t.description,
            updatedAt: t.updated_at!,
          };
        },
      ),
  };
}
