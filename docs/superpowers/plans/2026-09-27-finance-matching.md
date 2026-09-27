# Finance matching and cash dashboard implementation plan

> Execute inline using superpowers:executing-plans; user authorised proceeding with invoice linking and calculations. Retain the already approved calculation contract as the design authority.

**Goal:** An owner-only live cash dashboard with traceable known reserves, installed-job debt, settlement uncertainty and a reversible review queue.
**Architecture:** Fetch canonical CRM/Xero/Akahu data server-side; pure TypeScript normalises, links and calculates in cents. Neon stores only owner review decisions and their audit history, never copies of canonical business records. Browser holds the latest response in memory only.
**Tech Stack:** Existing Next.js/React/TypeScript/PostgreSQL/Vitest; no added dependencies.
**Spec:** docs/cash-dashboard-calculation-contract.md

## Global constraints
- Trading Account only; NZD including GST; owner-only server checks on every route.
- Read-only bank/Xero/CRM. No Windcave integration or bookkeeping writes.
- Paid status is not settlement evidence; failed/missing data is never zero.
- Never use invoice IDs from CRM as Xero IDs without schema evidence. Exact unique quote/reference links may establish job relationships; collisions require review.
- Unfinished/partial/unknown jobs retain settled advances. Cancellation refunds require explicit evidence.
- All financial decisions are reversible and auditable. No browser or service-worker caching of finance data.

## Review focus
1. Conflicting invoice/job references must not choose the first result.
2. Shared amounts, repeated references and bundled payouts must not be auto allocated.
3. Xero catch-up must remove local debt adjustment only with uniquely identified payment evidence, never just a lower balance.
4. Bank history boundaries, stale data and unsupported currencies must stay visible.
5. Concurrent/replayed review edits must not allocate receipts twice or carry decisions across changed source facts.

## Task 1: Complete source adapters and invoice/job linking
Files: model.ts, live-data.ts, linking.ts and tests under src/lib/finance; owner-only dashboard route.
Interfaces: FinanceJob, FinanceInvoice, FinancePayment, FinanceReceipt and FinanceInputs; loadFinanceInputs(owner); linkInvoices(invoices,jobs,decisions).
- [ ] Write failing tests for exact ID/reference links, collisions, archived/unknown jobs and malformed/partial provider responses.
- [ ] Fetch all CRM stages including archived rows; query quote references without broken invoice relations. Validate targeted job detail for direct invoice evidence where useful.
- [ ] Fetch all Xero invoices/payments with pagination; normalise only supported customer invoice amounts; preserve credits and status. Retrieve Akahu's available two-year transaction history with boundaries disclosed.
- [ ] Run tests and verify live link coverage. Commit.

## Task 2: Evidence-based matching and calculations
Files: calculate.ts, calculate.test.ts, matching.ts, matching.test.ts.
Interface: calculateFinance(inputs, decisions) -> FinanceDashboard with known totals, uncertainty, per-invoice rows, bank match evidence and review items.
- [ ] Write failing acceptance cases from all 19 contract scenarios plus duplicates, partial payments, overpayments and catch-up ambiguity.
- [ ] Implement reference/amount/date matching, one-to-one payment evidence, installed debt/local adjustments, gross unfinished reserves, refunds/fees and uncertain-payment classifications. Auto-matches never use name/amount alone.
- [ ] Keep unmatched receipts and unknown job links separate, indicate incomplete headline totals and historical coverage; no overstated confidence.
- [ ] Run tests; commit.

## Task 3: Owner review overlay
Files: review-store.ts, review.test.ts, scripts/finance-review-schema.sql, /api/finance/review route.
Interfaces: listReviewDecisions(owner), saveReviewDecision(owner,validatedInput), immutable event history with optimistic revision.
- [ ] Test owner checks, conflicting edits, allocation caps, stale fingerprints and deletion/reversal.
- [ ] Store only references/allocations/classifications/reasons with audit events; read current canonical evidence before changes. Support invoice/job links, receipt allocations, non-customer classification, evidenced refunds and opening reserves with explicit owner confirmation.
- [ ] Verify against disposable PostgreSQL and provision finance-only overlay tables. Commit.

## Task 4: Dashboard, live verification and review
Files: /jobs/finance/page.tsx, finance components, dashboard route tests/UI tests, connection-page link.
- [ ] Show bank balance, known unfinished deposits, cash less those deposits and known installed debt. Place uncertainty adjacent to amounts. Include invoice/job drilldowns and review workflow.
- [ ] Add filtering/search, source timestamps, refresh, copy/export restricted to the visible filtered rows; no invented trend/history.
- [ ] Run finance suite, type/lint/build, browser verification and independent whole-change review. Fix material issues, deploy and verify live numbers/source comparisons.
- [ ] Record unresolved data decisions honestly; do not fabricate owner confirmations.
