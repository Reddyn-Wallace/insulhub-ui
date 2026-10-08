# Cash dashboard connections — chunk 2 design

Scope: a working owner-only source connection screen, not the financial dashboard or matching engine. Builds on the approved `cash-dashboard-calculation-contract.md` and discovery in `cash-dashboard-connection-setup.md`.

## Flow

Add `/jobs/finance/connections` with Akahu, Xero and CRM connection states. The user signs in through existing Insulhub authentication. Server endpoints verify that token against canonical `me` before reading financial data or starting OAuth. Establish the owner's canonical user ID by matching the configured email to a server-returned identity; never trust the browser's stored profile or grant access based merely on role. If the API cannot return a verified email, require explicit provisioning of the canonical user ID from a verified source. Missing owner configuration denies access.

Akahu uses the confirmed Trading Account ID only. Fetch its balance and transactions server-side. Expose current balance, currency, balance timestamp, transaction timestamp and sanitised connection errors; available balance is not cash. Account credentials are never returned to the browser. Do not trigger automatic bank refresh on page load. Daily personal-app refresh and one-hour manual-refresh rest limits remain visible.

Xero uses an independent standard OAuth web-app connection. Request `offline_access accounting.invoices.read accounting.payments.read accounting.settings.read` and confirm endpoint coverage against current Xero documentation during implementation. Do not request write scopes. The callback is `https://insulhub-ui.vercel.app/api/finance/xero/callback`; use a configured origin, not a request-supplied host.

An authenticated owner POST starts authorisation. Generate random state, store only its hash with owner ID and ten-minute expiry, and bind it to an HttpOnly Secure SameSite=Lax cookie. Consume it atomically once at the callback before exchanging the code. Handle denied consent without retaining sensitive query parameters in the return URL. Validate provider responses and connected organisation; show the actual organisation to the owner and explicitly select/pin its tenant ID before invoice reads. Never silently use the first returned tenant.

Store encrypted OAuth tokens and expiry in a dedicated UI integration-credentials table in Neon, with its encryption key in server environment configuration. These are integration credentials, not canonical job or invoice records. Store no duplicate CRM business records. Serialise refresh using a database transaction/row lock; a single process-local lock is insufficient across deployments. Persist rotated tokens atomically. Never retry a stale refresh token blindly after an uncertain exchange outcome; require recovery/reconnection if necessary.

CRM remains the source for installation status and existing invoice links. Query it with the signed-in owner's token, with pagination. No background CRM credentials or user passwords are collected in this chunk.

## Boundaries and delivery

Use a managed isolated worktree because the current checkout contains unrelated edits. Do not include the credential handoff file in commits, test fixtures, build output or logs. Only add source credentials to the intended server deployment; previews must not inherit production finance access automatically.

All finance responses use no-store. Data access requires server-side owner checks; hiding navigation alone is insufficient. The OAuth callback uses the previously verified, expiring owner-bound state because provider redirects do not carry the CRM bearer header. Reject a callback if the configured owner no longer matches the state owner.

Deliver a connection screen with source timestamps, account/organisation identity, refresh/reconnect actions where supported, and an explicit incomplete status until each source is verified. It contains no deposit or receivables totals yet.

## Acceptance

Unauthenticated and non-owner requests cannot start OAuth or read finance data. Expired, mismatched and replayed OAuth state fail. Concurrent refresh does not overwrite a rotated token. Wrong tenant/account is rejected. Missing, stale, denied and malformed provider responses never become zero balances. Validate one bank snapshot, sampled Xero invoices/payments, and CRM job links against the source UI. Credentials being present is not proof they work.

Deployment of the callback precedes live Xero authorisation. The owner performs the Xero consent action after reviewing the organisation and read-only scopes. Owner identity provisioning, Xero token exchange and production deployment are not yet completed.
