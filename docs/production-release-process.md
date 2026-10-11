# Production release process

Production project: `insulhub-ui` in `reddyn-wallaces-projects`.
Production URL: https://insulhub-ui.vercel.app

## Required release checks

1. Inspect the current production deployment and identify its source before assembling a release. Never assume the main checkout or GitHub master matches production. Preserve all already-live work, including finance.
2. Assemble changes in an isolated release checkout; keep unrelated unfinished work out. Review the exact diff and commit all deployable source. Never deploy a dirty checkout.
3. Run `npm test`, `npm run test:finance`, `npm run build`, and applicable browser checks. Finance database integration tests additionally need `FINANCE_TEST_DATABASE_URL` pointing at a disposable test database; never point it at production.
4. Push the exact release commit to GitHub before deploying. Integrate the combined release into `master` before promoting it, so the next release starts with every live feature. A feature branch deployed alone is not an integration strategy. Use the linked Vercel project and production environment. Record the previous deployment URL for rollback.
5. Inspect the production alias after deployment. Confirm READY and the intended release. Check affected screens in the live authenticated app; do not send customer communications or alter business records merely to smoke-test.
6. Report one of: local only, preview deployed, production deployed (verification incomplete), or production deployed and verified. Record any failed or unavailable check explicitly.

## Parallel work

Before any production deployment, inspect the current live deployment again. If another chat has shipped newer work, integrate it before releasing; do not replace it with an older branch. Worktree branches are not independent production apps: deploying any one of them replaces the entire site.

## Rollback

Use Vercel rollback to the recorded previous deployment if the new release breaks live behaviour. Do not remove data or reverse database changes automatically.

## 11 October 2026 recovery

The production deployment `dpl_xaBjTHWBEy97enWyKQxw3QSdFvHj` was built from dirty `86fefae` and omitted the previously deployed follow-up branch `1c8e21c`. The missing functionality was a source-release regression, not evidence of deleted business data.

Recovery baseline `f0a42e2` preserves the production source, verified against Vercel's SHA-1 file manifest, including uncommitted campaign audience, retry and SMS queue changes. Release merge `efbf2c9` combines that baseline with the full follow-up branch and finance refresh improvements. Both campaign and follow-up test suites are required by `npm test`.

When production metadata reports a dirty checkout, inspect the deployed file manifest. Do not infer its contents from its commit SHA. Reconcile missing source into a committed baseline before merging another branch. Generated build output is not application source.

## Enforced release gates

Normal production releases come from the connected GitHub repository's protected `master` branch. Local CLI/API uploads are blocked by the project's production Deployment Sources policy. Preview deployments remain available.

1. Open a pull request against current `master`. The required `CRM regression suite` runs on GitHub with a disposable PostgreSQL service, no production credentials, the CRM/finance tests, a production build, a shipped-route inventory, and mobile/desktop follow-up and communication browser tests. Deleted required suites fail explicitly.
2. Merge only when the check passes against the current base. Master rejects force pushes and deletion, and the check applies to admins too. The same check runs on the merged commit, which Vercel requires before assigning the production domain.
3. Production builds verify the canonical GitHub repository, branch, current master SHA and ancestry of the live `/api/release` SHA before migrations. A stale/diverged release or failed verification stops the build. Local uploaded source is not accepted as release provenance.
4. After compilation, `release:check-build` checks the actual Next route manifest against `scripts/release/contract.json`. Extend the contract and behavioural tests when adding capabilities. Intentional route replacements require reviewing/updating the contract, not silently deleting it.
5. Verify the live release SHA and affected screens after release. Do not send customer messages as test traffic.

`/api/release` exposes only the Git commit, with no-store caching. The initial recovery release predates this endpoint, so a 404 uses the pinned recovery commit `15671bd4b96ce162eadfc9a6d90520e508c425ca`; malformed responses, other HTTP errors and unavailable services fail closed. The route itself is mandatory in subsequent builds.

These gates prevent the stale-branch/dirty-upload incident and catch covered regressions. They are not proof that every possible behaviour works. Vercel owners can still deliberately Force Promote or change policies, and administrators can alter branch protection. Such actions are emergency exceptions requiring explicit user direction. Normal releases must never use them. Previously built historical deployments must not be manually promoted as new releases.

If GitHub or the live provenance endpoint is unavailable, retry when available; do not remove the guard. No production credentials need to be added to GitHub Actions.
