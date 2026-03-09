# Insulhub API Schema Notes

Last updated: 2026-03-09

This file is a practical, reverse-engineered reference for the Insulhub GraphQL API as used by this UI repo.

It is **not** an official schema dump.
It is a working document built from:
- current frontend queries/mutations in this repo
- live GraphQL validation against production
- observed behavior during debugging and data recovery work

Because production introspection is disabled, treat this file as:
- **Proven** where we have successfully queried/mutated it
- **Observed** where it appears in the UI or responses
- **Unknown / partial** where the API likely has more fields than we have used

---

## 1. Core API facts

### Endpoint
- `https://api.insulhub.nz/graphql`

### Auth
- Browser app sends auth via header:
  - `x-access-token: <token>`
- Token is stored in browser localStorage:
  - `localStorage.getItem("token")`

### Auth failure behavior
Observed patterns:
- HTTP `401` can happen
- GraphQL can also return a normal `200` with error message:
  - `UNAUTHENTICATED`
  - `Unauthorized`

Current UI handling in this repo:
- `/src/lib/graphql.ts`
- clears `token` + `me`
- redirects to `/login`
- handles both HTTP 401 and GraphQL `UNAUTHENTICATED` style errors

### Introspection
- Production introspection is disabled
- Example observed error:
  - `GraphQL introspection is not allowed by Apollo Server...`

Implication:
- schema discovery must be done via live query attempts, validation errors, frontend code, and captured successful payloads

---

## 2. High-level domain model

The main entity is a `job`.

A job commonly includes these top-level areas:
- `_id`
- `jobNumber`
- `stage`
- `notes`
- `createdAt`
- `updatedAt`
- `archivedAt`
- `lead`
- `quote`
- `client`
- `ebaForm`
- `installation`

---

## 3. Stage model

### Proven `job.stage` values
Recovered from live UI and current repo:
- `LEAD`
- `QUOTE`
- `SCHEDULED`
- `INSTALLATION`
- `INVOICE`
- `COMPLETED`

### UI labels
Current UI maps these as:
- `LEAD` → Leads
- `QUOTE` → Quotes
- `SCHEDULED` → Accepted
- `INSTALLATION` → Installations
- `INVOICE` → Invoice
- `COMPLETED` → Completion

### Important behavior
- Backward stage transitions are not reliably supported via normal `updateJob(stage: ...)`
- Some invalid/backward stage mutation attempts can return 200 but effectively do nothing
- When a rollback is needed, cloning into a new job at the desired stage has been safer than trying to move an existing job backward

---

## 4. Proven query shapes

## 4.1 Users

### Query
```graphql
query Users {
  users {
    results {
      _id
      firstname
      lastname
      email
      role
    }
  }
}
```

### Proven fields
- `users.results[]`
  - `_id`
  - `firstname`
  - `lastname`
  - `email`
  - `role`

---

## 4.2 Login

### Mutation
```graphql
mutation Login($email: String!, $password: String!) {
  loginUser(email: $email, password: $password) {
    token
    user {
      _id
      email
      role
      firstname
      lastname
    }
  }
}
```

### Proven response
- `loginUser.token`
- `loginUser.user`
  - `_id`
  - `email`
  - `role`
  - `firstname`
  - `lastname`

---

## 4.3 Jobs list

### Current repo query
```graphql
query Jobs($stages: [JobStage!], $skip: Int, $limit: Int, $search: String) {
  jobs(stages: $stages, skip: $skip, limit: $limit, search: $search) {
    total
    results {
      _id
      jobNumber
      stage
      createdAt
      updatedAt
      archivedAt
      lead {
        leadStatus
        allocatedTo { _id firstname lastname }
        callbackDate
        quoteBookingDate
      }
      quote {
        quoteNumber
        date
        status
        deferralDate
        c_total
      }
      client {
        contactDetails {
          name
          email
          phoneMobile
          streetAddress
          suburb
          city
          postCode
        }
      }
    }
  }
}
```

### Proven arguments
- `stages: [JobStage!]`
- `skip: Int`
- `limit: Int`
- `search: String`

### Proven result shape
- `jobs.total`
- `jobs.results[]`

### Proven pagination model
- offset pagination via `skip` + `limit`
- no page/pageInfo needed in the currently used query

### Notes
- The UI frequently loads very large pages, e.g. `limit: 5000`
- archived jobs are still queryable; UI commonly filters on `archivedAt`

---

## 4.4 Single job

