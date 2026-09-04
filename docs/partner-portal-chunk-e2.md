# Partner portal Chunk E2 — server-only legacy adapter boundary

## Scope and current status

Chunk E2 adds the server-only contract, transport, deterministic fictional provider, credential binding, GraphQL scaffold, and fictional notification boundary needed by later submission workers. It does **not** add submission HTTP routes, partner UI, outbox polling, worker orchestration, deployment, or any live provider/notification call. The live contract registry is intentionally empty, so the factory returns a typed unavailable result before network access in every current LIVE configuration.

The only E1 change is the reviewed additive claimed-snapshot projection described in the E1 document: safe frozen prefix/fingerprint/timestamp metadata is returned with the lease-scoped encrypted envelope. Function inputs, ownership, worker grant, and down behavior are unchanged.

## Adapter selection and credentials

- Routes and clients cannot select an adapter. A worker must start with a current `partner_submission_claimed_snapshot` row and bind it through `BoundLegacyCredential`.
- The binding verifies the frozen endpoint against the exact operator origin allowlist, verifies `SHA-256(ciphertext || nonce)` in constant time, binds AES-GCM decryption to company + endpoint + key version, and rejects invalid timestamps, key/version drift, wrong-company envelopes, controls, or oversized tokens.
- The binding is runtime-branded with a private `WeakMap`; structural lookalikes are rejected. Its plaintext token is non-enumerable and absent from JSON serialization. The live adapter constructor consumes this opaque binding rather than separate identity/token values.
- FICTIONAL binding requires every endpoint/credential field to be null. LIVE and FICTIONAL modes are mutually exclusive.
- Fictional selection uses the existing `PARTNER_DEMO_MODE=true`, exact `PARTNER_DEMO_CONFIRM`, and loopback `PARTNER_APP_ORIGIN` contract. Actual production mode always forbids fake selection, even if a caller supplies a different environment object.
- Fictional state is stored in a process-scoped, company-scoped remote world with a monotonic per-company legacy job-number allocator. Each request receives a marker-bound adapter view; every by-ID operation rechecks that request marker, active state, and phase before reading or mutating. This keeps two same-company requests coherent and uniquely numbered without allowing either view to access the other. The process scope matches the existing demo database/PDF model while injected test registries remain isolated.

## Versioned contract and transport

An approved LIVE contract must explicitly attest exact marker search, bounded exhaustive pagination, remote version CAS, complete quote readback, upload idempotency, upload content integrity readback, attachment readback, header/body schema, page cap, and operation deadline. It must also name the accepted provider DTO, `x-access-token` GraphQL policy, and `x-token` multipart upload policy. No such implementation or contract is registered today. The production creator deliberately returns unavailable even if someone adds a registry row prematurely; an unapproved bearer/raw-PDF scaffold exists only behind an actual-Vitest construction token. There is no fictional fallback.

The shared transport permits only the configured HTTPS origin and exact `/graphql` or derived `/files/upload` paths. It rejects credentials in URLs, query strings, fragments, redirects, JSONP media types, oversized/unserializable requests, oversized or hanging streamed responses, invalid tokens, invalid filenames/idempotency keys, non-PDF bytes, and SHA/size mismatches. Bounded valid streams are accepted, and abort timing remains active through response streaming and parsing. Any post-send redirect, timeout/reset, HTTP failure, malformed/oversized response, or GraphQL data-plus-errors is `AMBIGUOUS` unless a future closed contract proves no effect. Provider text, raw response bodies, credentials, endpoint details, and customer data are never returned in errors.

`Authorization: Bearer` plus raw-PDF upload in the GraphQL module is an **unapproved scaffold**, not a claim about the current Insul Hub provider. The repository’s existing staff API uses `x-access-token` for GraphQL and `x-token` with multipart upload. Both the empty registry and the always-unavailable production creator prevent this scaffold from being instantiated outside a network-isolated Vitest harness; exact accepted multipart schema, response DTO, content readback, DNS/private-address policy, and sandbox acceptance remain launch blockers.

