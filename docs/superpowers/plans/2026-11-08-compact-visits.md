# Compact installation visits implementation plan

> Execute inline using superpowers:executing-plans, followed by a fresh review.

**Goal:** Implement the compact split editor, preserve planning controls, integrate remaining visits into the Jobs queue, and patch the calendar after saves.
**Architecture:** Keep upstream jobs unchanged; persist an atomically validated visit list in the existing overlay. Seed calendar editors from the calendar response, return saved visits to the parent, and project queue/calendar from the same model.
**Tech Stack:** Next.js, React, TypeScript, PostgreSQL overlay, Vitest, Playwright.
**Spec:** User-approved design in this conversation, recorded below.

## Approved design and constraints
Ordinary jobs show only Split job. Split jobs show compact date/percentage/status rows and Edit visits. Edit dates and shares, add/remove visits, require a 100% total. Planned dates optional, completed dates required. Preserve manually recorded usage and audit data; no usage/history/undo sections in scheduling UI. Preserve notes, scope, booking status. No separate unscheduled calendar section. Queue shows remaining visits including undated ones, even when the legacy parent is complete. Server-confirmed saves patch cards immediately without whole-calendar fetch. Keep original backend untouched by split operations. No deployment in this task.

## Review focus
- Stale reads must not overwrite a newly saved split.
- Removing visits must not silently lose individually recorded bag usage.
- Planning saves must not replace all visit dates with the parent date.
- Completed parent jobs with remaining work must enter the queue.
- Scheduling multiple visits must not count the original full quote again.

## Task 1: Atomic visit-list editing
- [x] Add failing model/routes tests for 3 visits, total/date/state/id validation, manual usage preservation, single-visit reset, stale version.
- [x] Implement editVisits in model and action edit in server, keeping snapshots and audit.
- [x] Run split model/routes tests.

## Task 2: Compact editor and calendar
- [x] Add failing UI tests for collapsed default, seeded immediate summary, editable rows and validation, clear dates, failed save.
- [x] Replace InstallationVisits with compact summary/editor. Keep historical reason inside editor only.
- [x] Include source/split data in calendar response. Restore planning controls but hide legacy date field for split jobs. Patch job projections after save and guard stale reads.
- [x] Extend browser checks for unchanged planning controls and save without calendar refetch.

## Task 3: Main queue and verification
- [x] Add projection tests for remaining visits, completed parents, unscheduled allocation and no duplication.
- [x] Apply split projections to Jobs queue, label visits and link to compact manager.
- [x] Remove calendar unscheduled section; invalidate queue cache on save.
- [x] Extend release contract/docs; run targeted regression suite, build, mobile/desktop browser checks.
- [x] Fresh review, fix findings, commit changes.


## Verification and review
64 targeted tests passed, including the disposable PostgreSQL integration tests. Desktop (1440 px) and mobile (390 px) browser checks passed using intercepted fixtures: no customer records were changed. These cover instant calendar updates without a refetch, normal planning controls, three visits, unscheduled queue/search and scheduling from that queue. Production build and 13 release-guard tests passed; built-route contract passed.

Fresh review found and resolved search dropping split data and stale source dates after ordinary planning moves. Regression tests cover both. Standalone TypeScript still reports existing errors in unrelated dead-followup tests; no changed-file errors. ESLint has no errors (8 existing warnings in Jobs/JobCard). Work is local-only on codex/installation-splits, with no production deployment.
