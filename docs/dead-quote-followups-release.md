# Dead quote follow-ups — release handoff

The local implementation is on **codex/dead-quote-followups**. It has not been deployed, production schemas/flags have not been changed and no customer messages were sent during development.

## Implemented

- Dead quotes only: leads, accepted/progressed and archived jobs cannot receive a new follow-up through this workflow. Conflicting statuses require review.
- Fixed quote-date cutoff of 1 January 2026. First approach after two NZ calendar months from a recorded UI entry or agreed historical assumption; second at least four months after first confirmed-send observation; two successful approaches maximum.
- NZD dollar discount drafts, previous-offer history, explicit date/history review, shared snooze/exclude/restore and personal session Skip/Undo.
- Shared first/second SMS/email templates with admin editing, preview, required discount merge, revision checks and immutable audit.
- Manual, individually confirmed SMS/email sending using the staff member's connected account. Saved original content, recipient, discount and actor; durable reservation prevents two staff dispatching the same approach.
- Confirmed-send job note with the exact discount. Retry job note only never dispatches another message. Recovery is accessible from a job's Notes section after it leaves Dead.
- Positive sent-evidence verification by the original sender or an administrator for unresolved attempts. Immutable staff provenance, no resend and no unsupported “not sent” override.
- Queue counts, earliest due ordering, next eligible dates and visible pending-note/recovery status.

## What still cannot be proved or completed locally

1. **Transitions made in the other CRM remain outside capture.** UI entries/exits now have durable server-observed records. Existing eligible quotes use the last dated note, or quote date + 30 days, frozen and labelled as assumptions. Canonical backend source remains unavailable; two-database atomicity is not claimed.
2. **Atomic canonical note append.** The known backend mutation replaces the notes string. Fresh reads, interference detection, a per-job note lock, stable markers and read-after-write verification protect ordinary retries, but cannot eliminate an edit from another CRM between the final read and write.
3. **Live integration and sender acceptance.** Local tests simulate the external CRM/provider responses. Real GraphQL permissions/fields, operational sender ownership and a controlled real delivery have not been verified.
4. **Gmail unknown-message lookup.** Current connections have send/settings access, not mailbox-reading permission. This implementation does not request additional permissions. Staff use positive Sent-folder evidence; genuinely unverified attempts remain blocked.

Cross-CRM recording and atomic notes are backend limitations. Live integration is an outstanding acceptance check.

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
2. Keep DEAD_QUOTE_DATE_CAPTURE_ENABLED, DEAD_QUOTE_FOLLOWUPS_ENABLED and DEAD_QUOTE_FOLLOWUP_SEND_ENABLED off during setup.
3. Confirm the existing CRM SMS/email message schemas and connected-sender setup are present. Apply npm run dead-followups:migrate. It is repeatable and creates only the follow-up overlay schema/configuration.
4. Run npm run dead-followups:readiness. A passing result verifies storage structure, not GraphQL or actual delivery.
5. Deploy the reviewed release when separately authorised. Enable DEAD_QUOTE_DATE_CAPTURE_ENABLED first to begin UI-only recording without sending. Verify a successful entry, repeated save, exit/re-entry and interrupted-save recovery. Enable preparation only when ready; verify a controlled Dead quote and a lead exclusion, role-based template editing, staff access, discount persistence and audit visibility.
6. Obtain explicit authorisation for a controlled send to a test recipient. Enable sending, verify one SMS and one email, exact amounts in history/notes, recovery of a note-only failure, and the second-approach waiting period. Do not use real customers as test data.
7. Staff review existing history before using the queue. Missing structured history never means no prior offers. No bulk historical backfill or automatic messages occur.

Capture is also enabled whenever preparation is enabled, preventing follow-ups from running against stale UI dates. The independent capture flag allows date collection before preparation/sending rollout.

## Disable / rollback

- Set DEAD_QUOTE_FOLLOWUP_SEND_ENABLED=false to block new follow-up sends. Existing status checks, staff-verification evidence and note-only recovery remain available.
- Leave DEAD_QUOTE_DATE_CAPTURE_ENABLED=true to continue collecting UI dates while follow-ups are off; switch it off as well to stop capture. Interrupted-date checks remain available.
- Set DEAD_QUOTE_FOLLOWUPS_ENABLED=false to also stop preparation/template edits. It also prevents new sends even if the sending flag remains on.
- Do not delete attempts or history to reset a stuck send. Do not drop the new tables as a routine rollback: retaining reservations and evidence is essential to avoid duplicates.
- A confirmed provider failure permits a new explicit attempt after refresh. An unconfirmed outcome does not.
- If note appending is a concern during acceptance, stop new sends and investigate the note mutation contract before broader use.

## Backend handoff

Request canonical entry/exit events for effective quoted-Dead status, transactionally written with status changes: event ID, job ID, episode ID, server occurrence timestamp, prior/new state and actor. Expose authorised reads and a concurrency token.

