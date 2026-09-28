import "server-only";
import { loadFinanceInputs } from "./live-data";
import { readSnapshot, writeSnapshot } from "./snapshot-store";
import type { FinanceInputs } from "./model";
// Every request still verifies its CRM owner. Encrypted snapshots survive serverless instance changes.
const cache = new Map<string, { expires: number; input: FinanceInputs }>();
const pending = new Map<string, Promise<FinanceInputs>>();
export function clearDashboardInputs() {
  cache.clear();
  pending.clear();
}
export async function dashboardInputs(
  owner: { userId: string; token: string },
  bankCheck = false,
  force = false,
) {
  const key = owner.userId + ":" + (bankCheck ? "bank" : "overview");
  const saved = cache.get(key);
  if (!force && saved && saved.expires > Date.now()) return saved.input;
  const pendingKey = force ? key + ":fresh" : key;
  const running = pending.get(key + ":fresh") || pending.get(pendingKey);
  if (running) return running;
  const promise = (async () => {
    const mode = bankCheck ? "bank" : "overview";
    if (!force) {
      const stored = await readSnapshot(owner.userId, mode).catch(() => null);
      if (stored) return stored;
    }
    const input = await loadFinanceInputs(owner, bankCheck);
    await writeSnapshot(owner.userId, mode, input).catch(() => undefined);
    return input;
  })()
    .then((input) => {
      if (cache.size > 10) cache.clear();
      const expires = Date.parse(input.checkedAt) + 300000;
      if (!cache.has(key) || cache.get(key)!.expires < expires)
        cache.set(key, { input, expires });
      return input;
    })
    .finally(() => pending.delete(pendingKey));
  pending.set(pendingKey, promise);
  return promise;
}
