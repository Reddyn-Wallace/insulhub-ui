# Partner portal release status

## Included

- Individual invite/password-reset/manual-password accounts scoped to one partner company.
- Company and user management inside normal InsulHub Settings; no separate operations application.
- Company-wide draft visibility, tenant isolation, autosaving lead/quote forms and draft deletion.
- InsulHub address autocomplete, current quote pricing logic, zero deposit/consent, and company-name lead attribution.
- Reused InsulHub floor-plan drawing behaviour with draft/complete state and regenerated replacement PDFs.
- Immediate idempotent server-side submission to InsulHub, read-only submitted details, one-time branded internal notification, manual linking to an existing InsulHub job, EBA/install/completion status and plain amendments. No partner scheduler or automatic retry service is required.
- Historical snapshot schema v1 compatibility plus neutral schema v2 for all new submissions.

Invoice, billing-model, commission, remittance and settlement handling is intentionally deferred until the real partner process is agreed. It is not shown in the partner portal or active Settings APIs.

## Verified evidence

- The labelled live pilot created and read back InsulHub job #28859 with its quote and completed floor plan.
- Tenant/IDOR, auth/session, autosave, quote math, PDF, submission, notification, manual-link and status tests cover success, concurrency and failure boundaries.
- The real PostgreSQL gate validates every numbered migration, restricted role, immutable record and rollback/reapply path.
- Desktop/mobile browser reviews cover the normal InsulHub Settings surface and partner portal without a separate `/partner-ops` workflow.

## Production operation

Follow [partner-launch-chunks.md](./partner-launch-chunks.md) for rollout and [partner-live-transfer-runbook.md](./partner-live-transfer-runbook.md) for transfer recovery. Historical per-chunk notes document development only and must not be used as current operating instructions.
