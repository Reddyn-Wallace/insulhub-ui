# Weekly GM Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship the approved weekly GM report with saved data, commentary, settings and finalisation.
**Architecture:** Pure calculations project existing CRM jobs and split visits into a durable weekly snapshot. Authenticated API operations use PostgreSQL compare-and-swap and independent commentary writes; client pages render saved snapshots.
**Tech Stack:** Next.js, React, TypeScript, PostgreSQL, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-10-weekly-gm-report-design.md

## Global Constraints
- Monday–Sunday, Pacific/Auckland; NZD excluding GST.
- 80 m²/day, 5 days/week; placeholders contribute no figures.
- Saved drafts refresh explicitly; finalised snapshots cannot change.
- Preserve existing routes and release protections; release only through protected master.

## Review Focus
- Concurrent edits and finalisation must not lose commentary or replace locked data.
- Missing/zero bags and mixed wall/ceiling jobs must not silently overstate profit.
- Old weeks must not pretend current pipeline is historical knowledge.
- A quote with multiple visits must count once in accepted sales.
- Users without internal management permission must not read shared financial snapshots.

### Task 1: Calculations and validated settings
Files: src/lib/gm-report/{types,model,model.test}.ts.
Interfaces: buildSnapshot(week, jobs, splits, placeholders, settings, now): Snapshot; parseSettings(input): Settings; weekKey(date): string.
- [ ] Write model.test.ts covering NZ boundaries, split allocation/reconciliation, GST/extras, ceiling estimates, placeholders, pipeline, forecasts, sale deduplication and zero/negative budgets.
- [ ] Run npx vitest run src/lib/gm-report/model.test.ts; expect missing-module failure.
- [ ] Implement typed pure model and validation, reusing installation-splits functions; inspect source semantics before choosing fields.
- [ ] Run the model tests; expect pass. Commit calculations.

### Task 2: Persistence, source loading and protected API
Files: scripts/gm-report-{schema.sql,migrate.mjs}; src/lib/gm-report/{store,source,access,api}.ts and corresponding tests; src/app/api/gm-reports/{route.ts,settings/route.ts,[week]/route.ts}; package/build/CI scripts.
Interfaces: Report contains week, revision, status, commentary, snapshot, updatedAt, finalisedAt. Store supplies get/list/create/update/refresh/finalise operations with expected revision and actor. Source returns jobs and saved splits; API verifies upstream me identity and internal ADMIN management role (or explicitly configured GM actor IDs), not partner cookies.
- [ ] Write failing access/API/store integration tests for finalise immutability, revision races, independent commentary, incomplete snapshot rejection, failed-refresh retention and permissions.
- [ ] Run npx vitest run src/lib/gm-report; expect failures for missing interfaces.
- [ ] Implement additive schema/migration, upstream read-only paginated loader, bounded refresh leases, revision checks and no-store API. Resolve roles from existing ADMIN convention; permit explicit GM actor IDs via configuration without widening access to sales/partners.
- [ ] Run tests against disposable PostgreSQL, expect pass; commit persistence and API.

### Task 3: Report and settings pages
Files: src/app/jobs/reports/weekly-gm/{page.tsx,settings/page.tsx}; src/components/gm-report/*; src/lib/gm-report/client.ts; src/app/jobs/layout.tsx; src/lib/gm-report/ui.test.tsx; scripts/gm-report-browser-smoke.cjs.
Interfaces: client request<T>(path, method, body): Promise<T>; pages consume API Report/Settings directly.
- [ ] Write failing UI tests for sections, autosave, refresh preserving typed comments, save failure/navigation, finalisation, estimated costs and settings entry.
- [ ] Run UI tests; expect missing-component failure.
- [ ] Build responsive report, dated schedules, lead bars, P&Ls, commentary, history/URL navigation, refresh, finalise confirmation and accessible settings. Fetch only saved report on load; first build is explicit API POST after GET miss. Prefetch adjacent existing weeks without creating them.
- [ ] Run UI tests and desktop/mobile browser checks with fictional data; expect all sections/actions, no horizontal overflow, saved navigation below 1 second. Commit UI.

### Task 4: Review and protected release
Files: scripts/release/contract.json; docs/superpowers/specs/2026-11-10-weekly-gm-report-release.md.
- [ ] Extend route/test contract and required CI with GM tests and browser smoke.
- [ ] Run npm test, npm run test:finance, npm run build, release checks and browser smoke using disposable databases. Expect all pass; report environmental limitations honestly.
- [ ] Obtain fresh independent whole-branch review, fix material findings with regression tests, commit exact reviewed changes.
- [ ] Recheck live commit and master ancestry, record previous deployment, push branch and open PR. Wait for CRM regression suite on current base, then merge normally.
- [ ] Observe production Git deployment, verify /api/release matches intended merged SHA and affected authenticated read-only flows. Do not write business records for live smoke tests.
