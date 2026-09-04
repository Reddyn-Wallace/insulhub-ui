# Partner Portal Foundation (Chunk A)

Status: implemented foundation, awaiting independent review before Chunk B.

## Approved delivery sequence

The portal is delivered in isolated chunks: (A) source capture, architecture, migrations, auth and tenant repositories; (B) branded partner shell/dashboard/drafts; (C) exact quote domain; (D) floor plans/PDF; (E) durable submission, outbox, legacy adapter and reconciliation; (F) internal partner operations, attribution, amendments and settlement; (G) partner tracking; (H) full tests, design QA and operational documentation. This change implements only A.

The visual source captured for Chunk B is the current app, not a newly invented brand: `src/app/layout.tsx` provides Inter; the existing login uses navy `#1a3a4a`, orange `#e85d04`, rounded fields/buttons and the existing word treatment; `public/icon-192x192.png`, `public/icon-512x512.png`, `public/apple-icon.png` and `src/app/favicon.ico` are the verified current icon assets. Later UI must reuse these sources and existing navigation/form patterns and must not redraw or claim a new official mark.

## Boundaries and ownership

- Portal identities are local records in `partner_users`. A `PARTNER` identity belongs to exactly one `partner_company`; an `INTERNAL` identity belongs to no company. There is no public signup. Better Auth owns password hashing, opaque sessions, expiry/refresh behavior and CSRF protections. Each successful login is proven to receive a fresh token; no additional periodic token replacement is claimed.
- A partner session is the only source of tenant identity. Browser fields, URLs and payloads never select a company. Repository methods accept an authenticated server principal and add the company predicate to every root and nested query.
- `/partner` accepts only active `PARTNER` principals. `/partner-ops` accepts only active `INTERNAL` principals. Internal access does not imply membership of any partner company, and partner access never implies internal privilege.
- Local PostgreSQL is authoritative for portal people, companies, drafts, quote/floor-plan work, mutable submission-attempt processing records, append-only tracking facts, amendments, outbox state, settlement metadata and audit events.
- Legacy Insul Hub remains authoritative for the legacy job after a verified successful submission and for downstream facts explicitly synchronized by a later adapter. Until those seams are verified, locally recorded submission/milestone/paid claims are workflow records, not proof that legacy Insul Hub accepted or paid anything.
- Company legacy credentials are adapter credentials, never portal login credentials. They are write-only through create/replace operations, encrypted with AES-256-GCM and a versioned server key, and decryptable only in the server integration module after endpoint allowlist validation.

## Orthogonal state and fact intent

Submission execution is represented only by `partner_jobs.submission_state`: `DRAFT`, `QUEUED`, `CREATING_LEAD`, `UPDATING_QUOTE`, `ATTACHING_PLANS`, `SUBMITTED`, `FAILED_RETRYABLE`, or `RECONCILIATION_REQUIRED`. The intended forward path is `DRAFT -> QUEUED -> CREATING_LEAD -> UPDATING_QUOTE -> ATTACHING_PLANS -> SUBMITTED`; any active phase may become `FAILED_RETRYABLE` or `RECONCILIATION_REQUIRED`, and a retry returns through `QUEUED`. A partner may mutate only `DRAFT`. `submission_started_at` records the first legacy attempt; `submitted_at` exists only after verified success. Failed or ambiguous attempts therefore never masquerade as successful submission. Cancellation is not a submission state; it is an independent tracking fact.

`partner_submission_attempts` is mutable durable worker state, not append-only history. Each numbered/idempotent attempt records its phase (`CREATING_LEAD`, `UPDATING_QUOTE`, `ATTACHING_PLANS`, `RECONCILING`) and outcome, including `AMBIGUOUS` and `RECONCILIATION_REQUIRED`. Audit and tracking facts preserve append-only evidence around mutations.

