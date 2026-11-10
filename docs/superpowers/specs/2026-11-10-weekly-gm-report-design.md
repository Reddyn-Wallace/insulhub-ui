# Weekly GM report

Status: proposed design for approval. No application changes or deployment.
Date: 10 November 2026 (New Zealand).
Design branch: `codex/weekly-gm-report-design`, based on fetched `origin/master` (`f285c6a` at preparation).

## Purpose

Give the GM one report per Monday–Sunday week in Pacific/Auckland, combining leads, installation activity, operating profit, upcoming schedules, booked pipeline and accepted sales. The GM writes commentary, work autosaves, and finalising creates a permanent record. Normal opening and week navigation read saved data; only an explicit refresh updates existing draft figures.

The reference is the read-only Drive workbook `Insulmax_Weekly_GM_Report.xlsm` (file ID `1bTR20ysh58tfjETrdDS2UTXWm5CeieX4`). The CRM supplies ongoing operational data; the workbook is a reference, not a live dependency. Importing its historical reports is outside this version.

## Approaches considered and decision

1. **Saved weekly snapshots, explicit refresh — selected by user.** Store report-ready figures and source details in the existing application database. Draft commentary autosaves independently. Predictable figures while writing, fast subsequent opens, and stable history.
2. **Saved reports with automatic background updates — not selected.** Fresher figures without a click, but figures could move underneath commentary. Finalised reports would still need immutable snapshots.

This is a substantial feature, using the existing Next.js CRM and overlay database. Keep the existing Sales & Usage report, bag-usage report and calendar working. No new external reporting service or recurring automation is required.

## Agreed requirements

- One weekly report, Monday–Sunday, NZ dates; drafts autosave and can be finalised.
- Finalised reports cannot be reopened, refreshed or edited in this version.
- Financial amounts are NZD excluding GST.
- Current-week revenue relates to completed installation work, including completed portions of split jobs. Jobs that did not happen are assumed removed/rescheduled in the calendar by the team.
- Split proportions determine the week's share. Use actual bag totals when complete and available, otherwise estimates; identify estimates clearly.
- Forecasts include pencilled and confirmed work equally.
- Calendar placeholders are descriptive schedule entries only: no revenue, cost, m² or capacity contribution, even if legacy placeholder records contain estimates.
- Council fees are identified in quote extras despite wording variations. Use the customer charge as the cost, per the user's averaging assumption.
- One all-inclusive weekly wages figure and one weekly opex figure.
- Financial budget comparison is operating profit only.
- Weekly sales m² target combines wall and ceiling; count sales by acceptance date, once per job, scheduled or unscheduled.
- Booked pipeline combines pencilled and confirmed remaining scheduled work. Coverage is m² / 80 days and m² / 400 weeks, with the same rate for wall and ceiling.
- Manual refresh preserves commentary. Finalisation freezes figures, commentary, settings, allocation details and provenance.

## Report layout

Proposed entry: Reports → Weekly GM report, `/jobs/reports/weekly-gm`. Use the existing CRM navigation and responsive styling.

Header: week date range, previous/next controls and week picker, Draft/Finalised status, last successful data-refresh time, autosave state, Refresh data, Finalise and a link to report settings. Default to the previous completed week on first entry; preserve a deliberately selected week in the URL.

1. **Leads by day:** seven daily counts and weekly total, based on CRM lead/job creation dates in NZ time. Link to underlying jobs where appropriate.
2. **Installs for the week:** dated job/visit rows with customer, job link, wall/ceiling and combined m², visit percentage, completion state, revenue and bag-use basis. Include placeholders as visibly separate text rows in date order. Distinguish planned rows from completed work; only completed work contributes to the current-week P&L and installed m².
3. **Weekly P&L:** revenue, wall and ceiling bag COGS, council fees, wages, opex, operating profit, operating-profit budget, dollar variance and above/below/on-budget state. Show total installed m² and whether financial totals contain estimates or missing inputs. Commentary prompt: “Was the week over or under budget? What was this due to?”
4. **Next two weeks:** two separate Monday–Sunday schedule snapshots, relative to the report week, each with dated visits/placeholders, total scheduled m² and the same P&L breakdown and profit comparison. All forecast figures are labelled Forecast. One commentary box below both weeks: “Are the upcoming weeks schedules above budget? If no what is being done?”
5. **Booked pipeline:** total remaining booked m², equivalent working days and weeks, with pencilled/confirmed combined. Show source date as the snapshot refresh time. Commentary: “How are you feeling about the current levels of pipeline? What are you focusing on in this area?”
6. **Jobs sold:** accepted job rows, acceptance date, wall/ceiling and combined m², ex-GST value, weekly m² total, m² target and variance. Count the whole sale once, independently of visit splits. No extra mandatory commentary section is proposed here.

## Settings and historical behaviour

Report settings: wall bag cost, ceiling bag cost, weekly all-inclusive wages, weekly opex, weekly operating-profit target and weekly sold-m² target. Initialise capacity at 80 m²/day and 5 days/week; show the conversion explicitly. Builder choice: keep capacity fixed in this version rather than introducing unrequested controls.

