# Cash dashboard — connection setup findings

27 September 2026. Preparation only; connections and owner identity are not yet verified.

## Existing infrastructure

- Next.js UI is linked locally to the Vercel project `insulhub-ui`.
- Canonical jobs, invoice links and installation statuses belong to the separate Insulhub GraphQL backend. Follow `BACKEND_BOUNDARIES_FOR_AGENTS.md`; do not duplicate canonical jobs or invoices into Neon as another system of record.
- The UI calls the backend to create final Xero invoices. No reusable Xero OAuth or invoice/payment retrieval implementation was found in the inspected UI code. This does not prove the separate backend cannot expose the needed reads.
- Local environment variable names were inspected without displaying values. No Akahu or Xero credentials were present in `.env.local`. Production environment credentials have not been inspected.
- Existing general authentication is not sufficient for owner-only finance access. Verify the caller's identity server-side and compare a configured canonical owner user ID. Browser-local profile data must not authorise access. Missing owner configuration must deny access.

## Credential handoff

An untracked, Git-ignored `.credentials/cash-dashboard.env` file is prepared with owner-only filesystem permissions on creation. It contains blank fields for Akahu App ID Token, User Access Token, main account nickname and owner login email. This is a local handoff file, not an implemented application configuration loader, encrypted vault or deployed secret store.

Once supplied, validate credentials without logging tokens or full account numbers. Select and pin the main Akahu account ID after checking its nickname; never silently aggregate all connected accounts. Move runtime secrets to server-only environment configuration for the chosen deployment, keeping preview and production access explicit. Do not use NEXT_PUBLIC variables.

## Akahu constraints

Personal apps support account information for one Akahu user, daily scheduled refreshes, a one-hour manual-refresh rest period and no webhooks. Re-fetching cached API data is not a fresh bank sync. Show separate balance and transaction refresh timestamps. A refresh action must respect provider limits and must not promise instant bank updates.

Source: https://developers.akahu.nz/me/docs/personal-apps (checked 27 September 2026).

## Xero connection decision

First determine whether the existing backend has supported, authenticated, read-only invoice and payment queries with sufficient fields and pagination. Existing invoice IDs alone do not establish this. Do not copy or share an existing rotating OAuth refresh token between independent services.

If the backend cannot supply the reads, use an independent read-only Xero OAuth connection pinned to Insulmax Insulation (Wellington and Wairarapa) Limited. Confirm current granular scopes before registering the app. Owner authorisation, callback configuration and protected refresh-token storage will be required. No Windcave connection is planned.

## Verification before chunk 2 can be called complete

1. Owner identity verified against Insulhub; another authenticated user and an unauthenticated request both denied.
2. Main account selected explicitly; balance and timestamp compared with the bank; posted and pending transaction handling distinguished.
3. Correct Xero organisation confirmed; sampled invoices, payments, credits and outstanding amounts compared with Xero; pagination checked.
4. CRM jobs sampled for installed status and deposit/final/additional invoice IDs, including incomplete links.
5. Missing credentials, disconnected sources and stale data return an explicit unavailable/stale state, never zero balances.

## Akahu verification update

The owner supplied Akahu credentials and a login email through the ignored local handoff file. Akahu account discovery succeeded. The owner explicitly confirmed `Trading Account`; its stable account ID is now pinned in that file. File permissions were verified/set to owner read/write only. No credentials or account IDs are recorded in this document.

The selected account reported ACTIVE, NZD, and a current balance of $11,993.17 at 2026-09-27T06:34:44.006Z (7:34 pm NZDT). Its available balance includes a $50,000 credit limit and must not be used as the cash headline. This is provider-reported data, not yet independently compared with internet banking.

A read-only September transaction request succeeded with 77 records and no next-page cursor. Transaction metadata is present; matching suitability has not yet been validated. No refresh, payment or bank mutation was requested. Other connected accounts are excluded from the selected dashboard scope.

Remaining: verify owner identity against the CRM, establish supported Xero read access, implement and test owner-only routes and source freshness/error handling. No production configuration was changed. Akahu credential validation is complete; chunk 2 as a whole is not complete.


## Xero discovery update

A read-only GraphQL validation request confirmed that `InvoiceSchema` does not expose fields named `amountDue` or `payments`. This rules out those field names only; it does not prove no other supported backend read path exists. The live signed-in CRM report is accessible in the browser, but server-verified owner identity remains outstanding.

The signed-in Xero developer account lists one app, Rezdy - Kapiti, unrelated to Insulhub. A new web-app registration form has been prepared (not submitted): name Insulhub Cash Dashboard; application URL https://insulhub-ui.vercel.app; planned redirect https://insulhub-ui.vercel.app/api/finance/xero/callback. The callback is not implemented yet. No AI model training is intended. Security-requirement agreement and developer terms are left for owner review. No app, credentials or new Xero data access has been created.
