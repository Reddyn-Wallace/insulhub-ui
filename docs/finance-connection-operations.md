# Finance connection deployment and verification

## Server configuration

Required server-only variables:

- `FINANCE_OWNER_EMAIL`: the owner's CRM email, verified server-side through canonical `me`.
- `FINANCE_OWNER_USER_ID`: canonical ID obtained from the email-verified identity screen. Until pinned, all financial reads and Xero authorisation are denied.
- `FINANCE_APP_ORIGIN`: the chosen HTTPS deployment origin. For the registered production app: `https://insulhub-ui.vercel.app`.
- `AKAHU_CREDIT_CARD_ACCOUNT_ID`: confirmed Visa Business card; optional isolated fourth figure.
- `AKAHU_APP_TOKEN`, `AKAHU_USER_TOKEN`, `AKAHU_ACCOUNT_ID`: the confirmed Trading Account only.
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`.
- `FINANCE_DATABASE_URL`: a **direct**, not transaction-pooled, PostgreSQL connection. Required because refresh uses a session advisory lock. Neon `-pooler` endpoints are rejected.
- `FINANCE_ENCRYPTION_KEY`: base64 encoding of 32 random bytes. Preserve it across deployments; changing it without re-encryption requires Xero reconnection.

Provision `scripts/finance-connections-schema.sql` deliberately on the intended database. No request runs migrations. The tables contain encrypted integration credentials and one-time OAuth state only. Do not duplicate canonical jobs or invoices into these tables.

The local `.credentials/cash-dashboard.env` handoff is not an application loader. Transfer approved settings into the chosen server environment; do not include this file in deployments, build output or Git. Do not populate unrelated preview branches with production finance credentials.

## Sequence

1. Deploy the connection screen and callback. Confirm unauthenticated finance endpoints return 401 (or 503 when owner provisioning is absent), never data.
2. Configure the owner's email. The signed-in owner visits `/jobs/finance/connections`; it shows their server-verified canonical ID without financial data. Pin that ID in the server configuration.
3. Provision connection tables and credentials in the intended environment. Verify a second CRM identity receives 403. If a second identity is unavailable, record that live test as outstanding; unit tests are not a live second-user check.
4. Owner starts Xero authorisation and reviews the requested read-only scopes. Choose Insulmax Insulation (Wellington and Wairarapa) Limited, then explicitly select it on the connection screen.
5. Compare the timestamped bank balance and a sample of Xero invoices/payments and CRM job links with their source UIs. Source cards report connection health, not completed financial reconciliation.

## Tests

- `npx vitest run src/lib/finance` runs non-database checks; integration tests explicitly skip without the test URL.
- `FINANCE_TEST_DATABASE_URL=postgresql://127.0.0.1:<port>/<disposable-db> npx vitest run src/lib/finance` also exercises single-use state and concurrent/crash-safe refresh against real local PostgreSQL. This test URL must be a disposable local database; never point it at live data.
- `npx tsc --noEmit`, targeted ESLint and `npm run build -- --webpack` verify compilation.
- `npm test` runs the existing project suite.

## Current evidence

34 finance tests pass, including real PostgreSQL concurrency, interruption recovery and stale tenant-selection rejection. Existing project suite passed. Typecheck and targeted lint passed. Production build passed after final review fixes. The build script explicitly uses webpack so the existing PWA plugin generates the finance NetworkOnly rules; generated service-worker files are excluded from deployment uploads and rebuilt. Local browser verified meaningful connection content and sign-in-required state, with no financial data exposed. Live owner identity, Xero consent, deployment secret configuration and cross-source comparison remain outstanding.

Review rulings: require a direct finance database URL rather than reuse the existing possibly pooled overlay URL. Bind tenant selection to a credential generation. Mark missing CRM links/statuses incomplete. Exclude finance API/page routes from service-worker runtime caching. No finances are calculated yet; that belongs to the subsequent approved chunks.

Hosted preview deployed successfully at https://insulhub-ofypd2j02-reddyn-wallaces-projects.vercel.app/jobs/finance/connections. Browser verification reached Vercel preview authentication; owner sign-in is required before canonical identity verification. Only FINANCE_OWNER_EMAIL was provided for the preview. Production has not been replaced, finance tables have not been provisioned there, and bank/Xero secrets have not been installed there.

27 September live provisioning: owner signed into the protected preview; canonical CRM identity was verified and pinned in production settings. All ten finance server settings are now configured as production secrets. Existing local Insulhub direct Neon connection was verified against overlay tables, and the two finance tables were provisioned successfully. No canonical job/invoice tables were changed. Production deployment is in progress; Xero consent, source comparison and live second-user denial check remain outstanding.

