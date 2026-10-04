# Dead quote follow-ups

The Quotes tab links to `/jobs/follow-ups?stage=QUOTE`. The queue excludes leads, accepted/progressed/archived jobs and shows Dead quotes with their price, age, scope, notes and previous discounts.

## Saved preparation

With the overlay migration applied and `DEAD_QUOTE_FOLLOWUPS_ENABLED=true`, staff can save an NZD discount draft, record evidence of earlier offers, review previous offers alongside the recorded or assumed Dead date, snooze, exclude and restore a quote. Skip/Undo is personal to the user's browser session. Shared changes have immutable audit snapshots and revision checks so concurrent edits cannot overwrite one another silently.

Drafts never count as sent offers. Historical offers are explicitly staff attestations with evidence, date, channel and amount. Correcting the latest entry preserves the original audit record. The previous offered amount is displayed independently of the next draft.

## Shared templates

Offer templates are linked from the queue at /jobs/follow-ups/templates. There are four defaults: first/second SMS and first/second email. Administrators can edit them, with revision checks and immutable change history. Staff can edit each individual message without changing the shared defaults.

Every template requires {{discount}}, rendered as the exact saved amount (for example $500.00). Optional fields are {{name}} and {{quoteNumber}}. Unknown merge fields are rejected. The editor includes a preview. Loading status never overwrites a staff-edited draft; Use saved template is an explicit reset.

The queue prioritises unresolved sends/pending notes, then the oldest due quotes. View counts respect personal skips, and eligible/next-eligible dates use NZ time. After sending, Refresh quote and eligibility refreshes the queue, offer history and notes.

## Manual sending

With the separate sending flag enabled, due quotes have an editable SMS/email composer using the current staff member's connected sender. Staff must explicitly check the recipient, pricing, scope and discount before selecting Send offer. The final text must contain the saved amount in dollar-and-cents form. The exact recipient, message, discount, actor and approach are saved before dispatch; the email signature is appended by the existing email sender.

A shared database lock reserves one attempt per approach. Repeating a request retrieves its attempt; it never dispatches it again. Provider-confirmed sent/delivered status records a successful offer automatically; an unresolved attempt can alternatively be positively verified by its original sender or an administrator with an explicit evidence record. SMS service acceptance is pending. Unknown attempts block further sends and history edits. Checking status only reads/reconciles the existing attempt (and polls the SMS provider); it never sends. A definitive preflight rejection or failed message allows a new explicit attempt after refresh.

Confirmed sends append a stable, identifiable job note with the actual NZD discount, approach, channel, staff member and NZ date/time. Note failures leave the successful offer intact and expose Retry job note only. The job's Notes section also links to follow-up history, so recovery remains available after the job leaves Dead. Confirmed and staff-verified CRM sends cannot be deleted through the historical-entry correction form. Job status is never changed by this workflow.

### Limits and recovery

- The canonical backend only supports replacing the notes string, not atomic append or conditional updates. This implementation rereads notes, detects intervening edits, serialises its own note appends, uses an attempt marker to avoid duplicates and verifies the saved marker. It **cannot eliminate a simultaneous note-edit race with either CRM** after the last read. An atomic backend append is needed for that guarantee.
- A crash before dispatch, or provider success that was never saved by the existing sender, remains unknown and blocks further sends. After at least one minute, the original sender or an administrator can verify the existing attempt against positive evidence from the actual Sent folder/device. The exact original snapshot and discount remain unchanged; reviewer and evidence are immutable, and history/notes clearly say staff-verified. This never dispatches a message. There is no “not sent” override: absence from Sent is not proof of failure, and uncertain attempts cannot be resent.
- Successful timing uses the first confirmed observation, which may be later than the actual send. This conservatively delays the second approach.
- The queue does not automatically poll or send in the background. Staff use Check saved send status for pending SMS. The shared guard covers this follow-up workflow; ordinary manual communications outside it still require history review.
- Auto-appending a note changes the canonical version and may require another history review. Estimates remain estimates; exact cross-CRM Dead transitions are still unavailable.

## Dead dates and timing

Only quotes with a valid quote date on or after **1 January 2026 (NZ time)** qualify. The cutoff is fixed, not rolling. Older quotes remain Dead in the CRM but never appear in this follow-up queue, including its excluded view. Missing/invalid quote dates are also withheld. The same guard applies to direct preparation and send requests.