### Current repo query
```graphql
query Job($_id: ObjectId!) {
  job(_id: $_id) {
    _id
    jobNumber
    stage
    notes
    updatedAt
    archivedAt
    lead {
      leadStatus
      leadSource
      allocatedTo { _id firstname lastname }
      callbackDate
      quoteBookingDate
    }
    quote {
      quoteNumber
      date
      status
      deferralDate
      c_total
      c_deposit
      depositPercentage
      consentFee
      quoteNote
      quoteResultNote
      extras { name price }
      wall {
        SQMPrice
        SQM
        c_RValue
        c_bagCount
        cavityDepthMeters
      }
      ceiling {
        SQMPrice
        SQM
        RValue
        downlights
        c_bagCount
      }
      files_QuoteSitePlan
    }
    ebaForm {
      complete
      signature_assessor { fileName }
    }
    client {
      _id
      contactDetails {
        name
        email
        phoneMobile
        phoneSecondary
        streetAddress
        suburb
        city
        postCode
      }
      billingDetails {
        name
        email
        phoneMobile
        streetAddress
        suburb
        city
        postCode
      }
    }
  }
}
```

---

## 5. Proven nested shapes

## 5.1 `lead`

### Proven fields
- `leadStatus`
- `leadSource`
- `allocatedTo`
  - `_id`
  - `firstname`
  - `lastname`
  - `email` also observed in some ad-hoc queries
  - `role` also observed in some ad-hoc queries
- `callbackDate`
- `quoteBookingDate`
- `allocation` observed in live create/clone work
- `message` observed in live create/clone work

### Lead status values observed
- `NEW`
- `ALLOCATED`
- `BOOKED`
- `DEAD`
- `ON_HOLD`

### UI normalization
- UI commonly maps `ON_HOLD` → `CALLBACK`

### Important note on create/update shape
`CreateJobInput.lead` is tenant/schema-sensitive enough that payloads written from memory are risky.

Observed during live recreate flow:
- `allocatedTo` needed object shape, not just a bare string in at least one working create path:
  - `allocatedTo: { _id: ... }`
- `leadSource` appeared to accept an array in that tenant path
- `allocation` was present and used

Practical rule:
- verify the exact expected lead input shape from current live behavior before composing `createJob` payloads

---

## 5.2 `client`

### Proven shape
```graphql
client {
  _id
  contactDetails {
    name
    email
    phoneMobile
    phoneSecondary
    streetAddress
    suburb
    city
    postCode
    lotDPNumber
  }
  billingDetails {
    name
    email
    phoneMobile
    phoneSecondary
    streetAddress
    suburb
    city
    postCode
    lotDPNumber
  }
  billingSameAsPhysical
}
```

### Notes
- `billingSameAsPhysical` is observed in live clone/recreate work
- `lotDPNumber` has been observed live
- current repo queries do not request every client field the API likely exposes

---

## 5.3 `quote`

### Proven fields
- `quoteNumber`
- `date`
- `status`
- `deferralDate`
- `c_total`
- `c_deposit`
- `depositPercentage`
- `consentFee`
- `c_gst`
- `c_contractPrice`
- `quoteNote`
- `quoteResultNote`
- `totalOverridden`
- `depositOverridden`
- `sendFollowupEmail`
- `sendFollowupText`
- `files_QuoteSitePlan`
- `extras[]`
  - `name`
  - `price`
- `wall`
  - `SQMPrice`
  - `SQM`
  - `cavityDepthMeters`
  - `c_RValue`
  - `c_bagCount`
  - `internal`
- `ceiling`
  - `SQMPrice`
  - `SQM`
  - `RValue`
  - `downlights`
  - `c_thickness`
  - `c_bagCount`

### Quote status values observed
- `UNSET`
- `ACCEPTED`
- `DECLINED`
- `DEFERRED`

### Critical behavior: full quote payloads
For `updateJob` on quote data, partial payloads are unsafe.

Proven behavior:
- trying to update only `quote.status` can fail validation or silently not do what is intended
- safer pattern is to send the full quote subobject with all relevant nested fields copied from the current job, then change only the intended field

### Critical behavior: quote send path
To avoid split-state jobs:
- sending a quote while still in `stage: QUOTE` should not preserve `quote.status: ACCEPTED`
- current UI forces `quote.status = UNSET` in the send path

### Critical behavior: `quoteResultNote`
Observed as effectively required in some update flows.
Safe default when absent:
- `quoteResultNote: ""`

---

## 5.4 `ebaForm`

