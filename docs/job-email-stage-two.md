# Job email — stage two

Adds “Send email from CRM” beside the manual Email option on a job. Uses active, connected Gmail accounts from campaign Senders, templates and their saved Gmail signatures. The existing CRM messaging switch controls both job SMS and email. The master switch uses `job_sms_enabled`; optional `job_crm_test_user` limits sending to one authenticated account. Both options are hidden and new sends are blocked when off. Account-only testing can be selected while off, then enabled. Existing saved attempts can still be read without being resent. Manual Text/Email and CRM SMS remain available.

The server verifies job access, the authenticated staff member and the current contact email. It inserts an immutable attempt before contacting Gmail. A unique attempt ID prevents duplicate submission across clicks, concurrent requests and recovery. The selected connection must authorise the From address; no fallback account is used.

History retains staff identity, recipient, From address, subject, original body, rendered plain/HTML content including the signature, template title, timestamps, outcome, RFC Message-ID and Gmail message/thread identifiers. Sender deletion does not remove history. HTML previews are sandboxed with a restrictive content security policy.

Pressing Send closes the composer immediately and shows Sending in Sent Communications, followed by the confirmed result. Only an actual failure or uncertain outcome reopens the composer. The editable message is shown once; the saved signature is added automatically and the full signed email can be viewed in history. This is not a delivery/read receipt. Explicit rejection is Failed. Timeouts, ambiguous responses and interrupted persistence remain unconfirmed and never trigger automatic resend. A short read-only CRM lookup reconciles delayed responses. Staff must check Gmail’s Sent folder before clearing an uncertain attempt. Incoming replies and attachments are outside this stage.

## Deployment and checks

The guarded production build runs `npm run job-email:migrate` to add open tracking fields and an index to the CRM overlay. For a development database, run the migration manually before opening job communications. New emails sent directly from the job page use `CAMPAIGN_OPEN_TRACKING_ORIGIN` as their public HTTPS origin, with the production CRM URL as the production default. The saved message preview excludes the tracking image. The Communications list shows Opened after a likely open and Likely unopened while the count is zero. Expanding a message shows the count and last detected time. Emails sent without a tracking image show that open tracking is unavailable in their details.

- `npm run test:job-email`
- `npm run test:job-sms`
- `npm run test:communications`
- `npx vitest run src/lib/partner/account-email.test.ts`
- `npm run build`
- Start a local production preview on port 3109; run `node scripts/job-email-browser-smoke.cjs`. All business APIs are mocked, including sends.

Production acceptance: use a job whose contact email belongs to you. Send an edited template; check From, subject, message, signature, CRM history, fresh compose and refresh without duplicate sending. Confirm manual Email still opens your mail app. Reply capture will be a separate stage.
