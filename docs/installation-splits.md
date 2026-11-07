# Installation visit splits

Implemented on `codex/installation-splits`. This is persistent CRM functionality, replacing the earlier fictional trial. No production deployment or production migration has been performed by this task.

## Staff workflow

Open an installation job's Job tab, or select its card in the calendar. Ordinary jobs show a **Split job** button. The calendar seeds the editor from its existing authorised response, without another per-job loading request. Set the original installation date through normal planning first; existing invoice/certificate prerequisites still depend on it.

Click **Split job**, enter the first visit's completed share, and the initial return visit automatically receives the remainder. Set a return date or leave it blank. Split jobs show only a compact visit/date/share/status summary until **Edit visits** is selected.

Edit any visit's date or percentage, add visits, remove visits, or use **Remove split — use one visit** and choose its date/status. Every share must be positive and the total must equal 100%. Done visits require an actual date; Planned visits can be undated. An existing visit with manually recorded usage cannot be removed or reopened through this editor. A single-visit reset retains the overlay/audit so the explicitly selected date remains authoritative.

Completed checksheets and completed parent jobs can be split retrospectively. The first historical split requires a reason. The source job status/checksheet remain unchanged. Subsequent visit edits are audited automatically; operational screens do not show usage calculations or audit history.

Undated planned visits appear in the normal **Jobs** queue and search results, labelled **Revisit needs scheduling**, with only their allocated area/value. **Schedule revisit** opens the same editor. Completed parent jobs with remaining visits are included. The separate calendar unscheduled section has been removed.

Calendar saves patch the affected job's cards directly from the confirmed response; no whole-calendar reload is needed. Calendar position is retained, other jobs are untouched, and stale in-flight responses are ignored. Normal pencilled/confirmed status, scope and planning notes remain available. For overlay-managed jobs, dates are edited only in the visit manager so planning saves cannot overwrite them.

## Reporting

- Calendar: a card per visit, with allocated quoted area and quote value. Keeps the existing quote-total/GST basis; not an accounting revenue-recognition change. Cards distinguish planned work from recorded work.
- Usage dashboard: a row per completed visit, even if the source job's installation status is unfinished. Planned returns are excluded. Existing unsplit jobs retain their former reporting behaviour.
- Before the final checksheet is complete, visit bags are the snapshotted quoted budget multiplied by the completed share. These rows are labelled estimated and excluded from variance claims based on actual usage.
- Once the original checksheet is complete (or marked signed complete), its actual total is allocated retrospectively across visits. Historical weeks can change and rows are labelled **Revised · allocated actual total**. This is actual total usage but still estimated per-visit usage.
- Existing explicit per-visit actual quantities are preserved in final reconciliation. Missing/inconsistent final totals show a warning; known recorded quantities remain visible. Zero is a valid actual quantity. No manual bag entry is introduced in this MVP.
- Uses the existing usage dashboard's `actualBags` field and `quote.wall.c_bagCount` budget source. Does not silently add the separate ceiling-bag fields. Split budgets stay missing if unavailable at first split; the current whole-job quote must never substitute for a missing allocated budget.
- Split m² are percentage allocations, so the usage dashboard does not present them as actual bags-per-installed-m² efficiency. It retains the actual metric for unsplit jobs.
- Sales/install report: the accepted sale stays a single job; installation and upcoming sections use visit allocations. Pending visits remain upcoming, including unscheduled remainders. Weekly snapshots are bypassed while split records exist to avoid stale dates/allocations.

## Database ownership and compatibility

Original backend remains authoritative for jobs, quote, parent installation status, checksheet, invoices and certificates. Visit records live in the overlay database, linked by original job ID. Snapshot values freeze when splitting begins; later quote edits do not silently rewrite prior allocations. Approved scope/value changes to an already-split job require a reviewed adjustment/backfill; this MVP has no quote-reallocation UI.

The original installation date is preserved as a **legacy reference**, not synchronised to return visits. The split calendar and reporting use visit dates. Original-backend screens, legacy templates and certificates still read the original date; staff must review those dates before sending documents or messages. This implementation does not send or modify any customer communications. This is an explicit compatibility limitation before production rollout.

Authenticated per-job reads/writes verify source job access with the caller's CRM token. Writes accept validated actions, not client-supplied quote snapshots. Optimistic versions reject stale clients. A single PostgreSQL statement atomically saves the updated record and its audit event; competing writes cannot lose history or count progress twice. Staff report-list reads follow the same access convention as existing planning/report endpoints.

## Migration, release and rollback

`npm run installation-splits:migrate` creates `job_installation_splits` and `job_installation_split_events` in `DATABASE_URL`. Repeatable additive migration; no original backend schema/data changes. The guarded production build runs it after source checks. It is not run automatically in development or against shared preview databases. A preview needs an isolated overlay database with this migration applied.

Normal rollout still requires a protected-master PR, passing CRM regression suite, and post-deployment verification. Do not deploy this branch directly to production. Rolling back application code retains both tables/audit history. Older code will not honour split allocations; pause scheduling/report decisions until the compatible release is restored rather than deleting split records.

## Verification

- `npm test` includes allocation, projection, routes, UI, report and PostgreSQL tests.
- `INSTALLATION_SPLITS_TEST_DATABASE_URL` must target the disposable loopback `127.0.0.1:55687/crm_tests` database. The integration tests use their own schema and test migration repeatability, simultaneous writers, stale retries, persistence and audit rollback.
- `npm run test:installation-splits:browser` checks the actual calendar/editor and usage-report pages at desktop and mobile widths using intercepted test responses; no real customer data or original-backend mutations. `INSTALLATION_SPLITS_SMOKE_BASE_URL` selects the local app.
- CI runs these database tests and browser checks, and release contract covers the real API/report routes. The fictional preview route has been removed.

### Verification result (6 November 2026)

CRM `npm test` passed with installation/follow-up/campaign database tests enabled against the disposable local PostgreSQL database. All 160 finance tests passed. All 33 installation-split tests passed; desktop (1440px) and mobile (390px) browser checks passed. Production build, release ancestry/route checks and targeted ESLint passed. The standalone `tsc --noEmit` command still reports pre-existing errors in unchanged follow-up test files (`send-route.test.ts` and `template-ui.test.ts`); no new split-related type errors were reported. The Next production build's TypeScript check passes.


### Compact manager verification (8 November 2026)

64 targeted tests passed with the disposable PostgreSQL tests enabled. Desktop/mobile browser checks cover the compact editor, immediate calendar patches, normal planning controls, three visits, queue/search inclusion and scheduling an undated revisit. Production build, built-route contract and 13 release-guard tests passed. No business records were changed by these checks. This revision is committed locally, not deployed to production. Standalone TypeScript still reports pre-existing errors in unrelated follow-up tests; the production build passes.
