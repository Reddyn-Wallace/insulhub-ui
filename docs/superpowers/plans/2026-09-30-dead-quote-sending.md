# Dead quote sending — implementation ledger

Scope: manual SMS/email composition and explicit send, exact saved NZD discount, provider-confirmed history, independent retryable job-note append. Dead quotes only. No production sends, migration or deployment.

- [x] Pure send validation/templates, conservative outcome and note rules with failing/passing tests.
- [x] Durable attempt reservation under shared control lock, immutable snapshots, idempotent reconciliation and note state.
- [x] Authenticated endpoints reusing existing owned sender delivery; current canonical status/version checks; UI composition and recovery.
- [x] Real database concurrency tests, full regressions, browser verification and independent review. Ready for local commit.

Ruling: a provider accepted/unknown SMS is not a successful approach. Only saved sent/delivered status counts. Unknown attempts block new sends; refresh/status check never dispatches another message.
Ruling: a claimed attempt is dispatched at most once. A crash before dispatch is conservatively unknown and requires investigation, not automatic resend.
Ruling: canonical notes expose replacement only, no atomic append/CAS. Fresh read, stable attempt marker and read-after-write make normal retries idempotent, but cannot eliminate simultaneous old-CRM edit races. Document this production limitation; do not invent an API.
Ruling: no claimed sender proof is accepted from the browser; read existing CRM message records. Provider timestamps absent: use time success is first observed (conservative second-follow-up timing).
Ruling: confirmed provider offers cannot be removed with historical-entry correction. Note failures never roll back sent history.

Independent review: safe contact rejection (409 safeToEdit) could leave a never-dispatched attempt unknown. Reproduced with a failing route regression, then fixed to release only when the durable message is absent. A saved provider outcome always wins. Existing database test proves definitive failure allows a fresh explicit attempt.
Self-review: unresolved attempts were absent from Needs review filter; reproduced and fixed. Note persistence now releases its advisory-lock connection before requesting another connection, avoiding pool starvation. Recovery is reachable from job Notes after a quote leaves Dead.

Final verification: full npm test passed (897 Vitest tests, including 128 follow-up tests and eight real PostgreSQL tests, plus communication script checks). Production build, TypeScript, targeted ESLint and diff whitespace checks passed. All three browser smoke scripts passed at 390px and 1280px; sending script covered SMS and email, edited content, explicit confirmation, lost response, exactly one dispatch, independent note retry and recovery after leaving Dead. Screenshots inspected. Browser selector corrected to use accessible textbox role and actual input value rather than label text. No production migration, enablement, deployment or customer messages.