Live checks: production bank card shows NZD 11,993.17, balance updated 27 September 2026 19:34 NZDT, transactions 19:35, 84 posted transactions in the preceding 30 days. Unauthenticated identity/sources/organisation requests return 401 with no-store/private. Xero consent succeeded once and encrypted credentials were stored; a subsequent reconnect flow is currently at user consent, so tenant selection must be completed after it returns.

CRM investigation: bulk jobs query returns non-null-field errors at depositInvoice.xeroInvoiceNumber (and potentially other invoice-number paths). The precise known missing-number error is now retained as an incomplete-link flag; all unrelated errors still fail closed. Live check returns 1,777 jobs and 1,582 installed, with 1,777 incomplete invoice links and no missing installation statuses. This does NOT establish that invoices lack numbers in the source; bulk relation resolution may be responsible. Next chunk must validate detail-query invoice relations and cross-match Xero, rather than assume no invoice exists. Added two regression tests; all 36 finance tests including PostgreSQL pass and typecheck/build pass. Latest deployed implementation f88bc49; UI wording clarification is committed after deployment. Live second-user denial remains untested.

Xero live verification completed 27 September 2026 approximately 21:53 NZDT: user completed consent; expected Insulmax Wellington and Wairarapa organisation explicitly selected; source check read 448 ACCREC invoice records and 926 payment records. Samples INV-0008 (3300.00), INV-0014 (565.22), INV-0015 (1430.31), INV-0023 (1325.00), INV-0024 (2000.00) all matched the supplied CSV for total, amount paid, zero amount due, NZD currency and Paid status. The CSV has 444 line rows representing 285 unique invoices; full API/export scope reconciliation remains for the matching chunk, so counts should not be assumed equivalent. Bank and CRM observations remain as above. No further credentials are currently needed. Remaining: resolve invoice relations through CRM job detail, audit full job/deposit scope, implement and validate matching/calculations.

## Cash dashboard release — 27 September 2026

Owner dashboard is live at `/jobs/finance`. It reads all-stage CRM jobs, approved Xero sales invoices/customer payments, and available Trading Account transactions within a requested two-year window. Only owner decisions and their immutable events are persisted in the new finance review tables; source data is read-only. Decisions support explicit job links, receipt/refund allocations, processor fees/splits, non-customer classification, historical opening evidence and retained releases, with revision conflicts and source-identity invalidation.

Verification: 77 finance tests pass including real PostgreSQL concurrent-save/undo tests; existing project suite, TypeScript, targeted ESLint and production build pass. Fresh independent review cleared delayed-settlement double deductions, net processor payouts, repeated references, changed invoice identities, refund netting and reused payment evidence. Final implementation c85e5d9. Unauthenticated dashboard returns 401 with `no-store, private`. Live second-identity denial remains outstanding.

Live coverage: 2,954 CRM jobs and 286 approved sales invoices; 208 unique links and 78 unresolved references. Complete Xero labels `Quote #AP28896` and `AP28688 (deposit)` are normalised, not fuzzy matched. Bank `INV 0425` is recognised as `INV-0425`; bare invoice digits, truncated quotes, names alone, shared quote receipts and processor payouts remain review items. Shared quote ambiguity is preserved before amount/date filtering.

Independent source samples: CRM job detail shows INV-0370 on BW27891 with installation result Job not started yet (notes describe partial work), and INV-0422 on RW26353 Installed as quoted. Dashboard preserves the agreed status rule. Supplied CSV agrees for INV-0422 due 6,464.18, INV-0441 due 4,877.44 and INV-0406 paid 1,927.69/due zero. No live owner review decisions were created for testing.

Limitations: unresolved invoice/job links and historical bank classification mean headline deposit/debt amounts are provisional known subtotals. The large unmatched-receipt figure is cumulative bank history, not current cash or an additional reserve. Installation changes recalculate from canonical CRM; the overlay event history tracks owner decisions, not a separate historical series of all CRM status changes. Desktop layout was inspected; attempted browser mobile override stayed at 1600px, so phone-sized visual verification is not claimed.

Final live snapshot at 22:42 NZDT: bank NZD 11,993.17 (19:34 feed), evidenced unfinished advances 25,566.28, bank less known advances -13,573.11, linked installed-job debt 42,340.01. Still 78 unlinked invoices; unfinished paid-but-unconfirmed 15,942.58. These are explicitly provisional and should not be treated as a completed reconciliation.

