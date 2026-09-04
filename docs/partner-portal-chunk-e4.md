# Partner portal Chunk E4 — bounded submission worker

Chunk E4 adds the internal, lease-fenced executor for snapshots frozen by E3. It does not add automatic browser/demo execution (E5), partner communications, internal operations UI, or an approved LIVE provider contract.

## Safety boundary

- Migration `006_partner_submission_worker` owns bounded claim, upload-attempt, attachment-attempt, verified quote, exact attachment adoption, finalization, notification receipt, retry-cap, and dead-letter transitions. Every worker read or write is tied to the current lease and fence; the restricted worker role has no direct table access and cannot call the tenant status function.
- Claims validate the immutable canonical snapshot, ordered manifest, drawing/render provenance, exact PDF bytes/SHA/size/header, request/job checkpoint graph, and delivery state before application code may select an adapter.
- The worker rejects LIVE snapshots before any resolver or network path. FICTIONAL execution is available only in tests or through the existing exact loopback demo gate; production cannot use injected fictional adapters.
- Create is never repeated after a persisted `CREATE_STARTED` checkpoint. Quote, upload, and attachment response-loss paths resume through authoritative readback or deterministic content-idempotent recovery. Finalization requires a fresh exact remote identity, quote fingerprint, and one-to-one attachment/storage-key readback.
- Submission, upload, attachment, and notification retry ceilings are independent and DB-enforced. Exhausted or malformed work transitions once to reconciliation/dead letter. Terminal success is never downgraded by a stale execute event.
- Notification delivery uses the immutable outbox event ID as provider idempotency identity. A known receipt is checkpointed as `ACCEPTED_PENDING`; subsequent attempts are lookup-only. Ambiguous delivery is dead-lettered rather than resent.

## Trigger and deadline

`POST /api/internal/partner-submissions` is bodyless, secret-authenticated, no-store, and bound to one configured HTTPS origin. It accepts no query string or client-selected mode/version/company/request. One monotonic deadline covers readiness, claiming, heartbeats, provider calls, and notification work. The worker requires lease duration to exceed the total remote budget by at least ten seconds, heartbeats immediately before and after each provider call, and discards stale results after fence loss.

Required production configuration:

- `PARTNER_SUBMISSION_TRIGGER_ORIGIN=https://canonical-worker-host.example`
- `PARTNER_SUBMISSION_TRIGGER_SECRET` (32–256 canonical bearer characters)
- `PARTNER_SUBMISSION_WORKER_ENABLED=true`
- `PARTNER_SUBMISSION_WORKER_ID` (bounded stable worker name)
- `PARTNER_SUBMISSION_DATABASE_URL` and `PARTNER_SUBMISSION_DATABASE_ROLE`
- `PARTNER_REAL_POSTGRES_GATE_CONFIRMED=REAL_POSTGRES_GATE_PASSED`

`PARTNER_SUBMISSION_TRUST_PROXY=true` may be enabled only behind an ingress that strips and rewrites forwarding headers. In that topology, the URL, `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto=https`, and optional port `443` must all resolve to the configured origin. Leave it unset for direct invocation.

## Operations

Structured metrics contain only fixed names and bounded low-cardinality reasons: queue-age bucket, reclaimed lease, outcome, retry/reconciliation, lease loss, notification delivery/release/dead. They never include tenant/job/request/event IDs, provider text, filenames, contact data, credentials, or raw errors. DB audit events record the fenced lifecycle with the same bounded metadata.

Alert on reconciliation, notification dead letters, repeated lease loss, attempt-cap terminalization, and sustained queue-age growth. For any reconciliation/dead-letter event, do not replay manually or create a new partner snapshot. Disable the trigger, preserve the immutable DB state, verify the real-Postgres gate and credential/contract configuration, then follow an approved operator recovery procedure.

## Release gate

Run the focused worker/migration/legacy/trigger tests, full partner and repository tests, TypeScript, targeted lint, demo-off production build, diff/secret scans, and `npm run partner:migrate:gate` against a disposable real PostgreSQL database. Production execution remains blocked until that gate passes and an approved LIVE contract/notification provider is implemented. Automatic fictional browser execution is implemented separately by the demo-only E5 boundary; it does not relax any E4 production invariant.
