# Dead quote follow-ups

The Quotes tab links to `/jobs/follow-ups?stage=QUOTE`. The queue excludes leads, accepted/progressed/archived jobs and shows Dead quotes with their price, age, scope, notes and previous discounts.

## Saved preparation

With the overlay migration applied and `DEAD_QUOTE_FOLLOWUPS_ENABLED=true`, staff can save an NZD discount draft, record evidence of earlier offers, review an estimated Dead date and offer history, snooze, exclude and restore a quote. Skip/Undo is personal to the user's browser session. Shared changes have immutable audit snapshots and revision checks so concurrent edits cannot overwrite one another silently.

Drafts never count as sent offers. Historical offers are explicitly staff attestations with evidence, date, channel and amount. Correcting the latest entry preserves the original audit record. The previous offered amount is displayed independently of the next draft.

**Sending and automatic job-note recording are not implemented yet.** This slice does not send messages, modify canonical job notes or change job status. The next sending slice must record the actual discount and append it to job notes only after confirmed successful delivery; note retries must not resend the message.

## Timing and backend limitation

The canonical `api.insulhub.nz` repository is unavailable. Exact Dead transitions across both CRMs cannot currently be recorded. Note suggestions and staff-reviewed dates remain labelled estimates, using a conservative end-of-NZ-day boundary. Quote creation and update dates are never substituted for a Dead date.

A reviewed first approach becomes eligible two calendar months after the estimated Dead date. A second requires at least four calendar months after the recorded successful first offer, and the first-date threshold must also be satisfied. Two recorded successful approaches exhaust the sequence. NZ daylight saving and month ends are handled explicitly.

Canonical quote changes invalidate the history review, requiring staff to check it again. This intentionally includes unrelated edits because exact transition events are unavailable. Exhausted two-offer histories remain exhausted. Re-review preserves the date staff already saved.

## Enablement

1. Apply `npm run dead-followups:migrate` to the intended overlay database using its `DATABASE_URL`.
2. Set `DEAD_QUOTE_FOLLOWUPS_ENABLED=true` in the application environment.
3. Verify authenticated staff access and real canonical schema before operational use.

Neither production migration nor enablement has been performed. Missing tables retain the read-only foundation. Other storage failures surface an error rather than silently discarding exclusions/history. Turning the flag off preserves read access but blocks writes.

## Verification

- `npm run test:dead-followups`: rules, access, queue, controls, API and UI tests. Repository tests require a dedicated local database via `DEAD_FOLLOWUPS_TEST_DATABASE_URL` (see test guard).
- `npm test` and `npm run build`: full regression suites and production build.
- Local preview on port 3116: run `node scripts/dead-followups-browser-smoke.cjs` and `node scripts/dead-followup-controls-browser-smoke.cjs`. Both mock business APIs, block external requests and check 390px/1280px screens without customer writes.

Independent review covered concurrent staff edits, uncertain saves, authentication loss, stale reviews and discount history. Regression tests cover saved dates surviving re-review, consistent estimate labels and controls remaining disabled during refresh. Local tests do not establish live schema compatibility, historical data accuracy or operational sending behaviour.