No invented financial defaults: show an initial setup state until required settings are entered. Explicit zero is valid for money inputs; bag costs cannot be negative; sales target must be non-negative. Negative profit targets are allowed. Store money in cents and validate finite numeric inputs.

Proposed behaviour: each successful draft build/refresh copies the current settings into that report. Settings edits do not silently recalculate already-open or saved reports; explain that Refresh applies them to a draft. Earlier finalised reports retain their original costs and targets forever. Existing historical drafts use current settings if explicitly refreshed; show this in the refresh confirmation information, without an extra approval step.

## Financial and allocation rules

Revenue = source gross quote total / 1.15, allocated to completed visits for the reporting week. Quote extras are already included in the quote total; never add council-fee revenue a second time. Retain sufficient precision during calculation and reconcile rounding across visits so the parts total the whole job. Match the existing split model's residue handling.

COGS = wall bags × wall bag cost + ceiling bags × ceiling bag cost. Council fees are shown separately. Operating profit = revenue − COGS − council fees − wages − opex. Profit variance = operating profit − operating-profit target; positive is favourable. Sales variance = accepted m² − sales-m² target. Avoid percentage variance when a target is zero; dollar/m² variance is sufficient.

Apply the existing split visit proportion to revenue, wall m², ceiling m², estimated bags and council cost. Completed portions feed current P&L; only remaining planned dated portions feed forecasts and booked pipeline. Undated remaining work is excluded from booked coverage and may be disclosed separately as unscheduled work. Never add the original full job alongside its visits.

For completed split work, reuse the existing `reconcileUsage` semantics: individual recorded usage takes precedence; otherwise allocate the final checksheet total after reconciling recorded visits; while incomplete use the estimated budget allocation. Clearly distinguish “Actual recorded”, “Allocated from actual total” and “Estimated”. A proportional allocation from an actual whole-job total is still an allocated estimate at visit level and should be highlighted. Frozen historical reports do not change when later completion makes a more accurate allocation available.

For ordinary jobs, completion must follow existing installed/checksheet states, not the fact that a scheduled date is in the past. In-progress work without recorded split completion is shown but not fabricated as earned revenue; direct the GM to existing visit progress controls.

**Known source limitation:** the inspected usage/checksheet queries expose a single actual-bag field used for walls; quote fields expose separate wall/ceiling bag estimates. Do not assume that one actual number applies to both products. Before implementation, verify the actual source semantics and any ceiling actual field using available primary API/schema evidence. If no ceiling actual is available, use quoted ceiling bags and label that component Estimated, including on completed jobs. Missing estimates/actuals are unknown, not zero: show the affected rows and mark aggregate profit incomplete; block finalisation for missing required numeric inputs or unresolved usage conflicts. Valid, clearly labelled estimates are allowed in a finalised report.

For forecasts, allocate remaining visit revenue, quoted bag estimates and council extras; subtract the full weekly wages and opex once for each week, including an empty week. Do not calculate forecasts from work already completed. An actual completed portion must not reappear as a future booking.

Council extras: normalise case, whitespace and punctuation and recognise specific council-fee/application/exemption wording. Retain matched extra name and amount for inspection. Verify GST treatment of extras independently: current quote-calculation code indicates extras are entered ex-GST, whereas the quote grand total includes GST. Do not divide ex-GST extras by 1.15 again. Builder choice: conservative explicit matching patterns plus a small report-settings alias list for known variants; avoid treating every occurrence of “council” or a general consent charge as a council fee. Flag ambiguous council-related extras for review rather than silently guessing. Corrections belong in the source extra wording or alias settings; no report-specific financial overrides are proposed.

## Existing code and integration points

The original main checkout contains unrelated unfinished follow-up changes and is behind the fetched master for installation splits. All implementation must start from current master/live work, not that older checkout.

Inspected on fetched master:

- `src/lib/reports/sales-installs-server.ts`: paginated operational jobs, accepted-date hydration, persisted expiring report cache, projected split visits, upcoming statuses.
- `src/lib/installation-splits/model.ts`, `projection.ts`, `views.ts`: percentages, visit dates/states, proportional values/areas, usage reconciliation and remaining-work projections.
- `src/app/jobs/reports/page.tsx`: wall usage query and checksheet actual/budget handling.
- `src/lib/queries.ts`: job detail fields, wall/ceiling quoted bags and quote extras.
- Calendar placeholder APIs and `calendar_placeholders`: dated text entries. Read these directly through a shared server helper rather than browser self-fetching.
- `src/lib/overlay-db.ts`: existing PostgreSQL persistence/schema pattern.

Reuse pure source/projection helpers where suitable, with regression tests protecting existing reports. Do not use the existing ten-minute/day cache expiry as the weekly report lifecycle; a GM report is a durable business snapshot, not an expiring cache. Force refresh must fetch fresh source data, including acceptance-date corrections rather than indefinitely trusting an old positive accepted-date cache.

## Storage, saves and refresh

