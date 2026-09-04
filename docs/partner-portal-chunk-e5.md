# Partner portal Chunk E5 — fictional browser-to-worker completion

Chunk E5 connects the explicit local fictional partner portal to the real E4 state-machine engine. It does not approve LIVE execution, add customer/partner communications, or begin E6 internal operations.

## Runtime boundary

- Execution requires `PARTNER_DEMO_MODE=true`, `PARTNER_DEMO_CONFIRM=LOCAL_FICTIONAL_DATA_ONLY`, a non-production runtime, and an exact `http(s)` loopback `PARTNER_APP_ORIGIN` with no credentials, path, query, or fragment. A production or non-loopback process fails before the demo pool, adapter resolver, notification adapter, or network path is selected.
- pg-mem cannot execute the PostgreSQL SECURITY DEFINER worker functions. `PartnerDemoSubmissionWorkerRepository` is therefore a separate demo-only implementation of the same `PartnerSubmissionWorkerStore` contract consumed by the unchanged E4 engine. Production continues to use only `PartnerSubmissionWorkerRepository` and migration 006.
- One process-owned coordinator serializes worker drains and coalesces concurrent signals into one running promise with a bounded, deduplicated scope queue. Every signal carries its authorized company and job; the coordinator resolves the immutable request, and the demo repository limits submission and notification claims to that exact company/job/request.
- pg-mem transactions do not model the production guarantee closely enough for compound worker transitions. Each demo-store transition therefore takes a process mutex, captures a native pg-mem backup, enforces unexpired lease/fence/state CAS checks and the correlated request/job/checkpoint/manifest/delivery/artifact/drawing-pointer graph, and restores the exact pre-transition database on any statement failure. The affected job is then poisoned and all portal/worker paths fail locked until reset.
- Reset raises a synchronous resetting gate, waits for the current drain, takes the coordinator lock, clears provider and notification worlds, closes/discards the pg-mem pool, removes PDF bytes, locks and poison, and recreates the deterministic seed on next access. No signal starts during reset. Reset is a server/test operation; there is no partner-controlled reset, mode, provider, fault, company, or request input.

## Scheduling and recovery

The accepted submission route schedules a best-effort Next `after()` callback only after the E3 freeze returned a committed `202`. The callback signals the process coordinator; it does not bypass the E4 engine.

The read-only status screen also uses `POST /api/partner/jobs/:jobId/submission/resume` to recover when `after()` was suppressed, the browser reloaded, or the accepted response was lost. The endpoint is demo-only, queryless, bodyless, exact-Origin/Host protected, authenticated, tenant/job scoped through the existing status authority, purpose-rate-limited by user/company/job, and accepts no execution options. `GET /submission` remains strictly read-only.

The status UI preserves the last authoritative status during refresh failures, prevents concurrent resume calls, polls with visibility/timeout/backoff/Retry-After handling, and continues until both the submission and fictional internal notification are terminal. Public notification state is only `PENDING`, `DELIVERED`, or `DEAD`; receipts, event IDs, provider text, and internal errors never cross the route. A successful submission stays successful if its independent fictional notification is dead.

## Fictional seed and effects

Northwind includes `NW-2026-READY`, a realistic saved DRAFT with complete contact/site data, a wall-and-ceiling quote, and two ordered valid one-page PDF artifacts bound to their drawing documents, render inputs, hashes, template identity, and process-owned bytes. Tests load both through `pdf-lib`, verify one page, and compare exact byte size and SHA-256. The automated new-lead journey also creates a fresh drawing, renders it with the locked D1 renderer, stores the bounded pg-mem placeholder plus authoritative process bytes, freezes it, and completes it through the real E4 engine. Existing incomplete fixtures remain available. Submitting the ready fixture exercises create lead, full quote update, two deterministic uploads, one idempotent complete-set attachment, verified final readback, DB finalization, and one fictional internal notification. No fetch, customer message, partner message, email, SMS, or LIVE provider call is made.

## Acceptance evidence

- Ten concurrent same-scope signals converge on one snapshot/request/outbox, one fictional lead/quote, two uploads, one attachment, one completion event, one notification deliver call, and no lookup call. The exact full legacy operation map is asserted.
- Cross-tenant signaling cannot claim or mutate another tenant's request. Focused tests also cover submission and notification expired-lease replacement, incremented attempts/fences, stale-fence rejection, exact snapshot/job/contract/lead/quote/plan/artifact shapes, canonical snapshot/hash/idempotency/remote-name, recomputed document/render provenance, and checkpoint-correlated legacy identity before provider selection. They also prove retry normalization from `QUOTE_UPDATED` and `PLANS_ATTACHED`, hostile final identity/drawing/artifact denial, a fault between DB finalization and completion-event insertion with exact restore/poison/reset recovery, and signal-versus-reset exclusion.
- Suppressed-`after`, reload, lost-acceptance recovery, tenant denial, scoped recovery throttling, empty-body/origin/query validation, read-only GET, terminal polling including notification `DEAD`, last-known-state recovery, independent notification dead, reset, no-network, and production/non-loopback zero-call paths have focused tests.
- Run `npm run test:partner`, the full repository tests, `npx tsc --noEmit --incremental false`, targeted ESLint, and a demo-off production build. The real PostgreSQL E4 gate remains a separate production prerequisite.

## Visual QA handoff

Final in-app Browser QA must capture the ready draft before confirmation and the completed status after worker/notification terminal state at exactly 1440×900 and 390×844. Compare against the source palette and prior partner captures: Inter hierarchy, navy shell, white rounded cards, dark-orange irreversible action, orange focus rings, 44px targets, no horizontal overflow, live status announcements, and readable pending/delivered/dead notification separation. Do not use Playwright for this final evidence.

The visual/browser handoff is complete. All four required captures and four source/implementation comparison inputs are recorded in `docs/design-reference/`. The browser proved processing → submitted, independent fictional notification delivery, dashboard status change, read-only frozen plans, a 200 PDF response, 44 px desktop/mobile targets, no horizontal overflow and Harbour-to-Northwind denial.

The first live recovery POST exposed a Next transport edge that was absent from Request-level unit fixtures: an empty browser POST can arrive as an already-ended non-null stream with `Content-Length: 0`. The route now reads and proves that exact zero-byte shape instead of equating `request.body === null` with emptiness. Non-empty, misleading-length, content-type, transfer-encoding, query and hostile-origin requests still fail closed, and the browser restart completed the real worker flow.
