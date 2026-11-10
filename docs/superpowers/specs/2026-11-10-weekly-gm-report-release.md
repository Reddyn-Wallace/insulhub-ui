# Weekly GM report release record

Prepared 10 November 2026 (NZ). This records the pre-release verification; the deployed result is verified separately after the protected merge.

## Source and rollback

- Baseline master and live release: `f285c6a19be94681feb93ad5b23cff385a6e575f`.
- Previous production deployment: `dpl_6wwTske57AbqVRQEUd9cWkHZCXhJ`.
- Previous immutable URL: https://insulhub-a991c54lf-reddyn-wallaces-projects.vercel.app.
- Release branch: `codex/weekly-gm-report-design`. Normal release is a protected PR merge into current master; no CLI source upload or manual promotion.
- Additive `gm-report:migrate` runs after production source/ancestry checks. Rollback must preserve the new report tables and all database history.

## Verification

- Full CRM test command run with disposable PostgreSQL integration coverage.
- Finance suite: 160 tests passed against a disposable local database.
- GM calculations, API, access, PostgreSQL lifecycle, source and UI tests cover split actual/estimated bags, missing component area, GST/council extras, sale deduplication, manual refresh, concurrent commentary, immutable finalisation and local draft recovery.
- Production build and shipped-route inventory passed (36 required routes).
- Independent whole-branch review completed; material findings fixed with failing-then-passing regressions.
- Desktop/mobile browser fixtures exercise autosave, refresh, Back/Forward recovery after failed saves, settings, finalisation and saved-week navigation. All requests use fictional jobs and simulated writes.
- Existing follow-up, communication and split-install browser regressions passed locally without customer sends.
- Production deployment must still pass the required CRM regression suite against the current base, then verify the merged live SHA and authenticated affected pages.

## Operating notes

- Start with Reports → Weekly GM report → Report settings. Enter actual bag costs, all-inclusive wages, opex and the two targets; no invented financial defaults are seeded.
- Quotes supply revenue, excluding GST. Council extras remain in revenue once and are also treated as council cost under the agreed business assumption.
- Ceiling bags use the quoted estimate wherever no ceiling actual source exists. Whole-job actual bags allocated to visits are labelled allocated estimates; explicit visit records take precedence.
- Saved snapshots are durable. Finalised reports cannot be reopened. Source changes and later completed-job reconciliations do not rewrite locked weeks.
- Management access uses server-verified upstream ADMIN identities or explicitly configured GM actor IDs; partner cookies do not authenticate this API. This preserves the existing single-CRM deployment boundary rather than adding a multi-organisation permission model.
- Two minor limitations remain: the immediately preceding week uses the normal weekly-reporting grace period before retrospective warnings start; another session's draft/finalised status may remain cached until refresh/reload, while server revision checks and locks remain authoritative.
