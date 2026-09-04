import { draftRecoveryKey, type DraftRecoveryStorage } from "./draft";
import { sitePlanRecoveryKey } from "./site-plan-client";

/** Only discard this user's browser copies after confirmed server deletion. */
export function clearDeletedDraftRecovery(storage: DraftRecoveryStorage | null, scope: string, jobId: string): void {
  if (!storage || !scope || !jobId) return;
  try {
    const draftKey = draftRecoveryKey(scope, jobId);
    const planPrefix = sitePlanRecoveryKey(scope, jobId, "");
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === draftKey || key === `${draftKey}:conflict` || key?.startsWith(planPrefix)) keys.push(key);
    }
    for (const key of keys) { try { storage.removeItem(key); } catch { /* Best effort; records remain inaccessible on the server. */ } }
  } catch { /* Browser storage is optional. */ }
}
