# Partner Portal Chunk B

Chunk B adds the branded partner shell, company dashboard, resilient lead drafts, and an explicit local-only demo. It does not implement quote calculation, floor plans, submission, live legacy integration, internal operations, email delivery, payments, or settlement automation.

## Visual source

The selected source is the existing Insul Hub `/login` screen captured with the Codex in-app Browser at 1440 × 900 and 390 × 844. See `docs/design-reference/`. The implementation reuses Inter, navy `#1a3a4a`, orange `#e85d04`, gray page backgrounds, rounded white cards and pills, orange focus rings, compact sticky navigation, and the verified existing icon assets. No safe legacy account was available, so `src/app/jobs/layout.tsx` and the existing public components/assets are secondary authenticated-pattern evidence. No new official mark was created.

## Local fictional demo

The demo uses the same Better Auth handlers, database sessions, Origin checks, page boundaries, repositories, and API routes as production, backed by a process-local pg-mem database. The pool is stored once per Node process so Next.js route-handler and React Server Component module graphs see the same sessions and drafts. It is enabled only with the confirmation flag and an explicit HTTP(S) loopback `PARTNER_APP_ORIGIN`. It throws for production, public/staging origins, non-loopback request hosts, missing confirmation, or a missing origin:

```sh
PARTNER_DEMO_MODE=true \
PARTNER_DEMO_CONFIRM=LOCAL_FICTIONAL_DATA_ONLY \
PARTNER_APP_ORIGIN=http://127.0.0.1:3000 \
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Documented fictional accounts:

- Northwind Insulation: `partner.demo@example.test` / `PartnerDemo!2026` (`INSULHUB_BILLED`).
- Harbour Thermal: `second.demo@example.test` / `SecondDemo!2026` (`PARTNER_BILLED`).

The UI always labels demo mode and fictional data. Data resets on server restart. A fictional company-less `INTERNAL` user records the demo `LOCAL_INTERNAL` tracking fact; partner users never impersonate an operator. These credentials are intentionally non-sensitive and must never be replaced with real accounts. Without the explicit demo flags, production continues to require `DATABASE_URL`, migrations, `PARTNER_AUTH_SECRET`, and the rest of the Chunk A production configuration.

## Routes and ownership

- `GET /api/partner/jobs`: company-scoped list with optional customer/reference search and submission-state filter.
- `POST /api/partner/jobs`: create an incomplete draft.
- `GET /api/partner/jobs/:jobId`: company-scoped detail.
- `PATCH /api/partner/jobs/:jobId`: draft-only compare-and-swap update using `revision`.
- `/partner`, `/partner/jobs/new`, and `/partner/jobs/:jobId`: authenticated partner pages.

Every route derives the company from the Better Auth session. Client bodies containing `companyId` or `company_id` are rejected. Cross-company IDs return not found, internal sessions do not imply partner access, mutations require an exact allowed Origin, and submitted/non-draft records reject edits. Authenticated pages are dynamic and partner auth/job API responses use `Cache-Control: private, no-store`. API errors contain only generic state/error codes and never echo customer input.

Draft fields are deliberately permissive: an empty draft is valid, while optional email/phone shape, verified lead-source membership (`Contact Form`, `Social Media`, `Phone Call`, `Referral`, `Homeshow`), and database/browser length limits are enforced. Each edit uses optimistic revision comparison so a stale tab cannot overwrite a newer save. A conflict clears/quarantines the stale recovery entry and navigates to a revision-addressed server render before resetting all fields.

Unsaved edits are recoverable for seven days from versioned, tab-scoped `sessionStorage`. Keys and payloads are namespaced with an opaque server-derived company/user scope, and a mismatched scope or job, malformed/negative revision, bad timestamp, or expired entry is rejected. Only the active authenticated scope is cleared after successful logout. Storage reads/writes/removals are best effort: browser storage denial never changes a successful API outcome or creates a second request. Recovery contains customer-entered form data but no auth token, password, or legacy credential; a shared browser profile should still be treated as sensitive.

Dashboard milestones are independent facts. Missing EBA, install date, job completion, invoice sent, and billing-specific commission/remittance facts are shown as **Awaiting update**, not inferred from submission state, and the page says updates appear as the Insul Hub team records them. Demo facts are local workflow examples and are not proof of legacy acceptance, installation, invoicing, payment, or remittance.

Actual install dates, invoice details, amendment history, settlement amounts, and their richer partner tracking views are explicitly deferred to Chunk G. Chunk B shows only the independent recorded/not-recorded facts already supported by the foundation.

In demo mode the fictional company chooser deliberately pushes the primary sign-in action just below the first 390 × 844 viewport. The form scrolls normally, production has no chooser, and keeping both tenant choices visible is valuable for isolation testing; this is a documented demo-only first-viewport tradeoff.