## Reviewer corrections — 28 September 2026

The active contract now uses Xero paid/due amounts and binary CRM installed/not-installed status. Bank reconciliation is separately requested and does not gate deposits or reduce Xero debt. Historical manual release decisions cannot reduce deposits; no partial-work valuation workflow exists. Completed-stage legacy records are recognised, except explicit unfinished status conflicts which remain flagged.

Invoice reference labels are normalised without stripping quote revisions. Exact CRM invoice numbers can resolve duplicate quote references only when consistent with a quote candidate. Customer names only select records to inspect; they never establish a link. Detail verification covers ambiguous/unlinked candidates and uniquely linked unfinished jobs. Uniquely linked installed records use the CRM index's completion status.

Live verification after corrections: 286 approved invoices, 2,954 CRM jobs; unlinked count reduced from 78 to 13. All remaining unlinked invoices have zero outstanding. Installed-job debt increased from NZD42,340.01 to NZD54,697.56, recovering NZD12,357.55. Paid advances on unfinished jobs are NZD29,508.24; Trading Account balance NZD12,742.17, feed timestamp 28 September 19:33 NZDT. Bank less known advances is -NZD16,766.07. Paid unlinked invoices still require review before deposits can be treated as complete.

Fresh overview source load measured 19.006 seconds (CRM index13.627s, detail4.983s, Xero0.524s, bank0.742s; parallel phases). Historic bank reads are deferred. Five-minute encrypted owner/mode-scoped snapshots are stored in finance_snapshots so repeat visits survive server instance changes; explicit Refresh figures bypasses them. Every request still verifies the canonical CRM owner; browser responses remain private/no-store. Source timestamps stay visible. No credentials are included in snapshots. Failed cache reads/writes fall back to fresh sources; expired snapshots are never returned. Old rows are overwritten on the next successful refresh.

Verification: 92 finance tests pass including real PostgreSQL snapshot encryption, expiry and owner/mode isolation; TypeScript and targeted lint pass. Independent review cleared matching and calculation changes. Source data was not edited and no live owner decisions were manufactured.

Final shared-cache deployment verified live: first source read22.244s (CRM index16.583s), repeat page showed identical checked-at timestamp and all figures within9s of reload. This confirms reuse, not a sub-second claim; cold/explicit fresh loads still take about19–22s and CRM remains the bottleneck. Desktop visual inspection passed. INV-0449 now links to installed E0900 with NZD7,876.75 due. All four cache tests passed after the concurrent forced-refresh fix; independent review cleared that fix. Implementation98ba42c is deployed.

## Three-figure revision — 29 September 2026

Revision084660d deployed: main view is exactly latest Akahu balance (actual feed timestamp), deposits held for not-installed work, and unpaid installed-job amounts. Technical matching counts, bank workflow and source explanation are collapsed under one supporting drill-down. No bank-less-deposits fourth headline or partial-work valuation remains.

Overview reads seven days of bank receipts and Xero payment records. Recent receipts require a unique full invoice reference or active owner allocation; amount alone, multiple references (including unknown invoice numbers), processor payouts and stale allocations are excluded. Adjustment is capped at amount due and offsets all Xero-paid amounts to prevent repeated deductions. Bank balance and deposit calculation are unchanged. Ambiguous overlap stays owed with explanation; notably an older deposit larger than a recent final payment cannot be safely separated using payment dates alone. This is a deliberately conservative limitation, verified by regression tests. No live Xero/CRM/bank source records were modified.

Verification:100 finance tests pass including real PostgreSQL tests and receipt/Xero catch-up, partial receipts, old-deposit overlap, owner decisions, currency/scope and bank-balance invariance checks. TypeScript, targeted ESLint and production build passed. Independent review found date-based and explicit-payment overlap risks; both resolved by conservative aggregate overlap calculation. Source snapshot version bumped to avoid using old overview data.

Production browser verification: revised heading/loading copy is live. Existing CRM session failed canonical identity verification; navigating to normal Jobs redirected to the standard sign-in page, confirming expiry. Sign-in was handed to owner. Final authenticated amounts/layout inspection remains pending renewed login; no authentication bypass was attempted. Component tests verify the three headline labels, removal of fourth metric, preserved detail filtering and no invented zero figures on failure.

## Authenticated verification — 29 September, after reconnection

