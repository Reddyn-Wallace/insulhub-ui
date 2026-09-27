# Finance connection deployment and verification

## Server configuration

Required server-only variables:

- `FINANCE_OWNER_EMAIL`: the owner's CRM email, verified server-side through canonical `me`.
- `FINANCE_OWNER_USER_ID`: canonical ID obtained from the email-verified identity screen. Until pinned, all financial reads and Xero authorisation are denied.
- `FINANCE_APP_ORIGIN`: the chosen HTTPS deployment origin. For the registered production app: `https://insulhub-ui.vercel.app`.
- `AKAHU_APP_TOKEN`, `AKAHU_USER_TOKEN`, `AKAHU_ACCOUNT_ID`: the confirmed Trading Account only.
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`.
- `FINANCE_DATABASE_URL`: a **direct**, not transaction-pooled, PostgreSQL connection. Required because refresh uses a session advisory lock. Neon `-pooler` endpoints are rejected.
- `FINANCE_ENCRYPTION_KEY`: base64 encoding of 32 random bytes. Preserve it across deployments; changing it without re-encryption requires Xero reconnection.

Provision `scripts/finance-connections-schema.sql` deliberately on the intended database. No request runs migrations. The tables contain encrypted integration credentials and one-time OAuth state only. Do not duplicate canonical jobs or invoices into these tables.

The local `.credentials/cash-dashboard.env` handoff is not an application loader. Transfer approved settings into the chosen server environment; do not include this file in deployments, build output or Git. Do not populate unrelated preview branches with production finance credentials.

## Sequence

1. Deploy the connection screen and callback. Confirm unauthenticated finance endpoints return 401 (or 503 when owner provisioning is absent), never data.
2. Configure the owner's email. The signed-in owner visits `/jobs/finance/connections`; it shows their server-verified canonical ID without financial data. Pin that ID in the server configuration.
3. Provision connection tables and credentials in the intended environment. Verify a second CRM identity receives 403. If a second identity is unavailable, record that live test as outstanding; unit tests are not a live second-user check.
4. Owner starts Xero authorisation and reviews the requested read-only scopes. Choose Insulmax Insulation (Wellington and Wairarapa) Limited, then explicitly select it on the connection screen.
5. Compare the timestamped bank balance and a sample of Xero invoices/payments and CRM job links with their source UIs. Source cards report connection health, not completed financial reconciliation.

## Tests

- `npx vitest run src/lib/finance` runs non-database checks; integration tests explicitly skip without the test URL.
- `FINANCE_TEST_DATABASE_URL=postgresql://127.0.0.1:<port>/<disposable-db> npx vitest run src/lib/finance` also exercises single-use state and concurrent/crash-safe refresh against real local PostgreSQL. This test URL must be a disposable local database; never point it at live data.
- `npx tsc --noEmit`, targeted ESLint and `npm run build -- --webpack` verify compilation.
- `npm test` runs the existing project suite.

## Current evidence

34 finance tests pass, including real PostgreSQL concurrency, interruption recovery and stale tenant-selection rejection. Existing project suite passed. Typecheck and targeted lint passed. Production build passed before final review fixes; rerun final build before publication. Local browser verified meaningful connection content and sign-in-required state, with no financial data exposed. Live owner identity, Xero consent, deployment secret configuration and cross-source comparison remain outstanding.

Review rulings: require a direct finance database URL rather than reuse the existing possibly pooled overlay URL. Bind tenant selection to a credential generation. Mark missing CRM links/statuses incomplete. Exclude finance API/page routes from service-worker runtime caching. No finances are calculated yet; that belongs to the subsequent approved chunks.