Request an idempotent append-note mutation accepting an attempt/event key and expected job version, with atomic conflict handling. These are proposed contracts, not fields or endpoints currently assumed by the UI.

## Verified locally on 30 September 2026

921 Vitest tests passed, including 152 follow-up tests and 13 real PostgreSQL cases, plus the existing communication script checks. Production build, TypeScript, targeted lint and independent review passed. All five browser scripts passed at 390px and 1280px. Read-only storage readiness passed on the dedicated local test schema with sending/preparation flags off.


## UI date recording completed locally — 4 October 2026

The agreed fixed quote-date cohort, latest-note/quote-plus-30 assumptions, persistent assumption snapshots, UI entry/exit history and interrupted-save recovery are implemented. No existing production dates have been backfilled yet. The migration includes `dead_quote_dates` and immutable `dead_quote_date_events`.

951 tests passed, including 182 follow-up tests and 19 local PostgreSQL cases. The production build, TypeScript, targeted lint, independent review and all five browser scripts at mobile/desktop sizes passed. Local readiness confirms the new schema. The local preview remains read-only with capture, preparation and sends disabled.

To start collecting dates after an authorised deployment: migrate the overlay database and enable `DEAD_QUOTE_DATE_CAPTURE_ENABLED=true`. Preparation and sending can stay off. Enabling preparation later also enables capture automatically. Backend access is not needed for this UI-only scope; cross-CRM transitions and fully atomic notes still require backend support.


## Simplified queue and interactive preview — 4 October 2026

The queue now shows only quotes needing follow-up, with search but no state filters. Absent/zero ceiling areas are blank. Negative quote extras produce an existing-discount flag, with individual and total amounts excluding GST. Positive extras do not reduce that displayed discount. Snoozed/excluded records and uncertain-date recovery remain manageable through the job’s follow-up history.

Canonical page reads run with bounded concurrency (four), overlay reads run concurrently, and repeat visits can display a token-scoped 30-second snapshot while refreshing. Editing stays disabled until fresh data succeeds. These changes are tested, but live loading latency has not been benchmarked.

For interactive local review, start the built Next server on 3116 with capture/preparation/sending flags false, then run `npm run preview:dead-followups`. Open http://127.0.0.1:3117/jobs/follow-ups?stage=QUOTE. This separate origin uses sample data and simulated sends only; changes persist in a temporary local JSON file and can be cleared with Reset sample data. Business API requests terminate locally; upstream access is limited to local UI/static assets.

Verified: 194 follow-up tests passed (including local PostgreSQL cases), production build/TypeScript and targeted lint passed, all five browser regression scripts passed at 390px and 1280px, and the actual sample server passed editable discounts, simulated SMS/email, notes/history persistence and shared-template checks at both sizes with no external requests. Independent review completed. Nothing deployed, merged or migrated in production.


## Follow-up action flow — 4 October 2026

Quote details now contain job notes, recorded offer amounts/dates and a full-history link. The three actions below are Send Offer, Skip for now and Ignore. Historical offer entry/correction, standalone date review, snooze and exclusion forms have been removed from the UI; historical records remain available.

Skip opens a duration/date modal and persists the existing shared snooze control. It resumes after the selected NZ date. Ignore requires a nonblank reason and persists exclusion from further follow-ups. Existing ignored/skipped records can still be restored from full history.

Send Offer opens an amount/channel/template/account/message form. A confirmation modal shows the exact recipient, discount and message and asks staff to confirm prior-history accuracy. Only explicit confirmation saves the discount and history review with current revisions, then submits the individually claimed send. Successful sends return to the queue. Conflicts/uncertain outcomes lock the form and direct staff to history; they never silently retry. Existing server eligibility, concurrency and idempotency checks remain authoritative. Note recovery remains available in history.

Follow-up defaults live at Settings → Templates → Dead quote follow-up templates (`/jobs/settings/templates/follow-ups`). The former URL redirects there. The interactive localhost preview supports the same flow using sample data and simulated sends only.

Validation: the full test suite passed; the final follow-up suite has 198 passing tests, including local PostgreSQL integration cases. Production build/TypeScript, targeted lint and independent code review passed. Updated browser checks cover the new actions and confirmation flow, Settings templates, access-disabled views and date/send recovery at 390px and 1280px. The sample-server tests verify no external requests. No deployment or production writes.

Follow-up cleanup: removed the confirmation checkbox, Dead-quotes back link, queue count/last-checked row and full-history link from quote details. Mobile detail navigation now says Back to follow-ups. Confirm and send is the explicit confirmation action. Newly appended sent-offer job notes include recipient, email subject where present and the exact message body alongside discount/date/channel/staff; existing notes are not rewritten. Focused tests (35), production build/TypeScript and targeted lint passed.
