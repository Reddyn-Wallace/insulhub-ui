# Partner feedback batch 3

## Acceptance criteria

- Floor-plan Save as draft returns to the quote's floor section only after the drawing save succeeds. Save as complete waits for a current generated PDF before returning. Controls remain locked through navigation; failures stay in the editor with recovery intact.
- Floor cards contain Open/View and Delete where permitted, not Move up/down or routine Refresh. Existing automatic mount/focus updates remain. Retry is available only when a request fails.
- Completed floors on draft jobs can be deleted. Tenant, collection revision and submitted-job protections remain. Failed deletion preserves drawing, PDF bytes and collection state; remaining floors retain their order.
- Submitted-job pages show the same lead, quote and floor details read-only, without the requested tracking, financial, amendments and submission-status panels. Dashboard milestones and internal operations are unchanged. Demo background handoff still runs without visible panels.
- Remove the autosave explanatory sentence and numbered section navigation. Autosave, field validation, recovery and error links remain functional.

## Diagnosis and review

An added regression reproduced the exact completed-floor deletion foreign-key error in the local demo: artifact deletion ran before clearing the drawing's current-artifact reference. It also removed the in-memory bytes before database success. The fix clears the reference, removes artifacts/drawing under the existing atomic demo snapshot lock, and removes bytes only after successful commit. The production privileged deletion function and schema are unchanged.

Critic plan review approved the scope with rollback, successful-save navigation locking, error-only Retry and hidden submission-processing safeguards. Final independent implementation review: PASS, no P0–P2 findings. The critic independently passed 69 tests across seven suites.

## Verification — 31 August 2026

- Full test command passed: 461 partner tests across 43 files, 6 shared site-plan tests, all communication assertion scripts and 5 Cloudflare tests.
- Added an exact failing regression before the delete fix. It now passes, alongside stale/other-company/submitted denial and injected late-failure rollback (drawing, artifact, bytes, collection revision unchanged).
- UI tests cover successful draft/complete exit, waiting for generation, lock during navigation, retained recovery on save failure, removed floor controls, error-only Retry, removed quote navigation/copy, and headless demo processing under StrictMode without production demo calls.
- In-app browser, desktop 1280×720 and mobile 390×844: inspected a seeded submitted job with read-only details and none of the removed panels; created a separate fictional quote; saved a blank floor as Draft and returned; drew a wall, saved Complete and returned; verified the Complete card had only Open/Delete; deleted that completed floor successfully and saw the empty list. No browser application warnings or errors. Only the disposable test floor was deleted, not a pre-existing user floor; deletion itself has no undo.
- Production build with demo flags unset passed, including TypeScript and all partner routes. TypeScript and targeted ESLint passed. Whitespace diff check passed; high-confidence secret scan covered 202 changed/untracked text files with no findings. Full lint retains exactly the inherited 3 CommonJS errors and 20 warnings outside this batch.
- The Next.js/React checks preserved the server/client boundary and kept processing effects independent from the removed presentation. The production deletion function and schema were not changed.
- After the final build, the demo server restarted successfully. The browser tool could not navigate its stale connection-error page because that internal page is policy-blocked; no bypass was attempted. All browser flow evidence above was collected before the restart. Reopen the portal URL directly for the reset demo.

No live credentials, live submissions, production migration, commit or deployment are part of this batch. The pre-existing real PostgreSQL release gate remains outstanding.