For existing Dead quotes, the latest valid dated CRM note is the assumed entry date, regardless of its wording. Recognised note stamps are day/month/two- or four-digit-year or ISO year-month-day, followed by a spaced hyphen. Dates embedded in prose and invalid/future stamps do not qualify. If none exists, use the quote date plus 30 NZ calendar days. Date-only assumptions use the end of the NZ day; a future fallback waits normally. Assumptions are labelled and frozen at first enabled observation in `dead_quote_dates`, with an immutable `assumed` event, so later follow-up notes do not shift the date. No customer notes or quote statuses are changed by backfill. This is a lazy backfill as the queue/access loads, not a production script already run.

The shared browser GraphQL helper routes existing job updates and archive operations through an authenticated server endpoint. With date capture enabled, relevant quote saves acquire a per-job lock, persist intent before the canonical write, then record confirmed effective Dead entry/exit with actor and server observation time in `dead_quote_date_events`. Repeated saves in the same state do not create entries. Leaving clears the active entry; returning records a new one without deleting offers or discounts. Leads are not captured as Dead quotes.

This UI-only observation is not an atomic backend event and cannot capture changes made in the other CRM. An interrupted save retains a durable blocker; no send can proceed while its outcome is uncertain. After at least a minute, Check saved Dead date obtains a fresh canonical observation without replaying the mutation. A recovered entry uses that later observation time, never a guessed original time. A subsequent attempted job save also reconciles an older pending intent and asks for refresh before any new mutation.

A first approach becomes eligible two NZ calendar months after the recorded/assumed entry. A second requires at least four NZ calendar months after the first confirmed successful offer and also satisfies the current-entry threshold. Two recorded successful approaches exhaust the sequence. Historical offers must still be reviewed before sending; accepting the agreed date assumption does not assert that no earlier offers exist. Canonical edits continue to invalidate that history review conservatively.

## Enablement

1. Apply `npm run dead-followups:migrate` to the intended overlay database. This now includes dates and immutable transition history as well as controls, send attempts and templates. Run read-only readiness checks.
2. To start recording UI transitions without enabling preparation or sends, set `DEAD_QUOTE_DATE_CAPTURE_ENABLED=true`. This requires the date tables. Relevant quote saves fail before dispatch when storage cannot record intent; uncertain saves require checking before another mutation.
3. `DEAD_QUOTE_FOLLOWUPS_ENABLED=true` enables preparation and also requires/enables date capture, even if the separate capture flag is absent. Date assumptions are persisted as eligible quotes are first observed.
4. Verify authenticated canonical access and connected sender ownership. Enable sending separately with `DEAD_QUOTE_FOLLOWUP_SEND_ENABLED=true` only after controlled acceptance.
5. Turning sending off blocks new dispatches. Turning preparation off also blocks preparation/template edits and new sends. Keep the independent capture flag true if you want ongoing dates. Turn both preparation and capture off to stop new transition recording. Existing send/note and interrupted-date recovery remain available.

No production migration, backfill, deployment or flag change has been performed. Preview flags remain off. Missing date schema is tolerated for read-only review only when both capture/preparation flags are off. Other storage failures are surfaced rather than silently discarding history.

## Verification

- `npm run test:dead-followups`: rules, access, queue, controls, API and UI tests. Repository tests require a dedicated local database via `DEAD_FOLLOWUPS_TEST_DATABASE_URL` (see test guard).
- `npm test` and `npm run build`: full regression suites and production build.
- Local preview on port 3116: run `node scripts/dead-followups-browser-smoke.cjs` and `node scripts/dead-followup-controls-browser-smoke.cjs`. Also run `node scripts/dead-followup-send-browser-smoke.cjs` for SMS/email composition, uncertain-response recovery and note-only retry. These mock business APIs, block external requests and check 390px/1280px screens without customer writes.

Independent review covered concurrent staff edits, uncertain saves, authentication loss, stale reviews and discount history. Regression tests cover saved dates surviving re-review, consistent estimate labels and controls remaining disabled during refresh. Local tests do not establish live schema compatibility, historical data accuracy or operational sending behaviour.

Run npm run dead-followups:readiness for read-only storage checks, and npm run test:dead-followups:browser for all five browser checks. See [release handoff](dead-quote-followups-release.md) for completed scope, remaining external checks, enablement order and rollback behaviour.


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
