# Finance Connections Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Connect and verify Akahu, Xero and CRM through an owner-only Insulhub screen.

**Architecture:** Next.js server routes verify canonical Insulhub identity. Akahu and Xero access stays server-side; Neon stores only connection credentials and OAuth state, not copies of canonical business records.

**Tech Stack:** Existing Next.js, TypeScript, Node crypto, PostgreSQL and Vitest; native fetch, no new OAuth framework.

**Spec:** `docs/cash-dashboard-connections-design.md`; financial definitions in `docs/cash-dashboard-calculation-contract.md`.

## Global constraints

- Owner only; main Trading Account only; no Windcave integration.
- No write scopes or bookkeeping mutations.
- No secret values in logs, fixtures, client responses or Git.
- Use configured origin and account/tenant IDs, never first-item selection.
- Preserve unrelated working changes in the current checkout.

## Review focus

- A different valid CRM user must be denied at every finance route (task 1).
- A delayed provider callback must fail after expiry or owner change (task 2).
- Concurrent requests must not corrupt rotated refresh tokens (task 2).
- Overdraft availability and stale balances must not masquerade as current cash (task 3).
- Missing invoice links or pagination failures must not produce a complete-looking source result (task 3).

## Task 1: Verified owner access

Files: create `src/lib/finance/access.ts`, `src/lib/finance/access.test.ts`, and `src/app/api/finance/identity/route.ts`.

Interface: `requireFinanceOwner(request: NextRequest): Promise<{ userId: string; token: string }>`; throws typed access/configuration errors for route-level sanitisation. Server-verified canonical ID must match `FINANCE_OWNER_USER_ID`.

- [ ] Create/reuse an isolated managed worktree; bring only approved finance documents into it.
- [ ] Test missing token, invalid token, non-owner, missing owner configuration and successful canonical owner verification. Assert upstream failure is unavailable, not anonymous success.
- [ ] Run targeted tests and confirm they fail before implementation.
- [ ] Implement canonical `me` verification using existing auth conventions; resolve email-to-ID provisioning from a server-verified identity, never localStorage.
- [ ] Run targeted tests; commit only the task's files.

## Task 2: Xero authorisation and protected token storage

Files: create `src/lib/finance/xero-oauth.ts`, `src/lib/finance/connection-store.ts`, corresponding `.test.ts` files, `scripts/finance-connections-schema.sql`, and routes under `src/app/api/finance/xero/{connect,callback,organisation}/route.ts`.

Interfaces: `startXeroConnection(ownerId: string): Promise<{ state: string; url: string }>`; `finishXeroConnection(code: string, state: string, cookie: string): Promise<void>`; `withXeroAccess<T>(ownerId: string, operation: (accessToken: string, tenantId: string) => Promise<T>): Promise<T>`.

- [ ] Test state expiry/replay/browser mismatch, consent denial, changed owner, malformed token response and tenant selection required before data reads.
- [ ] Test encrypted storage roundtrip/tamper rejection and concurrent refresh with a real disposable PostgreSQL transaction test. Assert one refresh and atomic rotated-token persistence.
- [ ] Run tests and confirm failure before implementation.
- [ ] Implement ten-minute, single-use owner-bound state and secure callback cookie; enforce configured callback origin and read-only scopes from the spec.
- [ ] Implement dedicated integration credential/state schema, authenticated encryption and transaction-locked refresh; pin tenant only after owner selection. Keep secrets out of error messages.
- [ ] Run tests, including rollback and provider failure cases; commit only task files.

## Task 3: Source adapters and connection screen

Files: create `src/lib/finance/akahu.ts`, `src/lib/finance/sources.ts`, associated `.test.ts` files, `src/app/api/finance/sources/route.ts`, and `src/app/jobs/finance/connections/page.tsx` with a UI test.

Interfaces: `getBankSnapshot(): Promise<{ accountName: string; currentCents: number; currency: string; balanceUpdatedAt: string; transactionsUpdatedAt: string | null }>`; `getSourceStatus(owner: {userId: string; token: string}): Promise<FinanceSourceStatus>` with per-source connected/unavailable/stale states and timestamps. Define `FinanceSourceStatus` in `sources.ts` before implementing consumers.

- [ ] Test pinned-account rejection, current-versus-available balance, non-NZD/invalid amounts, missing timestamps, provider errors and complete pagination.
- [ ] Test CRM missing links as explicit exceptions and Xero invoices/payments against expected normalised fields without computing chunk 4 totals.
- [ ] Test UI unauthorised states, no-store responses and no secret exposure; confirm failures before implementation.
- [ ] Implement adapters and owner-only connection screen, with safe error copy and clear source timestamps. Never automatically refresh the bank on page load.
- [ ] Run targeted tests, type/build checks and browser verification on a local/preview deployment with no production secrets exposed by default.
- [ ] Deploy reviewed callback and server configuration; owner reviews Xero consent and selects organisation. Verify live bank snapshot, Xero samples and CRM samples. Record any remaining inability to verify owner/non-owner access.
- [ ] Commit only task files and update connection setup evidence; chunk 2 passes only when live checks and owner restrictions are verified.

## Review and execution

Recommended execution: implement sequentially in this chat because access checks, OAuth and the source screen depend on each other. Written design and plan are ready for owner review; no application code has been implemented by this plan preparation.
