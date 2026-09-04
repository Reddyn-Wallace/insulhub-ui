# Partner portal production rollout

This is the current operator checklist. Earlier chunk documents are implementation history, not rollout instructions.

## Active scope

- Partner users sign in at `/partner`, create leads and quotes, reuse the InsulHub floor-plan editor, and submit completed work.
- New submissions use neutral immutable snapshot schema v2. Historic schema-v1 submissions remain readable without rewriting their hashes or commercial fields.
- InsulHub remains the source of truth after submission. The partner view shows EBA completion, installation date, job completion, and plain staff amendments.
- Any authenticated InsulHub user can manage partner companies/users in Settings → Partners and add a partner-visible update on a linked job.
- Invoice, billing-model, commission, remittance and settlement workflows are deliberately deferred and have no active partner or Settings UI/API.

## Production sequence

1. Run the complete disposable PostgreSQL gate through migration 020. Stop if any up/down, constraint, role, v1/v2 compatibility or append-only probe fails.
2. While the old production application remains live, apply all additive partner migrations and create the three restricted database logins. No partner routes exist in the old release, so this is the expand phase.
3. Configure the canonical app origins, distinct database URLs/role names, auth secret, credential keyring and legacy-origin allowlist.
4. Deploy the single reviewed application artifact. Check normal InsulHub pages, Settings → Partners, `/partner/login` and the restricted-role assertions.
5. Sign in with the pilot partner account. Submitting now runs the protected transfer and notification immediately in the same request; there is no partner scheduler or unattended retry service.
6. Do not create another test lead. The labelled production submission already verified as InsulHub job #28859 is the live integration evidence. Use read-only linkage/status checks for final smoke testing.

## Rollback boundary

Before the first v2 submission freezes, submissions can be stopped by removing the submission database URL from a replacement deployment, then the application can be rolled back. After a v2 snapshot or idempotent staff amendment exists, migration 020 intentionally refuses downgrade because changing immutable history would be unsafe. From that point, roll forward with the same dual-read schema instead of rolling the database back.

## Required evidence

- All automated tests, TypeScript, production build, targeted lint and real-PostgreSQL gate pass.
- Normal InsulHub remains usable and Settings → Partners is accessible.
- Partner login, company isolation, draft autosave, floor-plan completion, submitted read-only details and status display work.
- A successful Submit response is returned only after the InsulHub lead, quote and plans are confirmed. An unsuccessful transfer freezes safely and tells the partner to contact InsulMAX for manual creation/linking.
- No browser storage, response or log exposes legacy credentials, auth secrets or mailbox tokens.
