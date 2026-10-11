"use client";
import { financeApi } from "@/components/finance/format";
import type { DashboardResponse } from "./dashboard";
type Overview = DashboardResponse & { snapshotStale?: boolean };
type Listener = (data: Overview) => void;
type Entry = {
  token: string;
  data?: Overview;
  expires: number;
  listeners: Set<Listener>;
  promise: Promise<void>;
};
let entry: Entry | undefined;
export function clearFinanceOverview() {
  entry = undefined;
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