Live three-card layout verified with restored CRM/Xero access. Bank NZD19,885.21, Akahu balance and transactions updated29Sep19:47NZDT. Deposits NZD27,903.99. Installed-job debt NZD51,165.62 = Xero installed debt54,697.56 minus recent receipt3,531.94. Source snapshot checked29Sep21:25:50NZDT;286 approved invoices and2,953 all-stage jobs. The installed-debt table contains installed jobs only. INV-0440 is installed, Xero paid0/due3,531.94;27Sep bank receipt3,531.94 has full Inv0440 reference. Bank balance is not increased by the deduction. No uncertain-overlap notice triggered on this snapshot; this does not certify unmatched receipts or resolve unknown jobs.

Actual unresolved scope:13 invoices, NZD39,534.04 paid, zero due. Their unknown completion status can affect deposits; it contributes no additional outstanding debt. The amount is historical payments, not established missing deposits or current bank cash. No manual matching decisions were invented.

Connections diagnostic1777 is a different count: jobs in four later stages whose bulk deposit/final/additional invoice fields had no number or a known null-field read error. It counts a job even when one field errors and another invoice number exists. It does not run the dashboard's quote-reference matching or targeted individual-job invoice verification. Dashboard uses all stages and those stronger matches. The old chunk3/scheduled-only wording was obsolete and misleading. Corrected connection wording calls this a bulk-check diagnostic and points to actual cash invoice results; no demand to repair thousands of jobs. Also corrected detail copy to distinguish recent receipt checks from unloaded older settlement history.

Wording-only follow-up66ce17a deployed successfully; TypeScript, targeted lint and production build passed. New production Connections explanation visibly verified. Calculation unchanged. Authenticated dashboard layout and all three values were inspected before this wording-only deployment; source-freshness labels show supplied feed times rather than real-time claims.

Final post-deployment refresh29Sep21:32NZDT: installed owed52,365.62. Difference+1,200 is newly visible INV-0451 (Nik Florance, R25136, installed, Xero due1,200), verified in the live installed-debt table. Bank19,885.21, deposits27,903.99, recent adjustment3,531.94 and unresolved13/paid39,534.04/due0 remain unchanged. Final dashboard left open with three cards and collapsed supporting details.

## Named recent-receipt corrections — 29 September 2026

Read-only Akahu investigation over90days confirmed all three named receipts exist in the current feed and are within7days; neither feed coverage nor cutoff caused these misses. Berry4877.44 on28SepUTC carries `Inv0441` with no separator. Shona6464.18 on27SepUTC carries explicit quoteRW26353 but earlier deposit numberINV-0340. Richardson3531.94 on27SepUTC carries `Inv 0440` and was already deducted. Bank feed updated29Sep19:47NZDT.

Compact INV references now normalise with full digits preserved. Reused-deposit fallback requires: fully paid earlier deposit with no credits; new receipt greater than deposit's entire total; explicit same quote; both invoice links resolve to one installed CRM job; unique later invoice whose full value equals receipt. Paid later invoices remain candidates so Xero catch-up never switches allocation to another unpaid invoice. No name/amount-only guess is used. Shona's deposit2308.60 dated5Aug/paid17Aug and finalINV-0422 6464.18 dated14Sep satisfy these checks. Supporting rows show receipt date, amount, bank description and match reasoning. No new confirmation workflow or main-screen figure introduced.

Actual-source replay with current owner decisions gives zero owed for INV-0422, INV-0441 and INV-0440 and total recent adjustments14873.56. Extra correction versus previous logic11341.62.102finance tests, TypeScript and targeted lint passed; independent review found no material issue. Added partial/full catch-up, missing-quote, ambiguous later invoice and already-paid duplicate target cases. Seven-day short-lag scope remains unchanged.

Calendar deployment coordination: commit2b42f3d (native Open job link) cherry-picked as59990a3 before finance changes. Calendar thread confirmed deployment complete and no more deploys planned. Finance deployment preserves that change.

## 29 September 21:56 NZDT final deployment verification

Production deployment `2G6iyJR2kBmiXxG6ZY1fUqYdgcdE`, implementation `167a4bb`, successfully aliased to insulhub-ui.vercel.app. Includes receipt matching12553d1 and calendar native-link59990a3. Fourth separate Visa Business card uses pinned account and reports NZD3,585.30 owed, actual Akahu balance timestamp29Sep19:47NZDT. Bank19,885.21; deposits27,903.99; installed owed52,512.50.