Business progress is independent of submission. Append-only `partner_tracking_facts` supports `EBA_COMPLETED`, `INSTALL_DATE_SET`, `JOB_COMPLETED`, `INVOICE_SENT`, `COMMISSION_PAID`, `REMITTANCE_RECEIVED`, and `CANCELLED`. `INSTALL_DATE_SET` is the sole `DATE` fact: its canonical value is the required `install_date`, its generic JSON payload and `effective_at` are forbidden. Every other fact is a `BOOLEAN true` event, requires `effective_at`, and must have `install_date` null. `CANCELLED` therefore means an explicit `BOOLEAN true` cancellation effective at the supplied time; it is not a submission state. `recorded_at` always remains separate from the effective/install date.

The drawing foundation reserves bounded names, nonnegative floor/order positions, immutable submitted snapshot data/timestamp, a bounded PDF storage key and a company-scoped PDF outbox link. Chunk D can build on these columns without an unsafe ownership rewrite.

Billing is fixed on `partner_companies` as `INSULHUB_BILLED` or `PARTNER_BILLED` and snapshotted onto each job and settlement. `partner_job_settlements` stores nonnegative integer cents. For `INSULHUB_BILLED`, net due is the manual commission owed to the partner and status becomes `PAID`; for `PARTNER_BILLED`, net due is validated as gross less retained margin and status becomes `RECEIVED`. No automated commission or margin formula is inferred beyond those explicit, manually supplied amounts. Revisions provide optimistic concurrency on mutable aggregates. Outbox delivery remains `PENDING/PROCESSING/DELIVERED/FAILED/DEAD` with idempotency keys.

## Security and acceptance decisions

- Better Auth 1.6 supplies maintained scrypt password handling and cryptographically random opaque database sessions. Better Auth stores the opaque token in the restricted auth database and signs the browser cookie; it does not provide a supported hashed-token database adapter in this configuration. Database encryption, least-privilege access and operational controls must therefore protect stored session tokens. The app disables signup, issues only HttpOnly `SameSite=Lax` cookies (`Secure` in production), enables database rate limits, and retains Better Auth origin/CSRF checks. Custom mutation routes additionally enforce an exact configured Origin.
- Login responses are always the same generic failure for unknown email, wrong password, disabled account or wrong surface. Successful login creates a fresh session. Logout reports success, clears the cookie, and writes `LOGOUT` only after Better Auth confirms database sign-out; an upstream failure returns a generic 503, preserves the cookie/session, and writes no success audit. Account disable runtime-checks the internal principal, locks and revalidates the active/non-disabled internal actor inside the transaction, then revokes the subject's database sessions.
- Emails are unique case-insensitively. Partner user/company membership is constrained in the database. Jobs, submissions and nested resources use company-inclusive keys and foreign keys. Guessed cross-company IDs resolve as not found.
- Audit payloads are allowlisted metadata only. Passwords, cookies, tokens, encrypted credential bytes and plaintext legacy credentials are never accepted by the audit writer. Request IDs are bounded to 200 characters and metadata to 16 KiB in both service and database checks.
- Credential replacement requires a runtime-checked internal principal. AES-GCM additional authenticated data binds ciphertext to company ID, normalized HTTPS endpoint and key version, preventing cross-company or endpoint substitution. Every decrypt/use revalidates the exact configured origin and `/graphql` path. Adapter request policy sets `redirect: "error"`; redirect responses must never be followed. Local/test operation is valid with no company credential: the adapter reports `unconfigured` and does not invent one.

## Explicit MVP non-goals

No public signup, self-service invitations, SSO/MFA UI, customer quote or invoice sending, payment rails, automated commission formula, generalized workflow engine, or use of a company legacy credential to authenticate a person. Chunk A also does not implement the branded shell, quoting UI/domain, drawing UI/PDF, live submission, live milestone sync, notification delivery, operations UI or partner tracking UI.

## Production configuration and verification blockers

The following are required production configuration or verification items and are **not completed integrations**:

