# Partner management in InsulHub Settings

## Agreed scope

Replace the separate staff-facing partner operations surface with **InsulHub → Settings → Partners**. The user explicitly approved management access for **any authenticated normal InsulHub user**. Partner-portal authentication alone must not grant management access. No second staff login or new staff role selection.

This batch is company/user management and UI simplification. It does not claim completed live job delivery, normal-job commission/checklist integration, recovery/resend controls or live credential onboarding.

## Acceptance criteria and outcome

- Normal Settings contains Partners alongside its existing sections; communications data loads only when its section is selected. Passed.
- Add/edit company shows only company name and fixed company billing model. Slug is generated and stable; no price/rate, deposit, consent or extras controls. Passed.
- New/updated companies use existing product pricing defaults with zero deposit and consent; these hidden settings cannot be supplied through the new API. Passed.
- Users are created beneath the selected company with name, email and initial password. Disabling a partner user revokes their portal sessions. No internal-user promotion/disable through this API. Passed.
- Any server-verified normal InsulHub token grants company/user management. Partner/operations cookies and client-supplied roles/identity alone do not. Passed.
- Mutations validate configured host and exact allowed Origin, bounded JSON fields and revisions. Pending/lost-response company saves cannot be abandoned to create duplicate records. Passed.
- Old operations home, companies, job and login pages redirect to normal Settings; no operations navigation, duplicate invoice/commission forms or separate login is displayed. Passed.
- Existing internal job/finance API authorization remains unchanged; the new token gateway cannot invoke those operations. Passed.
- No legacy company secret, login token, password or password hash is returned in management responses. Passed.
- Desktop and mobile layouts are usable without horizontal page overflow. Passed at 1280px desktop and 390px mobile; mobile scroll width equals viewport width.

## Security implementation notes

The normal token is verified using the existing fixed InsulHub GraphQL endpoint. Verification now requires the expected users-results structure, rejects malformed success responses, refuses redirects and uses an eight-second timeout. Existing successful-token verification is cached for up to five minutes; revocation in InsulHub can therefore take that long to affect this gateway.

The dedicated Settings gateway resolves Next's internal request URL only through a server-configured origin matching Host. Forwarded Host must agree. It does not accept arbitrary forwarded origins or use the caller's Origin as configuration. This handles Next's localhost/127.0.0.1 development routing without weakening the older operations routes.

Migration 010 adds a reserved, non-login service identity for database authorization and audit FKs. No account or session is provisioned for it. Migration reuse rejects identity, account or session collisions; portal auth explicitly rejects this identity in session creation and principal derivation. Rollback disables the identity and preserves its audit references. Audit entries identify the Settings service, **not the individual InsulHub staff member**: the available token-verification seam does not establish a trustworthy individual ID.

The restricted function-only operations database connection is retained behind the Settings gateway. Retiring the separate operations UI does not remove its data or broaden existing job/finance endpoint permissions.

## Verification

- Full `npm test`: partner 502/502; site plan 6/6; communications scripts passed; Cloudflare 5/5.
- New route tests compose the real normal-token verifier (mock upstream response) with the real company/user repository and isolated pg-mem database. Coverage includes absent/invalid/cookie-only auth, malformed upstream successes, cache expiry, Origin/Host, exact payload allowlists, default pricing, conflict/replay, hashing, tenant binding, revocation and reserved actor denial.
- Frontend tests cover normal Settings navigation, isolated section loading, normal-login expiry link, recovery, minimal fields, users, pending/unknown save locks and retirement redirects.
- Independent critic: PASS, no P0–P2 findings; independently ran 78 tests across five suites before final presentational cleanup.
- In-app Browser: existing normal InsulHub sign-in → Settings → create fictional company → create fictional user → disable user; old operations URL redirect; desktop/mobile visual review. No production company, job, quote or payment was created.
- TypeScript and targeted lint passed. Full lint remains the inherited three CommonJS errors and 20 warnings in unrelated files.
- Production build passed with demo mode unset. Final focused UI/route retest: 34/34 passed. Diff checks passed.
- Disposable PostgreSQL gate includes the new service collision/rollback/reapply probes and migration order. It remains **NOT RUN**: `PARTNER_MIGRATION_TEST_DATABASE_URL` is unavailable. pg-mem coverage is not evidence that PostgreSQL-only permissions/PLpgSQL pass on Neon.

## Deployment / follow-up boundaries

Local Settings can use the user's normal InsulHub sign-in against explicitly enabled fictional demo storage. Restarting this demo resets fictional data. Production needs the existing restricted database/auth configuration, migration 010 and a passing dedicated PostgreSQL gate. Linked company credentials and live transfer setup remain separate unfinished launch work. No deployment, commit or push was performed in this batch.
