# Partner portal Chunk E1 — submission saga foundation

## Scope

Chunk E1 adds only the immutable submission boundary and database-owned saga state. It does not add HTTP submission routes, partner submission UI, a legacy adapter, notification delivery, or worker execution. Those remain later chunks. No live database, credential, provider, deployment, or notification was changed while implementing E1.

Migration `005_partner_submission_saga` freezes one versioned whole-job snapshot and an ordered floor-plan manifest, records a tenant-scoped idempotent request, creates per-plan delivery checkpoints, and enqueues a bounded execute event. PostgreSQL reserializes the validated `jsonb` snapshot before storing and hashing it, so caller whitespace, key order, and duplicate-key raw material are discarded. TypeScript hashes are deliberately named candidate hashes; `partner_freeze_submission` returns the authoritative database snapshot and request hashes.

The frozen manifest binds company, job, snapshot, drawing, artifact, render/document hashes, PDF size, renderer/template provenance, local name, and deterministic remote name. The request UUID is deterministically derived from tenant + job + hashed idempotency key, and the remote name includes that request UUID, sort ordinal, exact artifact UUID, and content SHA-256; independent response-loss retries therefore converge on the same frozen delivery identity. Freeze verifies the derived request UUID, current artifact bytes, SHA-256, size, `%PDF-` header, renderer, template, font/render input, drawing revision, job revisions, lead/quote readiness, full plan order, and source rows while holding company → job → drawing → artifact locks. A manifest reference prevents both artifact-prune branches from deleting a submitted PDF.

## Roles and URLs

Production requires three distinct URLs and login identities:

- `PARTNER_MIGRATION_DATABASE_URL`: schema owner/migrator only.
- `PARTNER_DATABASE_URL`: member of `partner_portal_runtime`; may freeze a validated DRAFT and read safe status through narrow functions.
- `PARTNER_SUBMISSION_DATABASE_URL`: member of `partner_submission_worker`; may claim, heartbeat, checkpoint, release, reconcile, finalize, and read only its actively leased snapshot/plans.

`PARTNER_DATABASE_RUNTIME_ROLE` and `PARTNER_SUBMISSION_DATABASE_ROLE` pin the expected login names. Startup assertions fail closed in production when URLs are shared, a login can assume an owner/migration role, direct protected-table authority appears, or a function loses its exact owner, signature, `SECURITY DEFINER`, or `search_path=pg_catalog` contract.

The E2 adapter boundary required one additive E1 projection seam: `partner_submission_claimed_snapshot` now returns the frozen job prefix plus the frozen credential fingerprint/timestamp alongside the already lease-scoped encrypted envelope. FICTIONAL rows still return every live field as null. The function input signature, ACL, owner, fixed search path, down-migration drop signature, and public status projection are unchanged. E2 verifies this metadata and the encrypted envelope as one opaque server-only capability before decryption; plaintext credentials are never returned by SQL or serialized by the binding object.

Migration 005 creates the reserved `partner_submission_owner` and `partner_submission_worker` group roles itself as `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. It refuses pre-existing roles with those names. Provisioning an external worker login as a worker-group member is an explicit launch operation and was not performed here. The worker has no direct table access, cannot read auth tables or arbitrary credentials/PDFs, and cannot assume the runtime, artifact-owner, submission-owner, or migration roles.

## State and failure rules

- Freeze is tenant-idempotent. The same raw key hashes independently in different companies. Within one company, an exact semantic/revision replay returns the existing request; a different job, revision, or semantic snapshot conflicts.
- `submission_started_at` is set only at `CREATE_STARTED`, immediately before the first external create. `submitted_at` is set only by finalization.
- Claim uses `FOR UPDATE SKIP LOCKED`, a random lease token, and monotonic fence. Every worker mutation locks the exact execute event and rejects an expired/stale fence. Heartbeats and successful checkpoints renew the lease.
- Plan progress is durable at upload-started, uploaded, and attached. Remote-key replay must be exact. Plan work is illegal before quote completion.
- Normal completion notification is inserted exactly once in the same transaction that sets `SUBMITTED`. Pre-final provider failures do not announce success. Reconciliation emits a distinct operator-alert topic.
- Only a fixed safe error-code allowlist can be persisted. Provider responses, credentials, raw idempotency keys, PII, and arbitrary error strings are excluded from outbox/audit/attempt error fields.
- LIVE work freezes endpoint/credential provenance. Changing mode, contract, prefix, endpoint, key version, credential envelope, or credential timestamp stops the lease-scoped projection. FICTIONAL work receives no endpoint or credential bytes even if a company retains a live envelope.
- Submission snapshots/manifests are append-only. Runtime and worker direct changes to job state, legacy IDs, snapshot/checkpoint tables, PDF artifacts, and submission audit events are denied.
- Down migration refuses when saga/config/audit/rate-limit rows or worker memberships exist. A clean down restores the 004 job/drawing grants and prune function, then removes every E1 table, function, trigger, index, and role.

## Demo and storage

The fictional pg-mem database stores a small placeholder BYTEA for generated PDFs, while the actual demo PDF is held in process memory. E1 resolves and verifies those actual bytes through `partnerSubmissionArtifactBytes`; missing/corrupt process bytes fail closed. Production always verifies the immutable PostgreSQL BYTEA. This demo adapter exception does not weaken the real migration or LIVE path.

Snapshots are bounded to 6 MiB, manifests to 20 plans, and PDFs to 5 MiB each. The persisted snapshot stores each plan document once; canonical document/render strings remain transient manifest inputs. A domain test constructs 20 floors at the wall/note count and aggregate-text maxima and confirms that this largest accepted shape remains below the whole-snapshot cap; malformed inputs beyond the underlying per-document limits are rejected before freeze. Existing D1 operational guidance still applies at 70% of the 1 GiB/company PDF quota, with an external storage adapter required before the documented artifact/total-capacity thresholds.

Backups must include snapshots, manifests, requests, deliveries, attempts, outbox, audit, jobs, companies, and referenced PDF artifacts as one consistency set. Restores must preserve composite tenant identities and append-only rows. Do not prune referenced artifacts independently.

## Verification and launch blockers

The pg-mem transform removes only PostgreSQL role/trigger/definer syntax and emulates named validation functions; real migration SQL remains untouched. The disposable PostgreSQL gate requires `PARTNER_MIGRATION_TEST_DATABASE_URL` plus `PARTNER_MIGRATION_GATE_CONFIRM=RESET_DEDICATED_PARTNER_TEST_DATABASE`. It checks up/down/up, role attributes and ACLs, concurrent freeze/claim/rate-limit behavior, stale fences, exact replay, corrupt/stale PDFs, credential rotation, fictional secret isolation, prune protection, final-only notification, and destructive-down refusal.

That real-Postgres gate was not run because no safe disposable URL was supplied. It is a launch blocker, as are provisioning the distinct worker/runtime logins, enabling a reviewed versioned LIVE adapter contract, implementing E2+ repositories/routes/UI/worker execution, provider sandbox acceptance, notification delivery, recovery operations, and production capacity/backup drills.