Authenticated live invoice drilldowns verified: INV-0422 Xero paid6,464.18, due/known owed0, receipt28Sep10:18NZDT with explicit RW26353 and reused INV-0340; INV-0441 paid4,877.44, due/known owed0, receipt28Sep14:01NZDT with Inv0441; INV-0440 paid3,531.94, due/known owed0, receipt27Sep16:35NZDT with Inv0440. Xero has now caught up, so local additional deduction correctly0. Earlier pre-reconciliation replay verified all three adjustments. Do not compare total debt by subtracting these receipts alone: other source invoices changed during work.

109 finance tests pass including card debt/credit/unavailable UI states and real PostgreSQL; TypeScript, targeted lint, production build and independent review pass. Calendar source still uses native Link and preserved commit is ancestor of deployment. Details left collapsed on live four-card dashboard. Remaining13 unlinked invoices contain39,534.04 paid and0due; deposits may remain incomplete. Named receipt verification does not certify the whole ledger. Fresh CRM loads still take roughly20seconds; five-minute cache improves repeats.

## 29 September net-bank presentation and 13-invoice audit

Owner clarified headline as operating account less credit card. Deployed bf23900: bank19,885.21 plus signed card-3,585.30 =16,299.91. Both feed times29Sep19:47NZDT; positive card credit explicitly labelled, missing card makes combined amount unavailable. Deposits and completed-job debt remain separate.113 tests passed for this change.

Investigated all13 unlinked invoices; detailed table in finance-unmatched-invoice-audit-2026-09-29.md.0750171 adds corroborated quote collision/revision matching and exact slash/punctuation support, with all competing job details fetched before final linking.116 tests passed, independent review passed after fixing candidate hydration. Live22:12 source snapshot verified all8 resolved rows:7 installed/zero reserve, Warren INV-0092 explicitINSTALL_NOT_FINISHED + stageCOMPLETED retains1,207.50. Deposits29,111.49; remaining5 unlinked paid7,913.04; owed52,512.50. All3 prior named receipts still show0owed. Da Silva INV-0445 still3,338.25due; no corresponding Akahu entry found January–September; asked owner for bank-entry evidence.

Final wording deployment25c33e2, Vercel2NwefQqUTmRNRWEkmdr31HyMM8pN, succeeded and aliased production. Authenticated browser confirmed signed cash components, both timestamps, all totals and Warren label nowNot installed. Calendar native-link59990a3 and recent receipt12553d1 remain ancestors. Only follow-up questions remain for missing/ambiguous source records; no source edits or invented review decisions were made. Final dashboard details collapsed. Generated service-worker files remain untracked and excluded.

## Pending bank payments deployed,29September23:01NZDT

afd6d16 deployed successfully as8DPs3RmfBbNsrLHR6yoG1pjBA6EP and aliased production. Akahu pending entries are a separate source, rebuilt each snapshot with provider update times. Live bank feed has Da Silva3,338.25 and Lauren Candy1,804.79 pending. Da Silva's full Inv0445 reference matches installed invoice; Lauren's bare0447 does not automatically qualify and remains visible without deduction. UI and CSV separate pending from settled deductions. Bank remains19,885.21, card-3,585.30, combined16,299.91, deposits29,111.49; amount still to collect49,174.25 plus3,338.25awaiting settlement. INV-0445 drilldown verified Xero due3,338.25, known owed0 and pending status.

121 tests pass, TypeScript/targeted ESLint/production build pass, independent review cleared exclusions/refunds after regression fixes. Tests cover cancellation/removal restoring debt, duplicate pending rows, settlement/Xero transitions, unavailable pending feed, account filtering and invalid timestamps. Snapshot version pending-payments-v7 forces prior caches to reload. Original settled-only search missed Da Silva; audit corrected. No sourcefinancial mutations made; only manual Akahu data refresh occurred during diagnosis.

### Manual bank refresh (8 October 2026)

The explicit **Refresh figures** button now POSTs to the owner-only dashboard endpoint. It requests Akahu `/v1/refresh/{accountId}` for the operating account and configured Visa, then polls each account's balance update timestamp for up to 45 seconds. A 200 response is only an accepted request, not proof of fresh data. Newer timestamps, unchanged/rate-limited data and unavailable refresh checks are reported per account. A recent unchanged timestamp ends polling early because personal apps have a one-hour rest period. Akahu may refresh other accounts sharing the same bank login.

After this check, any earlier in-flight dashboard source loads are allowed to settle, then figures are forced to reload. Opening the page, checking old bank history and saving review decisions do not trigger upstream bank refreshes. Transaction timestamps remain independent of balance timestamps. Sources: https://developers.akahu.nz/docs/personal-apps and https://developers.akahu.nz/reference/post_refresh-id .
