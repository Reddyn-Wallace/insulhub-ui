import "server-only";
import { financePool } from "./connection-store";
import { FinanceError } from "./errors";
import type { FinanceInputs, ReviewDecision, ReviewValue } from "./model";
import {
  activeDecisions,
  decisionFingerprint,
  validateReview,
} from "./review-validation";
const columns =
  'decision_key as key, revision, fingerprint, value, updated_at as "updatedAt"';
export async function listReviewDecisions(
  owner: string,
): Promise<ReviewDecision[]> {
  return (
    await financePool().query(
      `SELECT ${columns} FROM finance_review_decisions WHERE owner_id=$1`,
      [owner],
    )
  ).rows;
}
export async function reviewHistory(owner: string) {
  return (
    await financePool().query(
      'SELECT decision_key as key,revision,value,recorded_at as "updatedAt" FROM finance_review_events WHERE owner_id=$1 ORDER BY id DESC LIMIT 50',
      [owner],
    )
  ).rows;
}
export async function saveReviewDecision(
  owner: string,
  d: FinanceInputs,
  body: {
    key: string;
    revision: number;
    fingerprint: string;
    value: ReviewValue | null;
    targetFingerprints?: Record<string, string>;
  },
) {
  if (
    !body ||
    typeof body.key !== "string" ||
    !Number.isInteger(body.revision) ||
    body.revision < 0 ||
    typeof body.fingerprint !== "string"
  )
    throw new FinanceError(400, "Invalid review request.");
  const client = await financePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "finance-review:" + owner,
    ]);
    const all = (
      await client.query(
        `SELECT ${columns} FROM finance_review_decisions WHERE owner_id=$1`,
        [owner],
      )
    ).rows as ReviewDecision[];
    const previous = all.find((x) => x.key === body.key);
    if ((previous?.revision || 0) !== body.revision)
      throw new FinanceError(
        409,
        "This decision changed in another window. Refresh before saving.",
      );
    const fingerprint = decisionFingerprint(d, body.key);
    if (body.value) {
      if (!fingerprint || fingerprint !== body.fingerprint)
        throw new FinanceError(
          409,
          "Source evidence changed. Refresh before saving.",
        );
      let key: string;
      try {
        key = validateReview(
          d,
          activeDecisions(
            d,
            all.filter((x) => x.key !== body.key),
          ).active,
          body.value,
        );
      } catch (e) {
        throw new FinanceError(
          400,
          e instanceof Error ? e.message : "Invalid review decision.",
        );
      }
      if (key !== body.key)
        throw new FinanceError(400, "Review target does not match.");
      const targets =
        body.value.kind === "receipt"
          ? body.value.allocations.map((a) => "link:" + a.invoiceId)
          : body.value.kind === "link"
            ? ["job:" + body.value.jobId]
            : [];
      for (const target of targets)
        if (
          body.targetFingerprints?.[target] !== decisionFingerprint(d, target)
        )
          throw new FinanceError(
            409,
            "The selected invoice or job changed. Refresh before confirming.",
          );
    } else if (!previous?.value)
      throw new FinanceError(400, "No active decision to undo.");
    const rev = body.revision + 1,
      args = [
        owner,
        body.key,
        rev,
        body.value ? decisionFingerprint(d, body.key, body.value) : fingerprint,
        body.value ? JSON.stringify(body.value) : null,
      ];
    await client.query(
      "INSERT INTO finance_review_decisions(owner_id,decision_key,revision,fingerprint,value) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(owner_id,decision_key) DO UPDATE SET revision=excluded.revision,fingerprint=excluded.fingerprint,value=excluded.value,updated_at=now()",
      args,
    );
    await client.query(
      "INSERT INTO finance_review_events(owner_id,decision_key,revision,fingerprint,value) VALUES($1,$2,$3,$4,$5::jsonb)",
      args,
    );
    await client.query("COMMIT");
    return { revision: rev };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
