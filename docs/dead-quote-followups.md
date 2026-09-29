# Dead quote follow-ups

The Quotes tab links to `/jobs/follow-ups?stage=QUOTE`. The queue excludes leads, accepted/progressed/archived jobs and shows Dead quotes with their price, age, scope, notes and previous discounts.

## Saved preparation

With the overlay migration applied and `DEAD_QUOTE_FOLLOWUPS_ENABLED=true`, staff can save an NZD discount draft, record evidence of earlier offers, review an estimated Dead date and offer history, snooze, exclude and restore a quote. Skip/Undo is personal to the user's browser session. Shared changes have immutable audit snapshots and revision checks so concurrent edits cannot overwrite one another silently.

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

## Timing and backend limitation

The canonical `api.insulhub.nz` repository is unavailable. Exact Dead transitions across both CRMs cannot currently be recorded. Note suggestions and staff-reviewed dates remain labelled estimates, using a conservative end-of-NZ-day boundary. Quote creation and update dates are never substituted for a Dead date.

A reviewed first approach becomes eligible two calendar months after the estimated Dead date. A second requires at least four calendar months after the recorded successful first offer, and the first-date threshold must also be satisfied. Two recorded successful approaches exhaust the sequence. NZ daylight saving and month ends are handled explicitly.

Canonical quote changes invalidate the history review, requiring staff to check it again. This intentionally includes unrelated edits because exact transition events are unavailable. Exhausted two-offer histories remain exhausted. Re-review preserves the date staff already saved.

## Enablement

1. Apply `npm run dead-followups:migrate` to the intended overlay database using its `DATABASE_URL`.
2. Set `DEAD_QUOTE_FOLLOWUPS_ENABLED=true` for preparation controls.
3. Verify authenticated staff access, connected sender ownership and real canonical schema. Enable manual sends separately with `DEAD_QUOTE_FOLLOWUP_SEND_ENABLED=true`.
4. Turning sending off blocks new dispatches while preserving status checks and note recovery.

The migration now includes send attempts, staff verification and shared templates and can be rerun. Neither production migration nor enablement has been performed. Missing tables retain the read-only foundation. Other storage failures surface an error rather than silently discarding exclusions/history. Turning the preparation flag off blocks preparation/template edits and new sends. Status checks, positive-evidence verification and note-only retries remain available for existing attempts.

## Verification

- `npm run test:dead-followups`: rules, access, queue, controls, API and UI tests. Repository tests require a dedicated local database via `DEAD_FOLLOWUPS_TEST_DATABASE_URL` (see test guard).
- `npm test` and `npm run build`: full regression suites and production build.
- Local preview on port 3116: run `node scripts/dead-followups-browser-smoke.cjs` and `node scripts/dead-followup-controls-browser-smoke.cjs`. Also run `node scripts/dead-followup-send-browser-smoke.cjs` for SMS/email composition, uncertain-response recovery and note-only retry. These mock business APIs, block external requests and check 390px/1280px screens without customer writes.

Independent review covered concurrent staff edits, uncertain saves, authentication loss, stale reviews and discount history. Regression tests cover saved dates surviving re-review, consistent estimate labels and controls remaining disabled during refresh. Local tests do not establish live schema compatibility, historical data accuracy or operational sending behaviour.

Run npm run dead-followups:readiness for read-only storage checks, and npm run test:dead-followups:browser for all four browser checks. See [release handoff](dead-quote-followups-release.md) for completed scope, remaining external checks, enablement order and rollback behaviour.
