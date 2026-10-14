"use client";
import { FinanceRequestError, financeApi } from "@/components/finance/format";
import type { BankRefreshResult } from "./bank-refresh";
import type { DashboardResponse } from "./dashboard";
type Overview = DashboardResponse & {
  snapshotStale?: boolean;
  bankRefresh?: BankRefreshResult[];
};
type Listener = (data: Overview) => void;
type Entry = {
  token: string;
  data?: Overview;
  expires: number;
  listeners: Set<Listener>;
  promise: Promise<void>;
};
let entry: Entry | undefined;
let bankRefreshEntry: Entry | undefined;
export function clearFinanceOverview() {
  entry = undefined;
  bankRefreshEntry = undefined;
}
// Memory only, scoped to this login. A prefetch and page opening share the same request.
export function loadFinanceOverview(show?: Listener): Promise<void> {
  const token = localStorage.getItem("token") || "";
  if (!entry || entry.token !== token || entry.expires <= Date.now()) {
    const current: Entry = {
      token,
      expires: Infinity,
      listeners: new Set(),
      promise: Promise.resolve(),
    };
    entry = current;
    const publish = (data: Overview) => {
      if (entry !== current || localStorage.getItem("token") !== token) return;
      current.data = data;
      current.listeners.forEach((listener) => listener(data));
    };
    current.promise = (async () => {
      const saved = await financeApi("dashboard?snapshot=1");
      if (entry !== current || localStorage.getItem("token") !== token) return;
      if (saved) publish(saved);
      if (!saved || saved.snapshotStale) publish(await financeApi("dashboard"));
      // Never extend freshness beyond the actual source check.
      current.expires =
        Math.min(
          Date.now() + 300000,
          Date.parse(current.data?.checkedAt || "") + 300000,
        ) || Date.now();
    })().catch((error) => {
      if (entry === current) entry = undefined;
      throw error;
    });
  }
  const current = entry;
  if (show) {
    current.listeners.add(show);
    if (current.data) show(current.data);
  }
  return current.promise.finally(() => {
    if (show) current.listeners.delete(show);
  });
}

// Opening finance refreshes upstream bank data; the jobs-layout prefetch remains read-only.
// Concurrent mounts share one refresh. Completed refreshes do not suppress a later visit.
export function refreshFinanceOverview(show?: Listener): Promise<void> {
  const token = localStorage.getItem("token") || "";
  if (!bankRefreshEntry || bankRefreshEntry.token !== token) {
    const current: Entry = {
      token,
      data: entry?.token === token ? entry.data : undefined,
      expires: Infinity,
      listeners: new Set(),
      promise: Promise.resolve(),
    };
    entry = current;
    bankRefreshEntry = current;
    const publish = (data: Overview) => {
      if (entry !== current || localStorage.getItem("token") !== token) return;
      current.data = data;
      current.listeners.forEach((listener) => listener(data));
    };
    current.promise = (async () => {
      if (!current.data) {
        try {
          const saved = await financeApi("dashboard?snapshot=1");
          if (saved) publish(saved);
        } catch (error) {
          if (
            error instanceof FinanceRequestError &&
            (error.status === 401 || error.status === 403)
          )
            throw error;
          // A missing snapshot must not prevent a fresh source request.
        }
      }
      if (entry !== current || localStorage.getItem("token") !== token) return;
      publish(await financeApi("dashboard", { refresh: true }));
      current.expires = Date.now() + 300000;
    })()
      .catch((error) => {
        if (entry === current) entry = undefined;
        throw error;
      })
      .finally(() => {
        if (bankRefreshEntry === current) bankRefreshEntry = undefined;
      });
  }
  const current = bankRefreshEntry;
  if (show) {
    current.listeners.add(show);
    if (current.data) show(current.data);
  }
  return current.promise.finally(() => {
    if (show) current.listeners.delete(show);
  });
}
