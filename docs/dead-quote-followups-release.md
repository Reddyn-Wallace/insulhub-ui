# Dead quote follow-ups — release handoff

The complete local implementation is on **codex/dead-quote-followups**. It has not been deployed, production schemas/flags have not been changed and no customer messages were sent during development.

## Implemented

- Dead quotes only: leads, accepted/progressed and archived jobs cannot receive a new follow-up through this workflow. Conflicting statuses require review.
- First approach after two NZ calendar months from a reviewed estimated Dead date; second at least four months after first confirmed-send observation; two successful approaches maximum.
- NZD dollar discount drafts, previous-offer history, explicit date/history review, shared snooze/exclude/restore and personal session Skip/Undo.
- Shared first/second SMS/email templates with admin editing, preview, required discount merge, revision checks and immutable audit.
- Manual, individually confirmed SMS/email sending using the staff member's connected account. Saved original content, recipient, discount and actor; durable reservation prevents two staff dispatching the same approach.
- Confirmed-send job note with the exact discount. Retry job note only never dispatches another message. Recovery is accessible from a job's Notes section after it leaves Dead.
- Positive sent-evidence verification by the original sender or an administrator for unresolved attempts. Immutable staff provenance, no resend and no unsupported “not sent” override.
- Queue counts, earliest due ordering, next eligible dates and visible pending-note/recovery status.

## What still cannot be proved or completed locally

1. **Exact Dead transition dates across both CRMs.** Canonical backend source is unavailable. Reviewed dates remain labelled estimates; unrelated canonical edits may conservatively require history re-review.
2. **Atomic canonical note append.** The known backend mutation replaces the notes string. Fresh reads, interference detection, a per-job note lock, stable markers and read-after-write verification protect ordinary retries, but cannot eliminate an edit from another CRM between the final read and write.
3. **Live integration and sender acceptance.** Local tests simulate the external CRM/provider responses. Real GraphQL permissions/fields, operational sender ownership and a controlled real delivery have not been verified.
4. **Gmail unknown-message lookup.** Current connections have send/settings access, not mailbox-reading permission. This implementation does not request additional permissions. Staff use positive Sent-folder evidence; genuinely unverified attempts remain blocked.

These are deployment/operational acceptance items, not claims of completed live behaviour.

## Local verification

Use an isolated test database only. Database tests require DEAD_FOLLOWUPS_TEST_DATABASE_URL to point to loopback PostgreSQL on port 55687. They use dedicated test schemas (with the original controls tests in the test database's default schema). Never point this variable at production.

- Run DEAD_FOLLOWUPS_TEST_DATABASE_URL=postgresql://127.0.0.1:55687/postgres npm test.
- Run npm run build.
- Start npm run start -- --hostname 127.0.0.1 --port 3116, then npm run test:dead-followups:browser.
- Browser tests intercept business APIs and block external requests. They cover mobile/desktop preparation, both sending channels, lost responses, note retry, shared templates and staff verification.
- The lifecycle integration test uses real PostgreSQL for the complete draft/review/reservation/send-record/offer-history path, plus a simulated canonical note store. It intentionally loses both send and note responses, then proves one dispatch, one note append and the four-month second-approach boundary.
- npm run dead-followups:readiness performs read-only checks using DATABASE_URL; it does not apply migrations or change flags.

## Later rollout sequence — not executed

1. Choose the intended application release and overlay database; retain the normal database backup/recovery point.
2. Keep DEAD_QUOTE_FOLLOWUPS_ENABLED and DEAD_QUOTE_FOLLOWUP_SEND_ENABLED off.
3. Confirm the existing CRM SMS/email message schemas and connected-sender setup are present. Apply npm run dead-followups:migrate. It is repeatable and creates only the follow-up overlay schema/configuration.
4. Run npm run dead-followups:readiness. A passing result verifies storage structure, not GraphQL or actual delivery.
5. Deploy the reviewed release when separately authorised. Enable preparation only; verify a controlled Dead quote and a lead exclusion, role-based template editing, staff access, discount persistence and audit visibility.
6. Obtain explicit authorisation for a controlled send to a test recipient. Enable sending, verify one SMS and one email, exact amounts in history/notes, recovery of a note-only failure, and the second-approach waiting period. Do not use real customers as test data.
7. Staff review existing history before using the queue. Missing structured history never means no prior offers. No bulk historical backfill or automatic messages occur.

## Disable / rollback

- Set DEAD_QUOTE_FOLLOWUP_SEND_ENABLED=false to block new follow-up sends. Existing status checks, staff-verification evidence and note-only recovery remain available.
- Set DEAD_QUOTE_FOLLOWUPS_ENABLED=false to also stop preparation/template edits. It also prevents new sends even if the sending flag remains on.
- Do not delete attempts or history to reset a stuck send. Do not drop the new tables as a routine rollback: retaining reservations and evidence is essential to avoid duplicates.
- A confirmed provider failure permits a new explicit attempt after refresh. An unconfirmed outcome does not.
- If note appending is a concern during acceptance, stop new sends and investigate the note mutation contract before broader use.

## Backend handoff

Request canonical entry/exit events for effective quoted-Dead status, transactionally written with status changes: event ID, job ID, episode ID, server occurrence timestamp, prior/new state and actor. Expose authorised reads and a concurrency token.

Request an idempotent append-note mutation accepting an attempt/event key and expected job version, with atomic conflict handling. These are proposed contracts, not fields or endpoints currently assumed by the UI.

## Verified locally on 30 September 2026

921 Vitest tests passed, including 152 follow-up tests and 13 real PostgreSQL cases, plus the existing communication script checks. Production build, TypeScript, targeted lint and independent review passed. All four browser scripts passed at 390px and 1280px. Read-only storage readiness passed on the dedicated local test schema with sending/preparation flags off.
