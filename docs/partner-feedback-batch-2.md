# Partner feedback batch 2

## Agreed scope and acceptance

- One Quote section contains insulation, extras, comments and totals. No visible quote number/date, technical product summary, consent or deposit controls.
- Lead/quote edits autosave. No manual Save action. Saves are serialized, retain newer typing and flush before app navigation/sign-out. Invalid or failed saves retain recovery and prevent leaving; browser unload warns instead of claiming an asynchronous save succeeded.
- A durable company-scoped creation key binds the original request, so retrying a lost create response cannot create a second job. Recovery retains that request and raw interim money/email input.
- Submit is the only primary quote action, enabled only after the latest revision is saved. Existing confirmation, tenant, revision, idempotency and read-only guards remain.
- Floor plans live on the quote. The old list URL redirects back to that section. Cards show name and Draft/Complete with no PDF, counts or timestamps.
- Full-screen drawing reuses the InsulHub canvas, with more available space and zoom controls. Save as draft invalidates completion even if the drawing is unchanged. Save as complete saves the drawing then generates the current backend PDF; failure leaves it Draft. Re-completion replaces the active artifact.
- At least one floor, and every included floor complete, remain server requirements. Changes to the property address invalidate affected completion. Submitted jobs remain read-only.

## Review and verification

Critic plan review required durable create idempotency, raw recovery, all app exits, save-race coverage and edit/undo completion tests. No live credentials, live submissions, deployments or production schema claims are in scope. The real PostgreSQL gate remains required before production use.

### Completed review loop — 31 August 2026

- Critic findings addressed: durable request-bound creation replay, raw-money recovery, preservation of newer edits after ambiguous saves, conflict quarantine across reload, route-transition locking, post-flush logout locking, unchanged draft invalidation, completion revision pinning, and sticky edit/undo state.
- Final independent critic review: PASS, no P0–P2 findings. Independent regression runs: 72 tests for the main changes, then 12 tests for final saved-status/focus and zoom/pan fixes.
- Browser verification at 1280×720 and 390×844: fictional Northwind login; new quote autosave; immediate Back-to-dashboard flush and reopen; merged quote/extras/totals; embedded floor creation; original outline drawing; Save as draft; Complete; edit → Draft; re-complete; zoom and pan controls; incomplete-floor submission rejection; confirmed fictional submission; all submitted fields visible and disabled. No application console errors; mobile drawing has no document-level horizontal overflow.
- Browser-discovered polish: compact one-row saved-status/Submit bar, and readiness errors no longer misleadingly report unsaved changes. Explicit submission validation focuses the alert and links to Floor plans without autosave stealing typing focus.
- Final automated suite: 453 partner tests across 42 files, 6 shared site-plan tests, all communication assertion scripts and 5 Cloudflare tests passed. This includes create replay/concurrency/tenant isolation, autosave races/offline recovery, logout/navigation races, floor completion/publish races, immutable submission and zoom/pan geometry preservation.
- Production build with demo environment flags unset passed, including TypeScript and all partner routes. Targeted ESLint passed. Secret-pattern scan covered 200 changed/untracked text files with no high-confidence matches; tracked diff whitespace check passed. Full lint retains its inherited 3 CommonJS errors and 20 warnings outside the new portal work.
- Migration 009 introduces request-bound draft creation keys. Mock-database migration tests pass; the disposable real-PostgreSQL migration gate has not run because its connection URL is not configured. No production schema or live integration claim is made.
- No commit, push, deployment, real customer message or live legacy submission was performed. The local demo is left running for review; restarting it resets fictional records.
- After the final build/restart, the in-app browser policy blocked inspection of the existing tab. No bypass was attempted. The development server reported Ready; the earlier full browser flow passed before the restart. The user can reopen the local portal directly.
