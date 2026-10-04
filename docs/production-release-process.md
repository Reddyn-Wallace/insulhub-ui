# Production release process

Production project: `insulhub-ui` in `reddyn-wallaces-projects`.
Production URL: https://insulhub-ui.vercel.app

## Required release checks

1. Inspect the current production deployment and identify its source before assembling a release. Never assume the main checkout or GitHub master matches production. Preserve all already-live work, including finance.
2. Assemble changes in an isolated release checkout; keep unrelated unfinished work out. Review the exact diff and commit all deployable source. Never deploy a dirty checkout.
3. Run `npm test`, `npm run test:finance`, `npm run build`, and applicable browser checks. Finance database integration tests additionally need `FINANCE_TEST_DATABASE_URL` pointing at a disposable test database; never point it at production.
4. Push the exact release commit to GitHub before deploying. Use the linked Vercel project and production environment. Record the previous deployment URL for rollback.
5. Inspect the production alias after deployment. Confirm READY and the intended release. Check affected screens in the live authenticated app; do not send customer communications or alter business records merely to smoke-test.
6. Report one of: local only, preview deployed, production deployed (verification incomplete), or production deployed and verified. Record any failed or unavailable check explicitly.

## Parallel work

Before any production deployment, inspect the current live deployment again. If another chat has shipped newer work, integrate it before releasing; do not replace it with an older branch. Worktree branches are not independent production apps: deploying any one of them replaces the entire site.

## Rollback

Use Vercel rollback to the recorded previous deployment if the new release breaks live behaviour. Do not remove data or reverse database changes automatically.
