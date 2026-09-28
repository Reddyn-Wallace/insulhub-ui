# Finance connection deployment and verification

## Server configuration

Required server-only variables:

- `FINANCE_OWNER_EMAIL`: the owner's CRM email, verified server-side through canonical `me`.
- `FINANCE_OWNER_USER_ID`: canonical ID obtained from the email-verified identity screen. Until pinned, all financial reads and Xero authorisation are denied.
- `FINANCE_APP_ORIGIN`: the chosen HTTPS deployment origin. For the registered production app: `https://insulhub-ui.vercel.app`.
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

Verification: 91 finance tests pass including real PostgreSQL snapshot encryption, expiry and owner/mode isolation; TypeScript and targeted lint pass. Independent review cleared matching and calculation changes. Source data was not edited and no live owner decisions were manufactured.
