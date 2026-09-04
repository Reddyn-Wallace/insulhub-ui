# Partner Portal Chunk D1 — Floor-plan backend and PDF artifacts

Chunk D1 adds the partner-owned floor-plan domain, server routes, locked server PDF renderer, readiness calculation and immutable Postgres PDF artifacts. It deliberately stops before the partner Plans UI/editor integration (D2), submission, legacy upload/write-back, outbox work, internal operations and tracking.

## Storage and schema

Migration `004_partner_site_plan_artifacts` converts the foundation drawing rows to one drawing per floor, gives each job a collection `floor_plan_revision`, makes `(company, job, sort_order)` the deferrable ordering authority, caps a job at 20 floors and enforces case-insensitive unique floor names. Only legacy rows whose document is exactly `{}` are backfilled to the canonical empty schema-v1 document. The document check is bounded to 256 KiB.

`partner_site_plan_pdf_artifacts` stores the generated PDF as `BYTEA` with company/job/drawing identity, source drawing revision, canonical render hash, renderer/template versions, template/content hashes, byte size, sanitized filename, generator and timestamps. A drawing points to its current artifact through the full composite tenant/job/drawing/artifact identity. Submitted snapshots, legacy keys and outbox fields remain separate and untouched.

Artifacts are limited to 5 MiB each. Retention keeps the current artifact plus two non-current artifacts per drawing, ordered deterministically by generation time and UUID. Company storage is capped at 1 GiB. Capacity alerting should begin above 70% (716.8 MiB) for any company. Replace the in-database adapter with external immutable object storage when either the installation exceeds 10,000 artifacts or total artifact bytes exceed 10 GiB; the repository/render-hash boundary is the Chunk E adapter seam.

Backups must include artifact bytes, metadata, drawing pointers and migration ledger in one transactionally consistent Postgres backup. A restore is not complete until current-pointer composite foreign keys and sampled PDF SHA-256 values have been verified. Retention/pruning is not a backup strategy.

## Runtime and migration roles

Production must use distinct credentials:

- `PARTNER_DATABASE_URL`: application runtime login, with effective privileges inherited from `partner_portal_runtime`.
- `PARTNER_MIGRATION_DATABASE_URL`: schema/role owner used only by migration and controlled provisioning commands.
- `PARTNER_MIGRATION_TEST_DATABASE_URL`: disposable real-PostgreSQL gate database only.
- `PARTNER_DATABASE_RUNTIME_ROLE`: exact login-role name encoded in `PARTNER_DATABASE_URL`; this login must inherit `partner_portal_runtime` and must not inherit `partner_artifact_owner`.

`partner_artifact_owner` is a dedicated `NOLOGIN NOINHERIT` owner for fixed-`search_path` `SECURITY DEFINER` maintenance. `partner_portal_runtime` is also a credential-free `NOLOGIN` privilege group; the separately provisioned login named by `PARTNER_DATABASE_RUNTIME_ROLE` inherits it. The runtime login must not be a member of `partner_artifact_owner` and must not be able to `SET ROLE` to it. The migration creates or hardens both group roles, removes migration-session membership after ownership setup, and gives the runtime group only the existing portal surface it needs. Drawing INSERT/UPDATE access is column-scoped and excludes identity, tenant/job ownership, submitted-snapshot and current-PDF-pointer columns. The three privileged artifact functions are owned by `partner_artifact_owner`, use a `pg_catalog`-only search path and qualify every application object. Publication verifies SHA-256 and size, serializes company quota accounting, locks company → job → drawing → artifacts, and prunes before returning. Purge atomically checks the matching DRAFT job and collection revision, deletes through the immutable-artifact owner, defers and compacts floor order, increments the collection revision exactly once, verifies contiguity including the empty branch, and returns the authoritative revision and ordered drawing IDs. Direct runtime artifact insert/update/delete/truncate, current-pointer update and drawing delete/truncate remain denied. Production authenticates with `PARTNER_DATABASE_URL`, verifies the exact login, effective group membership, allowed document columns and all protected-column denials on the first authenticated portal request, and fails closed if the migration URL or runtime-role name is missing, equal, malformed or uses the same login identity. Pruning never trusts a session GUC and keys its authority to the non-login function owner.

Migration 004 never silently renames or reorders existing data. Before changing any populated database it emits only four non-PII counts and aborts if it finds case-insensitive duplicate floor-name groups, non-contiguous/duplicate sort-order jobs, non-NFC names or jobs above 20 floors. An administrator must repair those records under a separately reviewed change:

