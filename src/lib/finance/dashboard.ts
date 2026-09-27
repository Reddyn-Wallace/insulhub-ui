import "server-only";
import { loadFinanceInputs } from "./live-data";
import { calculateFinance } from "./calculate";
import { listReviewDecisions, reviewHistory } from "./review-store";
import { activeDecisions, decisionFingerprint } from "./review-validation";
export async function buildDashboard(owner: { userId: string; token: string }) {
  const [input, decisions, history] = await Promise.all([
    loadFinanceInputs(owner),
    listReviewDecisions(owner.userId),
    reviewHistory(owner.userId),
  ]);
  const { active, stale } = activeDecisions(input, decisions);
  const dashboard = calculateFinance(input, active);
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
          "opening:" + i.id,
          "release:" + i.id,
        ]),
      ].map((key) => [key, decisionFingerprint(input, key)]),
    ),
    payments: input.payments,
  };
}
export type DashboardResponse = Awaited<ReturnType<typeof buildDashboard>>;