Proposed tables: versioned GM-report settings, and weekly GM reports keyed by organisation/report scope plus Monday date. Reports store draft/finalised status, immutable snapshot payload/version, settings snapshot, commentary fields, revision, refreshed/updated/finalised timestamps and actor IDs. Retain source job IDs and visit IDs, matched fee lines and usage basis in the payload so totals can be inspected without another upstream request.

Use existing authenticated internal CRM access and verify the source organisation scope before serving a shared report. Partner-portal accounts must not gain access to GM financial data. Do not equate the existing generic auth-valid check with permission to view financial reports. Builder must verify available roles/identity semantics and reuse an appropriate existing internal permission boundary; enforce it server-side on every endpoint. No user-role administration feature is added.

First opening a week creates one draft and builds its first snapshot; this initial source load may take longer and must show progress. Concurrent first opens create one report. Once saved, reads return the persisted report without fetching all jobs or recomputing totals. Week navigation can prefetch saved adjacent reports, but must not create unwanted drafts. Proposed performance acceptance: saved report data reads under 500 ms in a warm representative environment and usable cached week navigation under 1 second, measured rather than claimed as guaranteed instant. Cold starts, authentication and network latency can add delay.

Commentary autosaves after a short typing pause and on blur. Show Saving, Saved or Save failed. Keep unsent text in the active view, retry safely, and warn before navigating away when it is not saved. Separate commentary saves from snapshot refresh so a refresh cannot overwrite text. Use revisions/optimistic concurrency so two sessions do not silently overwrite each other.

Refresh builds a complete candidate snapshot, validates reconciliation, then atomically replaces the draft snapshot. Keep showing the previous successful version during refresh. If any required source request fails, retain the previous snapshot and timestamp and display the failure; never publish a partial successful-looking refresh. Deduplicate concurrent refreshes with bounded ownership/timeout recovery. Refresh cannot run on finalised reports, and a late refresh must not replace a finalised snapshot.

Finalise flushes pending commentary, checks the expected report revision and successful snapshot, and locks the report atomically. Prevent finalising while a refresh/save is in flight or unresolved numeric/usage errors exist. Confirmation explains that this cannot be reopened. Server enforcement must reject all later writes, including concurrent or retried saves/refreshes. Finalise is idempotent for repeated requests.

Historical report forecasts and pipeline describe what was known at their refresh time; reopening an old report does not show today's pipeline. Building a previously unrecorded historical week cannot reconstruct what its future schedule/pipeline looked like then. Display “Created retrospectively from current CRM data” prominently; its next-two-week sections use those historical date windows with current source records, and its pipeline is explicitly “Pipeline as at [actual refresh date]”, not portrayed as a historical fact. Existing recorded reports remain the authoritative point-in-time history.

## Scope boundaries and builder decisions

Included: report screen, settings, durable snapshots, autosaved commentary, week history/navigation, estimates/missing-data states, manual refresh, irreversible finalisation, new regression coverage.

Excluded: spreadsheet history migration, accounting reconciliation/Xero integration, actual payroll/opex imports, report exports/emails, background refresh, reopening finalised reports, changing installation scheduling or customer communications. This is an operational P&L based on quote values and the user's council-cost assumption, not statutory accounts.

Builder owns the exact table/endpoint names, component arrangement, debounce duration, refresh implementation, permission integration, conservative fee patterns and pagination/batching. Preserve all stated semantics, especially financial provenance, completion/forecast separation and immutable history. Unverified source field semantics must be settled through read-only schema/source inspection before building calculations; any material change to the agreed meaning returns to the user.

## Verification and release

Regression coverage must include NZ Monday/Sunday and daylight-saving boundaries; accepted-sale deduplication despite multiple visits; completed versus planned portions; unscheduled portions; combined pipeline at 80/400; recorded/actual-allocated/estimated usage; ceiling fallback and missing-data states; council wording and GST/no double-counting; split rounding reconciliation; fixed costs on empty weeks; zero/negative profit budgets; placeholders excluded from all totals; immutable settings/history; concurrent autosaves/refresh/finalise; failed-refresh preservation; organisation/role isolation; retrospective report labels; and existing calendar/Sales & Usage behaviour.

Database integration tests use disposable databases. Browser checks cover saved-week speed, mobile/desktop layout, editing commentary during refresh, navigation save failure and finalised read-only state. Extend the release route/capability contract and required test invocation for the new report/settings paths without removing existing protections.

Before implementation release work, inspect current production `/api/release` and current protected master and integrate all newer work. Follow `docs/production-release-process.md`: clean committed feature branch, PR against current master, `npm test`, `npm run test:finance`, production build and applicable browser checks; wait for required CRM regression suite before merge. Record the previous deployment, verify intended deployed SHA and affected authenticated screens using safe data, and report the actual deployment/verification state. Rollback preserves database history.

## Approval

User selected the manual-refresh snapshot approach. This document is the proposed detailed design; approval is still required before the implementation plan and application changes. In particular, the default-to-previous-week behaviour, ceiling estimate fallback, conservative fee aliases, access boundary, missing-data finalisation checks and retrospective labels are proposed builder decisions rather than answers explicitly supplied by the user.
