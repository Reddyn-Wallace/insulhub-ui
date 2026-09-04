import "server-only";
import { randomUUID } from "node:crypto";
import { partnerDemoModeEnabled } from "./demo";
import { signalPartnerDemoSubmissionWorker } from "./demo-submission-worker";
import { ensurePartnerSubmissionWorkerRole, getPartnerSubmissionPool } from "./db";
import { productionNotificationAdapter } from "./legacy/notification";
import type { PartnerSubmissionView } from "./submission-service";
import { PartnerSubmissionWorkerEngine, redactedPartnerWorkerMetrics, type PartnerWorkerRunSummary } from "./submission-worker-engine";
import { PartnerSubmissionWorkerRepository } from "./submission-worker-repository";

export interface ImmediateSubmissionScope { companyId: string; jobId: string; requestId:string }

export interface ImmediateSubmissionDependencies {
  env: NodeJS.ProcessEnv;
  runOnce: (workerId: string, remainingMs: number, signal: AbortSignal) => Promise<PartnerWorkerRunSummary>;
  runDemo: (scope: ImmediateSubmissionScope) => Promise<unknown>;
  ensureWorker: () => Promise<void>;
}

const DEFAULT_DEADLINE_MS = 240_000;
const MINIMUM_PASS_BUDGET_MS = 8_000;

function productionDependencies(env: NodeJS.ProcessEnv,scope:ImmediateSubmissionScope): ImmediateSubmissionDependencies {
  return {
    env,
    ensureWorker: ensurePartnerSubmissionWorkerRole,
    runDemo: scope => signalPartnerDemoSubmissionWorker(scope, env),
    runOnce: async (workerId, remainingMs, signal) => {
      const repository = new PartnerSubmissionWorkerRepository(getPartnerSubmissionPool(),{immediateScope:scope});
      return new PartnerSubmissionWorkerEngine(repository, {
        env,
        deadlineMs: remainingMs,
        signal,
        metrics: redactedPartnerWorkerMetrics,
        noRetryNotifications:true,
        resolveProductionNotificationAdapter: () => productionNotificationAdapter(env),
      }).runOnce(workerId);
    },
  };
}

export async function completePartnerSubmissionImmediately(
  scope: ImmediateSubmissionScope,
  readStatus: () => Promise<PartnerSubmissionView | null>,
  signal: AbortSignal,
  injected?: Partial<ImmediateSubmissionDependencies>,
  deadlineMs = DEFAULT_DEADLINE_MS,
): Promise<PartnerSubmissionView | null> {
  const defaults = productionDependencies(injected?.env ?? process.env,scope);
  const deps = { ...defaults, ...injected };
  if (partnerDemoModeEnabled(deps.env)) {
    await deps.runDemo(scope);
    return readStatus();
  }

  await deps.ensureWorker();
  const current = await readStatus();
  if (current?.state === "SUCCEEDED" && "notification" in current && (current.notification === "DELIVERED" || current.notification === "DEAD")) return current;
  if (current?.state === "RECONCILIATION_REQUIRED" || current?.state === "FAILED_RETRYABLE" || signal.aborted || deadlineMs < MINIMUM_PASS_BUDGET_MS) return current;
  await deps.runOnce(`vercel.immediate.${randomUUID()}`,deadlineMs,signal);
  return readStatus();
}