## Lead, quote, and plan invariants

- A stable non-PII marker is derived from company UUID + deterministic submission request UUID. Lead creation validates exact tenant/request identity, required lead readiness, allowed unique lead sources, the full canonical create fingerprint, and the isolated marker before any fetch.
- Marker recovery paginates every page within the contract cap/deadline, rejects repeated/non-progressing cursors, more than one total match, archived matches, wrong markers, malformed pages, and canonical-create mismatch. Customer name, address, phone, or email are never search keys. Response loss never permits blind recreation.
- The full quote mapper reuses the existing local quote adapter units and fields, derives `PREFIX-jobNumber`, and rejects `LOCAL-`. The by-ID read projects customer/address/lead-source data only long enough to verify the immutable create fingerprint, then returns a narrow sensitive preservation value containing site-plan notes, existing quote-site-plan filenames, and the known wall `internal` flag. That ephemeral value is not logged or placed in outcomes/errors. The update sends only `_id`, stage `QUOTE`, that exact `sitePlanNotes` value, and the complete quote; it never replays partial client, lead, billing, notes, allocation, scheduling, or installation objects. Nested `quote.status` becomes `UNSET`, deferral/override state is cleared, and nested quote email/text follow-ups are false. The separate mutation argument `emailQuoteToCustomer` is always false. No invented provider send fields are treated as evidence.
- Quote confirmation hashes a locally reconstructed full quote, nested status, and no-follow-up flags from readback. A provider-supplied fingerprint is supplementary only. Exact prior-effect readback is idempotently confirmed even when the remote version advanced; any other staff drift is a conflict/reconciliation result.
- Frozen plans recheck the E1 deterministic request/ordinal/artifact/hash filename, PDF magic, bytes, SHA-256, size, renderer/template provenance, job identity, and current verified quote phase before upload. Lost upload responses remain ambiguous. Attachment confirmation requires exact filenames, content hashes, sizes, and job identity; prior exact attachment is idempotently confirmed after response loss.

Outcomes are normalized to `CONFIRMED`, `DEFINITE_FAILURE` with proven no effect, `AMBIGUOUS`, or `CONFLICT`/reconciliation-required. Codes are fixed and bounded; provider strings are never persisted by this boundary.

## Fictional provider and notification truth

The fictional adapter is tenant/request scoped, deterministic, versioned, and CAS-aware. Tests can script definite no effect, effect plus response loss, false-success/no-effect, staff drift, duplicate/archived markers, incomplete pagination, upload loss/orphan recovery, attachment loss, partial attachments, and readback failures. Correct policy creates one lead and one attachment set; exact retries return the prior state instead of duplicating effects.

Fictional notifications accept only `SUBMISSION_COMPLETED` or `RECONCILIATION_REQUIRED`, prefix summaries visibly with `[FICTIONAL]`, and deduplicate per company + job + request + event kind in a process-scoped fictional notification world that survives adapter recreation. Injected worlds keep tests isolated. `ENQUEUED` is tracked separately from `DELIVERED`; queued work is never described as sent. Production notification delivery remains unavailable.

## Verification and blockers

Focused tests cover the factory canaries, encrypted-envelope provenance, token serialization, deterministic fake matrix, tenant isolation, exact quote DTO, GraphQL pagination/cursor bounds, lead runtime validation, full quote/CAS/readback drift, PDF byte integrity, upload and attachment response-loss behavior, redirects, streaming timeouts, request/response caps, MIME checks, GraphQL partial errors, and redaction.

The disposable real-PostgreSQL gate remains an E1 launch blocker and was not rerun without a safe URL. Before LIVE enablement, independently approve and register one exact provider contract; validate real query/input schemas, authentication and upload format, exhaustive marker lookup, full quote and attachment readback, remote content verification, DNS/private-network defenses, sandbox crash-window behavior, notification provider semantics, credential rotation operations, and production observability/redaction. No current code or documentation claims live readiness.