### Proven partial shape
Observed directly in repo and live clone work:
- `complete`
- `clientApproved`
- `clientApprovedAt`
- `nameOfOwners`
- `proofOfOwnership`
- `bcaOrTa`
- `lotOrDPNumber`
- `date`
- `address`
- `propertySiteSection`
- `propertySiteExposure`
- `propertySiteArea`
- `approximateYearOfConstruction`
- `numberOfStories`
- `roofAndEavesCol1`
- `roofAndEavesCol2`
- `roofAndEavesCol3`
- `foundationAndFloor`
- `framing`
- `joinery`
- `lining`
- `buildingPaper`
- `exteriorCladding`
- `claddingType`
- `claddingTypeInstalledVia`
- `finishOfCladding`
- many clause/compliance booleans and work-required text fields
- photos/signatures, e.g.
  - `photos_elevation_north { fileName thumbnail }`
  - `photos_elevation_south { fileName thumbnail }`
  - `photos_elevation_east { fileName thumbnail }`
  - `photos_elevation_west { fileName thumbnail }`
  - `photos_foundation { fileName thumbnail }`
  - `photos_maintenance { fileName thumbnail }`
  - `signature_assessor { fileName thumbnail }`
  - `signature_conformityToCodeMarkCert { fileName thumbnail }`
  - `clientApproval_signature_propertyOwners { fileName thumbnail }`

### Proven save mutation
There is a dedicated mutation path:
```graphql
mutation SaveEBA($input: UpdateJobInput!, $isDraft: Boolean) {
  saveEBA(input: $input, isDraft: $isDraft) {
    _id
    ebaForm {
      complete
      clientApproved
    }
  }
}
```

### Copying / clone safety
When copying EBA between jobs, excluded fields have included:
- `_id`
- `address`
- `complete`
- `clientApproved`
- `clientApprovedAt`
- `clientApproval_signature_propertyOwners`

---

## 5.5 `installation`

### Proven shape
```graphql
installation {
  installDate
  installNote
}
```

### Proven behavior
- `installation` exists on jobs even outside installation stages
- many jobs have:
  - `installation.installDate = null`
  - `installation.installNote = ""`
- future work calendars / exports should use:
  - `installation.installDate`

### Important observation
Future install jobs are not always strictly `stage: INSTALLATION`
We have observed at least one future `installation.installDate` on a job currently in `stage: INVOICE`.

Practical implication:
- if you mean “future installations”, filter by `installation.installDate > now`
- optionally include all stages, or explicitly include stage in the export so downstream users can see the mismatch

---

## 5.6 Email logs

### Proven query
```graphql
query($skip:Int,$limit:Int){
  listEmailLogs(skip:$skip,limit:$limit){
    total
    results{
      createdAt
      type
      subject
      to_email
      messageId
    }
  }
}
```

### Proven fields
- `createdAt`
- `type`
- `subject`
- `to_email`
- `messageId`

### Proven non-fields
Validation errors proved these are not queryable on `EmailLogSchema`:
- `status`
- `error`
- `message` (validation hinted `messageId` instead)
- `provider`
- `response`

### Notes
- `listEmailLogs.total` is large and supports pagination
- useful for proving sends happened, but not for extracting detailed provider failure state from the current schema

---

## 6. Proven mutation shapes

## 6.1 `updateJob`

### Proven generic form
```graphql
mutation UpdateJob($input: UpdateJobInput!) {
  updateJob(input: $input) {
    _id
  }
}
```

### Proven usage areas
`UpdateJobInput` has been used successfully for:
- `stage`
- `notes`
- `lead`
- `quote`
- `sitePlanNotes`
- `ebaForm`

### Current repo mutations
- `UPDATE_JOB_LEAD`
- `UPDATE_JOB_STAGE`
- `UPDATE_JOB_NOTES`
- `UPDATE_JOB_QUOTE`

### Important note
This is the workhorse mutation, but input requirements are strict enough that payloads should be built from current live data, not from memory.

---

## 6.2 `updateJob(... emailQuoteToCustomer, quotePDFEmailBodyTemplate)`

### Proven mutation shape
```graphql
mutation UpdateJobQuote(
  $input: UpdateJobInput!,
  $emailQuoteToCustomer: Boolean,
  $quotePDFEmailBodyTemplate: String
) {
  updateJob(
    input: $input,
    emailQuoteToCustomer: $emailQuoteToCustomer,
    quotePDFEmailBodyTemplate: $quotePDFEmailBodyTemplate
  ) {
    _id
    stage
    quote { ... }
  }
}
```

### Proven behavior
- same `updateJob` mutation handles normal quote saves and quote emailing
- emailing is triggered by extra top-level args:
  - `emailQuoteToCustomer: true`
  - `quotePDFEmailBodyTemplate: <html/text>`

### Related query
```graphql
query($input: UpdateJobInput!) {
  getQuotePDFEmailBody(input: $input)
}
```

Used to fetch the default email body before sending a quote.

---

## 6.3 `archiveJob`

### Proven mutation
```graphql
mutation ArchiveJob($_id: ObjectId!) {
  archiveJob(_id: $_id)
}
```

### Proven return type behavior
- returns a boolean scalar
- do not select subfields on it

