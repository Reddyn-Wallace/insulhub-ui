import "server-only";
import { required, safeFetch } from "./errors";
export type BankRefreshResult = {
  account: string;
  status: "updated" | "partial" | "unchanged" | "unavailable";
  message: string;
  reason?: "rest-period";
  balanceUpdated?: boolean;
  transactionsUpdated?: boolean;
};
let running: Promise<BankRefreshResult[]> | undefined;
async function refreshAccount(
  id: string,
  account: string,
): Promise<BankRefreshResult> {
  const headers = {
    Authorization: "Bearer " + required("AKAHU_USER_TOKEN"),
    "X-Akahu-Id": required("AKAHU_APP_TOKEN"),
  };
  const path = "https://api.akahu.io/v1/";
  const readTimes = async () => {
    const r = await safeFetch(path + "accounts/" + encodeURIComponent(id), {
      headers,
    });
    if (!r.ok) throw Error("read");
    const d = await r.json();
    const value = d.item?.refreshed?.balance;
    if (
      d.success !== true ||
      d.item?._id !== id ||
      typeof value !== "string" ||
      !Number.isFinite(Date.parse(value))
    )
      throw Error("time");
    const transactions = d.item?.refreshed?.transactions;
    return {
      balance: Date.parse(value),
      transactions:
        typeof transactions === "string" &&
        Number.isFinite(Date.parse(transactions))
          ? Date.parse(transactions)
          : null,
    };
  };
  try {
    const before = await readTimes();
    if (
      Date.now() - Math.max(before.balance, before.transactions || 0) <
      3600000
    ) {
      return {
        account,
        status: "unchanged",
        reason: "rest-period",
        message:
          "Akahu refreshed this account within the last hour. Its one-hour rest period may delay another update; balance and transaction timestamps below show the data available.",
      };
    }
    const response = await safeFetch(
      path + "refresh/" + encodeURIComponent(id),
      { method: "POST", headers },
    );
    if (response.status === 429)
      return {
        account,
        status: "unchanged",
        message:
          "Akahu has rate-limited this refresh. Showing its latest available balance; try again later.",
      };
    if (!response.ok || (await response.json()).success !== true)
      throw Error("refresh");
    const deadline = Date.now() + 45000;
    let balanceUpdated = false,
      transactionsUpdated = false;
    do {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const after = await readTimes();
      balanceUpdated = after.balance > before.balance;
      transactionsUpdated =
        after.transactions !== null &&
        after.transactions > (before.transactions ?? 0);
      if (balanceUpdated && transactionsUpdated)
        return {
          account,
          status: "updated",
          balanceUpdated,
          transactionsUpdated,
          message: "Akahu supplied newer balance and transaction updates.",
        };
    } while (Date.now() < deadline);
    return {
      account,
      status: balanceUpdated || transactionsUpdated ? "partial" : "unchanged",
      balanceUpdated,
      transactionsUpdated,
      message: balanceUpdated
        ? "Balance updated, but transactions have not updated yet. Showing the latest available transactions with their actual timestamp."
        : transactionsUpdated
          ? "Transactions updated, but the balance has not updated yet. Showing the latest available balance with its actual timestamp."
          : "Refresh requested, but Akahu has not supplied newer balances or transactions yet. Personal apps have a one-hour rest period. The timestamps below show the data actually available.",
    };
  } catch {
    return {
      account,
      status: "unavailable",
      message:
        "Could not verify a bank refresh. Showing the latest available data; try again later or check the connection in Akahu.",
    };
  }
}
export function refreshBankAccounts(): Promise<BankRefreshResult[]> {
  if (running) return running;
  const accounts = [
    { id: required("AKAHU_ACCOUNT_ID"), name: "Operating account" },
    ...(process.env.AKAHU_CREDIT_CARD_ACCOUNT_ID?.trim()
      ? [
          {
            id: process.env.AKAHU_CREDIT_CARD_ACCOUNT_ID.trim(),
            name: "Visa Business",
          },
        ]
      : []),
  ];
  running = Promise.all(
    accounts.map((a) => refreshAccount(a.id, a.name)),
  ).finally(() => {
    running = undefined;
  });
  return running;
}
