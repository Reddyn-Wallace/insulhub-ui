# Partner portal Chunk F — internal operations and partner tracking

## Outcome

Chunk F turns the authenticated `/partner-ops` boundary into the manual operational control plane needed for the pilot. It intentionally does not claim a live legacy webhook, invoice-payment feed or payment rail. Internal records are clearly labelled as locally recorded, and the partner side receives a read-only projection.

## Build sequence

### F1 — operations data and API boundary

1. Add migration 007 with the exact schema and grant surface listed below.
2. Add a separately configured production operations database pool/role. Every operation re-reads and locks the active internal actor and checks the single required `ADMIN`, `OPERATIONS`, `FINANCE` or `VIEWER` permission before reading or mutating operations data.
3. Add bounded, exact-Origin/Host protected operations routes for dashboard data, companies, partner users, job detail, milestones, amendments, invoices and settlements.
4. Keep passwords and company legacy credentials write-only. User creation hashes the supplied initial password server-side; no password hash or credential material is returned or logged.
5. Add repository, route, schema and adversarial tests before UI work.

### F2 — operations and partner-facing UI

1. Build the InsulHub-branded operations shell, queue/dashboard, company and partner-user management, and submitted-job detail. Internal-user lifecycle management is deliberately not exposed in this pilot UI.
2. Let operations staff record EBA completion, install date, job completion, cancellation, amendments and invoice details. Let finance staff record the billing-model-specific pending and terminal settlement state.
3. Show partners a single read-only status timeline with latest milestone dates, amendments, invoice details and either commission payable/paid or remittance due/received.
4. Seed a fictional internal administrator and representative records for both billing models, then exercise the complete internal-to-partner projection in the in-app Browser at desktop and mobile viewports.

## Permission model

- `ADMIN`: company settings, partner users, all operations and finance actions.
- `OPERATIONS`: queues, milestones, amendments and invoices; no company/user or settlement changes.
- `FINANCE`: queues and read-only job context plus invoice/settlement actions; no company/user changes.
- `VIEWER`: read-only operations access.
- Each internal user has exactly one `ops_role` column value; partner users must have `ops_role = NULL`. Existing internal users are backfilled to `ADMIN`, while future internal-user provisioning must choose one role explicitly. This chunk manages partner users only; creating additional internal users remains a controlled provisioning task.
- Partner principals can never use `/partner-ops`, and internal principals can never use `/partner`.
- A company billing-model change affects future jobs only; every existing job and settlement continues to use its immutable job snapshot.

The production operations connection is `PARTNER_OPS_DATABASE_URL`. Its exact login name must match `PARTNER_OPS_DATABASE_ROLE`, be a member of only the non-login `partner_ops_runtime` role, and be distinct from migration, partner runtime and submission-worker logins. It receives no direct table privileges. It can execute only migration-007 `SECURITY DEFINER` functions owned by `partner_ops_owner`; every function pins `search_path = pg_catalog`, locks and revalidates the actor as an active internal user, then checks the required single `ops_role`. Operations routes first derive the principal from the secure ops session and then pass only that server-derived actor ID to the repository.

## Migration 007 objects and invariants