- `DATABASE_URL`, a strong `PARTNER_AUTH_SECRET`, and the canonical `PARTNER_APP_ORIGIN`.
- A versioned `PARTNER_CREDENTIAL_KEYS_JSON` keyring and `PARTNER_CREDENTIAL_ACTIVE_KEY_VERSION`; rotation/re-encryption must be operationally rehearsed.
- `PARTNER_LEGACY_ALLOWED_ORIGINS` plus a verified fixed legacy API path policy.
- Real per-company legacy credentials, provisioned out of band and never committed.
- Verified live legacy submission semantics, idempotency and reconciliation behavior.
- Verified legacy settlement source/sync semantics; local commission-paid or remittance-received facts are not proof of payment until then.
- A verified live email recipient/sender and delivery provider.
- Approved pilot quote/pricing defaults and commercial owner sign-off.
- A passing disposable real-PostgreSQL migration gate. This is mandatory before production/schema completion may be claimed.

## Migration proof gate

Normal migration commands discover ordered `NNN_name.up.sql`/`NNN_name.down.sql` pairs, take a PostgreSQL advisory lock, and apply or revert exactly one version transactionally; the shared all-versions helper repeats that operation until exhausted. Emulated tests cover the portable schema path. Before production completion, run `npm run partner:migrate:gate` against a clean disposable PostgreSQL database with `PARTNER_MIGRATION_TEST_DATABASE_URL` and `PARTNER_MIGRATION_GATE_CONFIRM=RESET_DEDICATED_PARTNER_TEST_DATABASE`. The gate applies every pending numbered migration, runs constraint probes plus UPDATE/DELETE rejection probes for amendments, tracking facts and audit events, rolls every version down, proves the partner tables are absent and ledger empty, then reapplies every version in the same order. It refuses `DATABASE_URL`. Until that command passes against real PostgreSQL, PL/pgSQL triggers and the full Neon schema are **not proven**.

## Local/test provisioning

Internal provisioning also requires `PARTNER_OPERATOR_ROLE`, explicitly set to `ADMIN`, `OPERATIONS`, `FINANCE` or `VIEWER`. Missing roles or a role mismatch on reuse fail closed; the command never silently promotes an existing operator.

Apply the next ordered migration with `npm run partner:migrate`; revert the latest with `npm run partner:migrate -- down`. For local/test only, set `PARTNER_ALLOW_LOCAL_PROVISIONING=true`, `DATABASE_URL`, a local `PARTNER_APP_ORIGIN`, a local `PARTNER_AUTH_SECRET` of at least 32 characters, `PARTNER_PILOT_COMPANY_NAME`, `PARTNER_PILOT_COMPANY_SLUG`, `PARTNER_PILOT_BILLING_MODEL`, `PARTNER_PILOT_USER_EMAIL`, `PARTNER_PILOT_USER_PASSWORD`, `PARTNER_PILOT_USER_NAME`, `PARTNER_OPERATOR_EMAIL`, `PARTNER_OPERATOR_PASSWORD`, and `PARTNER_OPERATOR_NAME`, then run `npm run partner:provision`. Password and auth-secret values are supplied at runtime and never tracked. The command refuses production. Reuse is allowed only when the matching company is active and its name/billing model match, and each matching user has the requested principal/company ownership plus an existing credential account. Any collision fails closed, and an existing password is never reset implicitly.

Approved local/test quote defaults may also be supplied as integer cents/basis points with `PARTNER_PILOT_WALL_RATE_CENTS`, `PARTNER_PILOT_CEILING_RATE_CENTS`, `PARTNER_PILOT_DEPOSIT_BASIS_POINTS`, `PARTNER_PILOT_CONSENT_FEE_CENTS`, `PARTNER_PILOT_QUOTE_DEFAULTS_REVISION`, and a bounded JSON array in `PARTNER_PILOT_QUOTE_EXTRAS_JSON`. If none are supplied, unit rates remain nullable and the database defaults stay at consent 0, deposit 25%, and Council Fee $330. Explicit defaults are validated before writes and must match exactly on a later provisioning run; they are never silently changed.
