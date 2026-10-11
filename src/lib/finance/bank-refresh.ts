import "server-only";
import { required, safeFetch } from "./errors";
export type BankRefreshResult = {
  account: string;
  status: "updated" | "unchanged" | "unavailable";
  message: string;
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
  const readTime = async () => {
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
    return Date.parse(value);
  };
  try {
    const before = await readTime();
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
    do {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if ((await readTime()) > before)
        return {
          account,
          status: "updated",
          message: "Akahu supplied a newer bank balance update.",
        };
      if (Date.now() - before < 3600000) break;
    } while (Date.now() < deadline);
    return {
      account,
      status: "unchanged",
      message:
        "Refresh requested, but Akahu has not supplied a newer balance yet. Personal apps have a one-hour rest period. The timestamp below shows the data actually available.",
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
