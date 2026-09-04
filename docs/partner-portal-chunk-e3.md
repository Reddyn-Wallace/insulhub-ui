# Partner portal Chunk E3 — enqueue and partner submission UI

Chunk E3 adds only the authenticated partner enqueue/status boundary and the partner-facing read-only transition. It does not execute provider work; worker orchestration remains Chunk E4.

## Boundary

- `POST` and `GET /api/partner/jobs/:jobId/submission` are tenant-scoped from the authenticated partner principal. The client cannot supply a company, adapter mode, contract, endpoint, credential, request ID, snapshot ID, or artifact ID.
- POST accepts exactly `{jobRevision,floorPlanRevision,idempotencyKey}` as bounded JSON. Exact Origin validation precedes database, session, body, and rate-limit work. Responses are bounded and `private, no-store`.
- The opaque UUID is hashed immediately. Raw values are never stored in PostgreSQL, audit/outbox payloads, logs, or responses.
- A pure configuration/notification preflight occurs before the rate-limited authoritative load and freeze. The current production LIVE contract remains deliberately unavailable, so LIVE returns 503 while the job remains DRAFT. Only the exact loopback fictional demo gate can enqueue fictional work, without network calls.
- PostgreSQL remains the production freeze authority. The fictional pg-mem path requires a transaction-capable connection, is serialized per tenant, and re-locks/revalidates the job, config, ordered drawings, current artifact pointers, actual PDF bytes/hash/size/header, and render provenance before any saga insert. Because pg-mem's Pool shim does not guarantee rollback, a narrowly request/snapshot-scoped reverse-order compensation verifies every saga table plus the exact original job/drawing state and poisons the process-scoped demo job if cleanup cannot be proven.
- POST and GET status have purpose-separated atomic user/company/IP buckets. `PARTNER_TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip` may be enabled only behind an ingress that strips and overwrites that header; otherwise the IP bucket deliberately uses the stable `unknown` value rather than trusting client-supplied forwarding headers.

## Recovery and truthful UI

- Browser recovery records are scoped by authenticated recovery scope, job, job revision, and floor-plan revision. They contain `{key,state,createdAt,updatedAt}` in local storage.
- First allocation and the PENDING transition are serialized with Web Locks and synchronously read back before POST. If durable storage or cross-tab locking is unavailable, submission does not start.
- Other tabs and every editable quote/plan-list/plan-editor route observe exact or newer-revision PENDING records through storage events, lock editing, and reconcile through the quote submission boundary. A tab also checks server status before exposing a server-rendered DRAFT, closing the hydration race where another tab committed first.
- Unused ALLOCATED records have a seven-day replacement horizon. PENDING is a safety tombstone: age alone never clears it; same-key reconciliation, an explicit proven no-effect response, definitive acceptance, or logout resolves it.
- A direct first-POST 401, exact 422, rate-limit 429, stale-revision 409, or preflight-unavailable 503 proves that original call had no effect and clears PENDING. The same response during recovery does **not** prove a previously lost call stopped; recovery retains PENDING and the edit lock until 202 or authoritative non-DRAFT state. Unknown conflicts, transport failure, and post-freeze/status uncertainty follow the same conservative rule.
- QUEUED/PROCESSING copy says only that submission was received and processing. It never claims Insul Hub completion before `SUCCEEDED`. FAILED_RETRYABLE is an internal retry with no partner action. Reconciliation-required is read-only and directs the partner to support.

## Evidence and external blockers

Unit/integration coverage includes strict route ordering and envelopes, tenant-safe and separately metered status, outage redaction, preflight zero mutation, stale/rate/readiness outcomes, cross-tab key allocation and storage failure, plan-route ambiguity locks, lost-response same-key replay, ten concurrent fictional freezes, cross-job key conflict parity, exact saga row counts, source-race rejection, late-fault compensation, and transaction-required fictional freeze.

Chunk E4 must not claim a fictional PENDING outbox item until the complete FROZEN marker is visible and validated under the shared demo lock (or an equivalent complete-state guard). Compensation is a safety net for pg-mem, not a substitute for worker isolation.

Production provider execution remains unavailable by design. The E1 disposable real-PostgreSQL gate and externally approved LIVE provider/notification contracts remain launch blockers; E3 does not make a live-readiness claim.