- `partner_users.ops_role`: `ADMIN | OPERATIONS | FINANCE | VIEWER`; required only for `INTERNAL`, forbidden for `PARTNER`.
- `partner_job_invoices`: one company/job-scoped current record containing a trimmed bounded reference, nonnegative integer-cent amount, sent timestamp, optimistic revision and created/updated internal actor IDs. The job FK is composite and the row has no payment-status field.
- `partner_job_amendments.patch`: retained as JSONB but constrained to the exact v1 object `{ "version": 1, "description": string, "contractDeltaCents"?: integer }`, with no additional keys, a trimmed 1–1000 character description and a bounded integer-cent delta.
- Expanded audit event types for company creation/update, partner-user provisioning, facts, amendments, invoices and settlements. Metadata stays redacted and bounded.
- Insert guards on facts and insert/update guards on invoices and settlements reject operational/financial changes once a `CANCELLED` fact exists. A first cancellation is permitted; duplicate cancellation and all later facts are rejected. Append-only explanatory amendments remain permitted.
- Settlement terminalization and its matching `COMMISSION_PAID` or `REMITTANCE_RECEIVED` fact occur in one database transaction/function. Invoice recording and `INVOICE_SENT` likewise occur atomically.
- Narrow definer functions cover list/detail reads plus company create/update, partner-user create/disable, fact append, amendment append, invoice upsert and settlement upsert/terminalization. `partner_ops_runtime` receives execute only on this enumerated set; partner runtime and worker roles receive none.
- Migration down removes only the 007 functions, roles/grants, triggers, invoice table, new constraints/audit values and `ops_role`, after refusing unsafe rollback when new records would be lost.

The application has a demo-only repository implementing the same operations contract directly against pg-mem because pg-mem cannot execute the PostgreSQL definer functions. Production always uses the restricted function-backed repository, and role assertions verify the exact membership/function set before serving ops data.

## Financial model

- `INSULHUB_BILLED`: InsulHub invoices the customer. The settlement stores the invoice gross and manually approved commission; `net_due_cents` is the commission. Terminal status is `PAID` and atomically records `COMMISSION_PAID`.
- `PARTNER_BILLED`: the partner invoices the customer. The settlement stores the invoice gross and partner-retained commission; `net_due_cents` is the amount owed to InsulHub. Terminal status is `RECEIVED` and atomically records `REMITTANCE_RECEIVED`.
- Amounts are integer cents, nonnegative and snapshot against the job billing model. No automatic commission rate, GST reinterpretation or payment transfer is invented.

## Acceptance criteria

- Active internal users can sign in only at `/partner-ops`; role permissions are revalidated on every protected read and write. Disabled users and cross-surface cookies fail closed.
- Company creation validates a unique slug, trimmed bounded display name, fixed billing model and quote defaults. Display names need not be globally unique. Existing job billing snapshots do not change when company defaults change.
- Partner user creation validates lowercase unique email and strong bounded initial password, hashes it on the server and never returns the hash. Disabling a user revokes all sessions immediately.
- The inbox lists every company submission with company, customer, reference, submission/reconciliation state, latest milestone and settlement state. Filters are persistent controls, not decorative.
- Only submitted or reconciliation jobs accept operational facts. Facts and amendments are append-only; install-date corrections append a new date and the latest effective record is projected.
- Amendments use a versioned safe shape (`version`, `description`, optional integer-cent contract delta), never an arbitrary client patch.
- Invoice reference, amount and sent date are company/job scoped, bounded and revision protected. Recording an invoice also appends `INVOICE_SENT` in the same transaction.
- Settlement amounts and statuses obey the job billing model. Moving to `PAID` or `RECEIVED` atomically writes the matching terminal fact; invalid status/model/amount combinations fail.
- Cancellation is explicit. The database write functions and triggers reject every later fact, invoice and settlement insert/update while still allowing append-only explanatory amendments. It is never inferred from submission failure.
- Partner job details show EBA, install date, completion, invoice, amendments and the correct commission/remittance labels, amounts and dates. Missing data says `Awaiting update`; Xero/reference presence is never treated as payment proof.
- The partner read model is a live no-store query over the append-only facts/amendments and current revisioned invoice/settlement rows. For each fact type the latest `recorded_at` row wins; install-date corrections therefore append rather than overwrite. A response reflects the latest committed database transaction and is not backed by a second mutable projection or cache.
- Partner reads remain company-derived and tenant-scoped. A guessed job ID from another company returns the same not-found response across detail, timeline and financial projections.
- All writes use exact Origin/Host checks, bounded strict payloads, audit events and no-store responses. Secrets and hashes are absent from responses, UI state, logs and audit metadata.
- Migration up/down/static gates, domain/repository/route/UI tests, both billing models, role denial, stale revisions, duplicate actions, append-only enforcement, tenant denial and browser desktop/mobile flows pass.
- A disposable real-PostgreSQL gate applies migrations 001–007, provisions distinct migration/partner-runtime/ops-runtime/submission roles, verifies 007 function ownership, pinned search paths, exact execute grants and forbidden table/role privileges, exercises each permission tier and cancellation/append-only trigger, rolls 007 down, reapplies it, and reruns the probes. Production/schema completion is not claimed until this gate passes; pg-mem is only the local functional test path.

