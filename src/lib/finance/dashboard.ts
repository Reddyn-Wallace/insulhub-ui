import { trackUninvoicedJobs } from "./uninvoiced-store";
import "server-only";
import { dashboardInputs } from "./snapshot-cache";
import { calculateFinance } from "./calculate";
import { listReviewDecisions, reviewHistory } from "./review-store";
import { activeDecisions, decisionFingerprint } from "./review-validation";
export async function buildDashboard(
  owner: { userId: string; token: string },
  bankCheck = false,
  force = false,
) {
  const [input, decisions, history] = await Promise.all([
    dashboardInputs(owner, bankCheck, force),
    listReviewDecisions(owner.userId),
    reviewHistory(owner.userId),
  ]);
  const { active, stale } = activeDecisions(
    input,
    bankCheck
      ? decisions
      : decisions.filter(
          (d) =>
            d.value?.kind !== "opening" &&
            (d.value?.kind !== "receipt" ||
              input.receipts.some(
                (r) =>
                  d.value?.kind === "receipt" && r.id === d.value.receiptId,
              )),
        ),
  );
  const dashboard = calculateFinance(
    {
      ...input,
      excludedReceiptIds: stale
        .filter((d) => d.value?.kind === "receipt")
        .map((d) => d.key.slice("receipt:".length)),
    },
    active,
  );
  await trackUninvoicedJobs(
    owner.userId,
    dashboard.uninvoiced.rows.map((r) => r.jobId),
  );
  return {
    ...dashboard,
    provisional: dashboard.provisional || stale.length > 0,
    staleDecisions: stale.map((d) => d.key),
    decisions,
    history,
    jobs: input.jobs,
    fingerprints: Object.fromEntries(
      [
        ...input.receipts.map((r) => "receipt:" + r.id),
        ...input.jobs.map((j) => "job:" + j.id),
        ...input.invoices.flatMap((i) => [
          "link:" + i.id,
          "classification:" + i.id,
          "opening:" + i.id,
          "release:" + i.id,
        ]),
      ].map((key) => [key, decisionFingerprint(input, key)]),
    ),
    payments: input.payments,
  };
}
export type DashboardResponse = Awaited<ReturnType<typeof buildDashboard>>;
