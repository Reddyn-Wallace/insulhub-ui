# Partner portal live-transfer record and recovery

The first live transfer has already been completed and reviewed: the labelled pilot submission created InsulHub job **#28859**, including its quote and floor-plan PDF. Do not create a second production test lead merely to verify deployment.

## Normal operation

1. A completed partner quote freezes as immutable snapshot schema v2.
2. The Submit request immediately creates the lead, writes the full quote and uploads completed floor-plan PDFs using the company’s server-only InsulHub credential.
3. The portal stores the returned InsulHub ID/job number, locks editing, and sends the configured internal notification once.
4. Linked status reads EBA completion, installation date and job completion from InsulHub. Staff can add plain partner-visible updates from the normal job screen.

## If a transfer does not complete

The partner sees a generic message telling them to contact the InsulMAX team. Staff do not retry or reconcile the remote create in the UI. This avoids duplicate leads after an ambiguous network response.

If staff establish that the portal job must be completed manually:

1. Create or locate the correct job in InsulHub.
2. In Settings → Partners → Jobs, open the submitted portal job.
3. Preview the existing InsulHub job by number, ID or link and verify the customer/property.
4. Confirm the link. The global mapping is one-to-one and the same confirmation is idempotent.

Never guess a link or rerun a remote create after dispatch evidence exists. Preserve the immutable quote, drawings, submission snapshot and transfer receipts.

## Production prerequisites

- The disposable PostgreSQL gate passes all migrations through **020**, including full rollback/reapply, restricted-role probes, historic schema-v1 readback and fresh schema-v2 freeze/readback.
- Runtime, Settings/operations and submission processing use distinct restricted database logins; the migration owner is not used by the application.
- Only HTTPS `https://api.insulhub.nz/graphql` is allowed for company credentials, which remain encrypted server-side.
- The internal notification recipient is configured in Settings → Partners and email is sent through the existing connected InsulHub mailbox.
- The Vercel function has enough duration for the bounded submission transfer. There is no Cloudflare or cron dependency for partner jobs.