## Explicitly out of scope

- Live legacy milestone polling/webhooks until a verified DTO and contract are supplied.
- Automated commission rates, GST policy changes, Xero payment inference or moving money.
- Partner self-signup, invitations, password reset, SSO or MFA.
- In-app internal-user creation, role reassignment or disable. Internal operators remain deliberately provisioned through the controlled administration path; the portal UI manages company-scoped partner users only.
- Customer or partner notifications. The in-app operations inbox is authoritative for the pilot; external delivery remains unconfigured.

## F1 verification checkpoint — 31 August 2026

- Full partner regression: 394 passing tests before the last response-shape parity test; final focused operations/repository/routes/migration set: 59 passing tests.
- Production build, TypeScript and targeted F1 lint pass. The full repository lint baseline remains separately tracked.
- Negative coverage includes all role tiers, tenant mismatch, disabled users, exact Origin/Host, malformed and oversized bodies, stale revisions, cancellation, both settlement models, duplicate facts and terminal payment replay.
- The explicit fictional demo shares its pool, mutex and re-entrant async context across Next module graphs. A dual-module regression and forced audit failure verify rollback and preservation of a concurrent outside write.
- Disposable PostgreSQL probes now cover exact grants/owners, direct cancellation triggers, unsafe rollback refusal, UTC-independent install dates, consistent fact ordering and optional-field parity. These probes are **not run** until `PARTNER_MIGRATION_TEST_DATABASE_URL` is supplied; local pg-mem results are not production schema proof.

Implementation references: [Next.js server/client boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components) and [request headers](https://nextjs.org/docs/app/api-reference/functions/headers). Operations UI reads remain server-authenticated and uncached; interactive mutations reuse the already-tested route boundaries.

## F2 final evidence — 31 August 2026

The internal company/user workspace, queue, role-aware job forms and partner tracking view are complete for the local pilot. Critic review passed after correcting exact company payloads, keyed company switching, decimal entry, user validation, payment labels, form-key collisions and rapid URL filter races. Final bounded critic verification: 41 tests passed. Full repository regression: 427 partner tests, six site-plan tests, all communication scripts and five worker tests passed; the demo-off production build and targeted lint passed.

The in-app Browser created Kauri Partner Demo with editable rates, a 25% deposit, consent fee and repeatable extras, then created an individual user using a mixed-case email and successfully signed in to its isolated empty company. It recorded a corrected installation date, completion, an amendment, invoice and pending/paid commission for Northwind; it separately recorded a partner-billed invoice and received remittance for Harbour. The partner views showed the exact dates/amounts, no editing inputs and no cross-company access. Invoice/settlement inputs disappeared after final payment without duplicating the amendment form.

Desktop/mobile screenshots and source comparisons are recorded in `docs/design-reference/`; see `design-qa.md` for layout findings. The two-column mobile metrics match the partner dashboard pattern and avoid a long stack before queue results. Account disable/revocation and role/cross-tenant denial additionally have route/repository/UI tests.

The real PostgreSQL gate remains **NOT RUN / NOT PROVEN**: its command fails closed on missing `PARTNER_MIGRATION_TEST_DATABASE_URL`; no local PostgreSQL or container runtime was available on the environment's command path. The local handoff does not approve live legacy integration, automatic milestone sync, external notification delivery or payment transfer. `partner-portal-release.md` lists the remaining setup and integration acceptance requirements.
