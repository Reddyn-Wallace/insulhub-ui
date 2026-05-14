# Backend Boundaries for AI Agents

This project currently talks to two backends. Treat them as separate systems with different ownership and responsibilities.

## Short Version

- Use the existing Insulhub backend (`https://api.insulhub.nz`) for canonical business data.
- Use the Neon backend only for UI-owned overlay data that the old Insulhub backend does not store.
- Do not move fields between the two casually. If data already exists in Insulhub, keep reading and writing it through Insulhub.
- Do not use Neon as a shadow copy of jobs, clients, quotes, installs, EBA data, invoices, users, auth, or uploaded files.

## Backend 1: Old Insulhub Backend

The old backend is the production Insulhub API at:

```txt
https://api.insulhub.nz/graphql
https://api.insulhub.nz/files/...
```

In this repo it is accessed mainly through:

- `src/lib/graphql.ts`
- `src/lib/queries.ts`
- `src/lib/mutations.ts`
- direct file upload/download calls in job and EBA screens
- login through the `loginUser` GraphQL mutation

This backend is the system of record for core Insulhub business entities.

Use it for:

- users and auth tokens
- jobs and job stages
- leads and lead statuses
- clients and contact/billing details
- quotes and quote PDFs
- installation dates/statuses/notes where the field already exists on the Insulhub job
- EBA form data and EBA signatures/photos
- council data and files
- invoices and Xero invoice references
- archived jobs
- uploaded documents/files
- email logs and API-generated message bodies

Typical client-side usage:

```ts
import { gql } from "@/lib/graphql";
import { JOB_QUERY } from "@/lib/queries";

const data = await gql<{ job: Job }>(JOB_QUERY, { _id: jobId });
```

Typical write usage:

```ts
import { gql } from "@/lib/graphql";
import { UPDATE_JOB_LEAD } from "@/lib/mutations";

await gql(UPDATE_JOB_LEAD, { input: { _id: jobId, lead: { leadStatus: "WON" } } });
```

Important notes:

- `gql()` automatically sends the browser token from `localStorage`.
- `gql()` invalidates relevant browser caches after mutations.
- Unauthorized GraphQL responses force the user back to `/login`.
- The schema is partly reverse-engineered. Check `API_SCHEMA_NOTES.md` before adding or changing GraphQL fields.

## Backend 2: New Neon Overlay Backend

The Neon backend is a small Postgres overlay owned by this UI. It is accessed through the Next.js route handlers under `src/app/api/...`, not directly from browser components.

In this repo it is accessed through:

- `src/lib/overlay-db.ts`
- `src/app/api/install-planning/route.ts`
- `src/app/api/calendar/placeholders/route.ts`
- `src/app/api/calendar/placeholders/[id]/route.ts`
- `src/app/api/contact-templates/route.ts`
- `src/app/api/contact-templates/[id]/route.ts`

The Neon connection comes from:

```txt
DATABASE_URL
```

Use Neon for UI-owned data that does not belong to the old Insulhub schema.

Current Neon tables:

- `job_install_planning`
- `calendar_placeholders`
- `contact_templates`
- `overlay_settings`

Current Neon-owned concepts:

- install-planning overlay flags such as `status`, `install_scope`, `planning_note`, and `council_approval_na`
- calendar placeholder rows that are not real Insulhub jobs
- editable SMS/email contact templates used by this UI
- one-off overlay settings such as seed markers

Typical browser usage:

```ts
const res = await fetch("/api/install-planning", {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    "x-access-token": token,
  },
  body: JSON.stringify({
    jobId,
    status: "confirmed",
    installScope: "external",
  }),
});
```

Typical server route usage:

```ts
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

const unauthorized = await requireInsulhubAuth(request);
if (unauthorized) return unauthorized;

await ensureOverlaySchema();
const rows = await overlaySql`SELECT * FROM job_install_planning`;
```

Important notes:

- Neon route handlers must call `requireInsulhubAuth(request)` before reading or writing overlay data.
- `requireInsulhubAuth()` verifies the same Insulhub token against the old GraphQL API.
- Neon routes should call `ensureOverlaySchema()` before querying overlay tables.
- Browser code should call the local `/api/...` route, not import `overlay-db.ts`.
- `src/lib/overlay-db.ts` is server-only and must stay out of client components.

## Decision Rules

When adding or changing data access, ask these questions in order.

1. Does this field already exist on the old Insulhub API?

Use the old Insulhub backend through GraphQL or file endpoints.

2. Is this data part of a canonical business record?

Use the old Insulhub backend. Examples: client details, job stages, quote totals, install dates, EBA answers, uploaded files.

3. Is this data only needed by this UI and absent from the old API?

Use Neon through a local Next.js API route. Examples: calendar placeholders and UI-specific contact templates.

4. Does the data reference an Insulhub job but not belong in the old backend?

Use Neon, store the Insulhub job id as a text foreign reference, and keep the payload small. `job_install_planning.insulhub_job_id` is the current pattern.

5. Could old Insulhub and Neon both update the same business meaning?

Stop and clarify the model before coding. Split ownership is risky because the UI can show stale or contradictory state.

## Data Composition Pattern

Some screens combine both backends.

Example: calendar/reporting screens load canonical jobs from Insulhub, then merge Neon overlay rows by job id.

Expected flow:

1. Fetch jobs from Insulhub with `gql()`.
2. Fetch overlay rows from local `/api/...` routes.
3. Merge in the UI by `_id`/`jobId`.
4. Write canonical job changes back through GraphQL.
5. Write overlay-only changes back through local `/api/...` routes.

Keep the source visible in returned objects where useful. Existing overlay responses often include:

```ts
source: "overlay"
```

## What Not To Do

Do not:

- add a Neon table for data the old Insulhub backend already owns
- write directly to Neon from a client component
- bypass `requireInsulhubAuth()` on overlay routes
- put Insulhub auth secrets or Neon connection details in client-visible code
- duplicate whole job/client/quote records into Neon
- use Neon to avoid learning the GraphQL schema when the data is canonical
- assume the old API field names are clean or intuitive; verify them in `API_SCHEMA_NOTES.md` and existing queries

## File Map

Old Insulhub backend:

- `src/lib/graphql.ts` - shared GraphQL fetch helper, auth handling, query caching, mutation cache invalidation
- `src/lib/queries.ts` - shared GraphQL queries
- `src/lib/mutations.ts` - shared GraphQL mutations
- `src/lib/insulhub-auth.ts` - server-side token verification for overlay routes using old GraphQL auth
- `API_SCHEMA_NOTES.md` - reverse-engineered API reference

New Neon overlay backend:

- `src/lib/overlay-db.ts` - Neon client and schema creation
- `src/app/api/install-planning/route.ts` - overlay planning rows keyed by Insulhub job id
- `src/app/api/calendar/placeholders/route.ts` - create/list calendar placeholders
- `src/app/api/calendar/placeholders/[id]/route.ts` - update/delete calendar placeholders
- `src/app/api/contact-templates/route.ts` - create/list contact templates and seed defaults
- `src/app/api/contact-templates/[id]/route.ts` - update/delete contact templates

## Naming Guidance

Prefer these names in code and docs:

- `Insulhub API`, `old Insulhub backend`, or `canonical backend`
- `Neon overlay`, `overlay backend`, or `UI-owned overlay data`

Avoid calling Neon "the new backend" without context. It is new infrastructure, but it is not the replacement system of record for Insulhub.