### Safe production pattern
- update note first
- archive second
- verify `archivedAt` afterward

---

## 6.4 `createJob`

### Proven mutation
```graphql
mutation CreateJob($input: CreateJobInput!) {
  createJob(input: $input) {
    _id
    jobNumber
    stage
    client { contactDetails { name phoneMobile email } }
  }
}
```

### Proven behavior
- can create jobs successfully
- quote data is **not** part of the create path we have successfully used
- safe pattern has been:
  1. create base job
  2. update quote separately with `updateJob`
  3. update/save EBA separately

### Important caution
`CreateJobInput.lead` shape has drifted enough across live debugging that it must be treated as schema-sensitive.
Do not compose it from memory.

---

## 6.5 `sendEBAEmail`

### Proven mutation
```graphql
mutation SendEBA($jobId: ObjectId!) {
  sendEBAEmail(jobId: $jobId)
}
```

### Notes
- current repo uses this as a dedicated EBA email send path
- exact scalar/object return type has not been heavily documented here because UI only needs success/failure behavior

---

## 6.6 Files

### Proven mutations
```graphql
mutation AddFiles($_id: ObjectId!, $documentType: UploadedFileType!, $fileNames: [String!]!) {
  addFiles(_id: $_id, documentType: $documentType, fileNames: $fileNames)
}
```

```graphql
mutation RemoveFile($_id: ObjectId!, $documentType: UploadedFileType!, $fileName: String!) {
  removeFile(_id: $_id, documentType: $documentType, fileName: $fileName)
}
```

### Notes
- `UploadedFileType` enum exists
- exact enum members not documented here yet

---

## 6.7 Client update

### Proven mutation
```graphql
mutation UpdateClient($_id: ObjectId!, $input: UpdateClientInput!) {
  updateClient(_id: $_id, input: $input) {
    _id
  }
}
```

### Notes
- `UpdateClientInput` exists
- exact full input shape not fully documented in this file yet

---

## 7. Proven practical filters and exports

## 7.1 Future quote bookings
Filter used successfully:
- `lead.quoteBookingDate != null`
- `new Date(lead.quoteBookingDate) > now`

Current live result at time of last check:
- only a small set of jobs matched

Important note:
- this is **quote booking date**, not future installation work

## 7.2 Future installations
Filter used successfully:
- `installation.installDate != null`
- `new Date(installation.installDate) > now`

Current live result at time of last check:
- significantly larger list than quote bookings

---

## 8. Known sharp edges / schema lessons

## 8.1 Introspection-disabled workflow
Because introspection is off, the safest workflow is:
1. read current repo query/mutation shape
2. fetch current live object state
3. test field existence with small live queries
4. only then write payloads

## 8.2 Full-payload updates beat partial-memory updates
Especially for:
- `quote`
- complex `lead` payloads
- clone/recreate flows

## 8.3 Split-state bugs are real
A job can land in logically inconsistent states such as:
- `stage: QUOTE`
- `quote.status: ACCEPTED`

The UI now guards some of this, but recovery still requires explicit state correction.

## 8.4 Stage and operational date can diverge
Example observed:
- future `installation.installDate`
- but job stage already `INVOICE`

So stage alone is not enough for operational scheduling views.

---

## 9. Recommended schema-discipline rules for this repo

If you are about to write or change any GraphQL mutation payload:

1. Read the current UI query/mutation usage first
2. Read the live object you are about to mutate
3. Record schema evidence before sending anything:
   - where the shape came from
   - exact fields being sent
4. Prefer full nested payloads over minimal partial guesses
5. Verify before/after from the same source

Suggested evidence line format:
- `Schema evidence: <where read: file/URL/query> | fields: <exact input field list being sent>`

---

## 10. Good candidate follow-up investigations

These would improve this file further:
- document `UpdateJobInput` field list more exhaustively
- document `CreateJobInput` field list more exhaustively
- document `UpdateClientInput`
- document `UploadedFileType` enum members
- document richer `ebaForm` field list from current UI source in a generated appendix
- capture a known-good installation update mutation if the UI later supports editing install data

---

## 11. Sources used for this file

Repo files:
- `/src/lib/queries.ts`
- `/src/lib/mutations.ts`
- `/src/lib/graphql.ts`

Workspace notes:
- `/root/.openclaw/workspace-jonas/notes/insulhub/README.md`
- `/root/.openclaw/workspace-jonas/notes/insulhub/MUTATION_DEBUG_CHECKLIST.md`

Live API probes performed on 2026-03-09 against production:
- `jobs(...)` with `installation { installDate installNote }`
- `listEmailLogs(...) { createdAt type subject to_email messageId }`
- validation probing for unavailable email-log fields
- previous live clone/recreate and quote recovery work
