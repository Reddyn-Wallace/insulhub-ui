# Partner draft deletion and header simplification

## Scope and acceptance

- Remove Dashboard and New quote / lead links from the partner header on desktop and mobile. Retain branding/home link, Sign out, and the main dashboard New quote / lead action.
- Add a compact Delete action to draft cards with a named confirmation; cancelling makes no request.
- Delete only same-company drafts that have never started submission. Submitted, queued, failed and reconciliation jobs remain protected.
- Require authenticated partner identity, exact Origin, bounded revision-only input and optimistic job revision. A stale quote edit requires reload.
- Remove the card only after confirmed server success. Pending/network/unknown failures retain the card and browser recovery, lock repeat deletion and offer Reload jobs.
- Exclude removed drafts from job lists/details, drawing/PDF reads, partner tracking and new submission candidates. Prevent stale writes and stale creation-key retries from restoring them.
- Retain underlying draft, drawings, PDFs and append-only audit records. No restore UI is introduced.

## Implementation and review

Migration 011 adds a deletion timestamp and an atomic, company-scoped deletion function. The restricted portal role has no direct timestamp write authority. The function uses company → active actor → job locks, checks state/revision, then records deletion and audit together. Its NOLOGIN owner receives only the additional UPDATE(id) permission needed for PostgreSQL's partner-user row lock; rollback removes that grant. Audit CHECK includes DRAFT_DELETED.

Job and drawing triggers block changes to tombstoned records, including privileged PDF-pointer and submission queue updates. Rollback refuses while tombstones exist so a schema rollback cannot silently make removed jobs visible.

Deletion includes the latest committed floor plans; floor-only changes do not all advance the quote revision. Plan operations and deletion use company/job locks in PostgreSQL. Underlying records remain retained. The local pg-mem implementation is explicit demo/test emulation, not evidence of PostgreSQL lock/permission correctness.

Browser recovery cleanup affects only the deleted job under the current company/user scope, including its conflict copy. Stale creation keys remain reserved and return a conflict instead of creating another job.

Independent critic reviewed the plan and implementation. Corrected audit-enum support, row-lock privileges, deleted tracking reads, conflict-recovery cleanup and gate role/error assertions. No remaining application findings.

## Verification and limitations

- Full final regression suite passed: partner 522/522; site-plan 6/6; communications scripts; Cloudflare 5/5. Independent critic passed application/migration review; independently ran 67 tests and a final 43-test focused rerun.
- Browser verified header links absent, cancel leaves the draft, deletion of a fictional draft with two completed plans, persistence after reload, and inaccessible old draft/floor-plan URLs. Mobile verification at 390×844 confirmed only branding and Sign out in the header and page width exactly 390px (no horizontal overflow).
- TypeScript, production build and targeted lint passed. Full lint remains the pre-existing three CommonJS errors and 20 warnings, none in partner code. No production data writes, deployment, commit or push.
- Real PostgreSQL gate extended with restricted-role deletion, stale/cross-tenant rejection, retained artifacts/audit, tombstone write guards and rollback safety. **NOT RUN**: dedicated PARTNER_MIGRATION_TEST_DATABASE_URL is not configured.
- The critic also identified a pre-existing live-freeze prerequisite: migration 008 locks PDF artifact rows FOR UPDATE, but partner_submission_owner only has SELECT on that table. That production privilege needs resolution and real-PG verification before live submission is claimed complete. This UI batch deliberately does not broaden those privileges. The new gate tests stale freeze and the protected submission-owner job-update boundary, not a full current-revision freeze.