1. Take a restorable backup, pause portal writes and stage migrations 001–003.
2. Run the same four count queries from migration 004. Resolve only the reported company/job groups in a transaction. Preview deterministic order as `row_number() over (partition by company_id,job_id order by sort_order,id)-1`; after explicit approval, apply those exact values with a direct `CASE id ... END` update. Do not infer new floor names: obtain an approved unique NFC name for every case-insensitive collision, then apply it by exact drawing UUID.
3. Re-run the count-only preflight and require all four counts to be zero. Commit the reviewed repair, then run migration 004.
4. Run the disposable real-PostgreSQL gate and retain its output with the change record.

The local `pg-mem` path emulates the canonical shared parser and omits PostgreSQL-only roles, triggers, fixed-search-path functions and deferrability syntax. It is not evidence that the production permission contract works.

## Domain and rendering

The shared parser uses recursive exact allowlists. It accepts at most 500 walls and 100 notes, safe unique IDs, x `0..18`, y `0..17`, non-zero walls, enumerated styles/colors, bounded positive dimensions/font/boxes and 256 KiB of normalized JSON. CRLF/CR become LF, Unicode becomes NFC, and all other C0/C1 controls are rejected. An empty wall array is a valid saved draft; PDF generation requires at least one wall.

The render hash is canonical SHA-256 over explicit normalized floor name, four explicit nullable address fields, normalized document, template/version/hash, static Noto Sans font hash and renderer version. Keys are sorted, nulls are explicit, numbers are finite/canonical, negative zero becomes zero and text is NFC. Artifacts are revision-plus-hash idempotent so edit→revert creates valid current provenance without mutating an older artifact.

The renderer verifies the one-page locked `public/site-plan-template-v2.pdf` hash `b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b`, the static OFL Noto Sans hash `478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823`, and exact renderer identity. It uses fixed metadata, deterministic traversal, glyph preflight and bounded text layout. Māori/macrons and explicit note line breaks are supported; emoji/CJK and other missing glyphs fail safely. The raster smoke check confirms the existing bottom-right smoke-detector warning remains visible.

## APIs and security

- `GET/POST /api/partner/jobs/:jobId/floor-plans`
- `PATCH /api/partner/jobs/:jobId/floor-plans/order`
- `GET/PATCH/DELETE /api/partner/jobs/:jobId/floor-plans/:drawingId`
- `POST/GET /api/partner/jobs/:jobId/floor-plans/:drawingId/pdf`

Company scope comes only from the Better Auth principal; internal principals are denied. Nested misses and malformed UUIDs use generic 404s. Mutations require an exact allowed `Origin`, strict body allowlists and a 256 KiB request cap. Responses are `private, no-store`. Writes retain `DRAFT` predicates and collection/drawing CAS. Generation commits rate-limit attempts before rendering, reloads authoritative input, renders outside a transaction, then rechecks job/address/collection/drawing/pointer/hash state before publication. A failed render leaves the prior pointer untouched. Only the current download query projects `BYTEA`; it recomputes SHA-256 before serving with hardened PDF headers and RFC 5987 filenames.

Generation limits are 10 per user per 10 minutes and 30 per company per hour. Downloads are 120 per user per 10 minutes. Every counter uses one atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement, so simultaneous first hits cannot bypass the limit; storage failures return a generic temporary-unavailable response.

Readiness requires at least one floor and every persisted floor to have a unique nonblank name, at least one wall and a current artifact matching both drawing revision and canonical render hash. An empty or stale extra floor blocks the whole job; no floor is omitted silently.

## Verification and launch blocker

Portable migration, domain, hash, renderer, readiness, repository and route tests run locally. The destructive real-PostgreSQL gate must be run only against a clean disposable database with `PARTNER_MIGRATION_GATE_CONFIRM=RESET_DEDICATED_PARTNER_TEST_DATABASE`; it refuses either configured runtime or migration URL and remains intentionally unrun here because no safe URL was supplied. The gate now checks preflight pass/fail counts, role attributes and non-membership, function ownership/search path/execute grants, direct artifact mutation and drawing-delete denial, verified publication, pruning, scoped purge, deferrability, exact composite pointer identity, full rollback absence, legacy `{}`/`floor_index` restoration and deterministic up/down/up application. Provisioning distinct real login credentials and passing this gate are the remaining external launch blockers; no live database, credential or deployment state is changed by Chunk D1.
