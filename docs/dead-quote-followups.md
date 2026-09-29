# Dead quote follow-ups: read-only foundation

The Quotes tab now links to `/jobs/follow-ups?stage=QUOTE`. The screen loads the complete accessible quote list through the existing Insulhub authentication, excludes leads, accepted/progressed/archived jobs, and displays Dead quotes for historical review. It shows price, quote date/age, scope, notes, and a narrowly matched historical date suggestion. Conflicting callback/Dead flags require review.

**This is not yet an operational due/send queue.** All real rows require previous-offer review. There is no write API, database migration, messaging action, approved backfill, saved discount, snooze or status mutation in this slice. The existing communication screen remains reachable from the selected quote.

## Backend limitation

The user confirmed on 30 September 2026 that the canonical `api.insulhub.nz` source repository is unavailable. Exact Dead-transition recording across both CRMs therefore remains blocked. The frontend must not invent a canonical field, label an observation as an actual transition timestamp, or derive that timestamp from quote creation/update dates.

The note parser only proposes an estimate for one explicit, dated transition statement. Arbitrary required reason notes, invalid/future dates, multiple Dead references and reopening/acceptance text do not yield a suggestion. Suggestions remain unapproved and cannot make a real job due. Dates are interpreted as NZ dates with an end-of-day conservative scheduling boundary.

## Rules prepared for later integration

`src/lib/dead-followups/rules.ts` provides quote classification, conservative note suggestions and a pure evaluator for verified history. The evaluator applies two calendar months from current Dead entry and, for a second approach, four calendar months from first successful send, whichever is later. It handles NZ daylight saving and month-end clamping, preserves prior discount cents, blocks pending/unknown attempts, and stops at two successful approaches. The production read-only route does not fabricate or supply verified history.

A future backend integration must define immutable entry/exit event IDs and episodes. A future overlay integration must persist reviewed dates with provenance, successful send evidence, immutable dollar discounts and history. A frontend-only observed-at record could be a separately agreed compromise; it would not solve old-CRM changes.

## Verification

- `npm run test:dead-followups`: rule, pagination, authentication and UI tests.
- `npm test`: existing regression suites plus the new tests.
- `npm run build`: production build.
- Start a local production preview on port 3116, then `node scripts/dead-followups-browser-smoke.cjs`. It uses installed Chrome and mocks all business APIs and blocks external requests. No messages or customer writes occur. It covers 390px and 1280px navigation, evidence labels, overflow and page errors; screenshots go to `/tmp/dead-followups-{width}.png`.

Independent review identified malformed nested upstream data and stale customer display after 401. Both are covered by regression tests and fixed. Live schema, production data quality and operational sender behaviour are not established by these tests. No production deployment has been performed.
