# Dead quote follow-ups: saved preparation and controls

User authorised continuing after the read-only foundation. This slice completes practical shared preparation/history/control work before sending. Dollar amount only; a draft never counts as an actual approach. No automatic marketing enrolment. Sending and confirmed-send job-note integration remain separate next chunks.

- [x] Dollar validation, staff-recorded historical offers, estimated date review, shared snooze/exclude/restore rules.
- [x] Overlay case and immutable audit storage with revision protection; migration script authored, only run on a dedicated local test database.
- [x] Authenticated per-job read/write endpoints that verify canonical quote/version and staff identity before writes.
- [x] Queue integration, historical discount display, draft amount, historical evidence/date forms, snooze/exclude/restore, personal session Skip/Undo.
- [x] Full tests, build, browser checks and fresh independent review.

Ruling: store staff-reviewed date-only evidence as an estimate, never canonical exact time. Use conservative end-of-NZ-day timing (capped at current observation for today). Exact old-CRM transition capture remains unavailable.
Ruling: use canonical updatedAt to invalidate a review on any subsequent quote change. This over-invalidates after unrelated edits but avoids silently reusing a review after a possible Dead re-entry. Already exhausted two-offer histories stay complete.
Ruling: missing migration is read-only fallback; other storage errors fail queue loading, preserving the last UI data with a warning and disabling edits. No exclusions/offer history silently discarded on connection failure.
Ruling: new controls are opt-in via DEAD_QUOTE_FOLLOWUPS_ENABLED=true after migration. No production environment or schema changes in this slice.
Ruling: historical offers are staff attestations with immutable audit snapshots, not claimed provider receipts; corrections remove only the latest from the active count and preserve prior evidence. No new-send job note is written for drafts or historical data entry.

Review focus: two staff race; network failure after commit; excluded rows hidden from Due; estimated dates/history becoming stale; historical corrections retaining original discounts; login expiry clearing data; UI-only Skip not shared; schema/runtime failures.

Verification so far: controls unit tests 20; real local PostgreSQL migration rerun, CAS concurrency, rollback-on-audit-failure and immutable-history tests 4. Initial missing implementations failed tests, then passed. UI uncertain-send/conflict handling covered; disabled-fieldset assertions use effective :disabled semantics. Added exhausted-history regression (failed before ordering fix).

Final verification: 99 focused tests including four real local PostgreSQL tests; full npm test passed (868 Vitest tests plus communication scripts); production build, TypeScript and targeted ESLint passed. Both browser smoke scripts passed at 390px and 1280px; screenshots inspected. Independent review found saved-date re-review regression, contradictory date labels and controls enabling during refresh. All three were reproduced with failing tests and fixed. No production migration, deployment or customer communications.
