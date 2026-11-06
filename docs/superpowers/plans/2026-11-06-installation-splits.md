# Installation splits trial implementation plan

Goal: let the owner try percentage-based partial installations without changing production data.

Approved choices: percentage completed per visit, automatic remaining visit, quoted bag budget until checksheet complete, then retrospective allocation from final actual total. Allocated actual totals remain estimates per visit.

Architecture: shared pure allocation functions and reusable visit editor; an isolated interactive trial with fictional jobs, calendar week summaries, and the existing usage-report calculations adapted to visit rows. Browser-local persistence permits trying, reloading, and resetting without touching either backend. This first trial validates the workflow before introducing overlay database migrations or canonical-date synchronisation.

Constraints: one job/quote; total allocation 100%; completed visits count while parent unfinished; remaining work may be unscheduled; dates use NZ calendar dates; no real customer writes; no production release. No actual-bag entry in this version, per user choice. Missing values never become zero. Final checksheet allocations never double-count the job. Historical changes are visibly labelled and recorded.

- [x] Add tested visit allocation model: partial/complete, rescheduling, quoted estimates, final actual allocation, conflict validation, money/bag rounding.
- [x] Build trial UI: realistic fictional jobs, visit editor, calendar week rollups, usage report, final checksheet simulator, local persistence and reset.
- [x] Add navigation from existing calendar and usage report, isolated preview route and release contract coverage.
- [x] Verify regression tests, build, desktop/mobile browser interactions and branch diff; commit trial branch and provide running preview.

Review focus: repeated splits, zero/missing actuals, unfinished parent report inclusion, cross-week rescheduling preserves history, final actual totals reconcile precisely.

Production follow-on: persist visits in overlay DB keyed by upstream job ID with optimistic concurrency and audit history; read final checksheet from original backend; preserve existing unsplit jobs. Calendar and usage report must share allocation projections. Confirm wall versus ceiling bag semantics before production integration.

## Verification and trial access

Run `npm run dev -- --hostname 127.0.0.1 --port 3128`, then open http://127.0.0.1:3128/jobs/installation-splits-preview.

Verified: `npm test`, `npm run test:finance` (153 passed; seven database-dependent tests skipped), `npm run build`, targeted ESLint and browser smoke at 1440px and 390px. Model tests cover partial reporting before installation, repeat returns, final recalculation, preserved manual usage, rounding, missing/zero data and date validation.

Standalone `tsc --noEmit` reports existing errors in unchanged dead-followups test files (send-route and template-ui). The Next production build passes. No database migration or production deployment was performed.

Trial limitations: fictional data and browser storage only; calendar/report tabs model the proposed behaviour rather than changing live reporting. Final checksheet is simulated. Original backend synchronisation, production concurrency/auditing and migration are follow-on work, not implemented here.
