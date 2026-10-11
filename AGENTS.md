# Production release safety

Read `docs/production-release-process.md` before any production release.

- Normal production releases must use protected Git `master`. Do not use direct Vercel CLI/API source uploads, deploy hooks, manual aliases, or force promotion to bypass this.
- Work on a branch, open a pull request, wait for `CRM regression suite`, then merge. Required checks and Vercel's production source/ancestry checks must pass.
- Always integrate all current master/live work. Never deploy an older worktree as a replacement for the combined CRM.
- Add regression coverage and extend `scripts/release/contract.json` when shipping a new feature. Do not remove required routes, tests, or protection settings merely to obtain a green build.
- Do not disable protection, force-push master, or bypass failed checks unless the user explicitly requests that exceptional action after being told what it bypasses.
- Owner-directed emergency rollback is distinct from a normal release. Preserve database history; never reverse schema/data changes automatically.
