# Bulk Email & SMS Campaigns MVP Build Plan

Source: `InsulHub_Bulk_Email_SMS_MVP_Product_Build_Proposal (1).docx`

Last updated: 2026-06-18

## Product Direction

Build a controlled bulk communications tool inside InsulHub for targeted email and SMS campaigns based on existing job records. The MVP should prioritize safe recipient selection, duplicate prevention, test sends, delivery guardrails, and job-level sent communication history.

This is not a marketing automation platform. Out of scope for MVP: open/click tracking, attribution reporting, drip campaigns, A/B testing, a full CRM/contact model, and complex suppression management.

## Clarified Decisions

- Initial implementation may use stubbed test/send actions to move quickly, but real Gmail and SMSgate sending must be included before MVP completion.
- Campaign audiences will use existing job records only.
- Duplicate detection is based only on the selected channel destination: duplicate email addresses for email campaigns and duplicate phone numbers for SMS campaigns.
- First audience filters are status, salesperson, and quote date range.
- Campaigns should live as their own section under the existing More navigation.

## Build Chunks

### Chunk 1: Campaigns Section and Draft Campaign Foundation

What will be built:
- Add Campaigns under the More navigation.
- Add a Campaigns page with a previous campaigns list shell.
- Add a New Campaign entry point.
- Persist basic draft campaigns with campaign name and channel.
- Store campaigns in the overlay database so later chunks can attach audience, sender, message, and recipient records.

User flow supported:
- User opens More > Campaigns.
- User sees existing campaigns or an empty state.
- User starts a new campaign by entering a name and choosing Email or SMS.
- User lands back on the Campaigns list with the new draft visible.

What to test:
- More menu contains Campaigns.
- Campaigns page loads for an authenticated user.
- New Campaign opens.
- Creating an Email draft works.
- Creating an SMS draft works.
- Drafts appear in the list with name, channel, status, and recipient count.

Done means:
- The route, navigation, API, and persistence are in place.
- Draft campaigns survive page refresh.
- No audience selection, sending, or template editing is included yet.
- Lint/build checks pass or any blockers are documented.

Assumptions and decisions:
- Campaigns are stored in the local overlay database because existing contact templates/settings already use it.
- Sender, audience, message, and delivery status fields are left nullable or defaulted for later chunks.
- Send actions remain unavailable in this chunk.

Status:
- Completed 2026-06-18.

### Chunk 2: Audience Builder Filters and Job Results

What will be built:
- Add the first guided campaign detail step for audience selection.
- Load jobs from existing job GraphQL data.
- Filter by job status, salesperson, and quote date range.
- Show matched jobs/recipients with selectable rows.
- Save selected job recipients against the campaign draft.

User flow supported:
- User opens a draft campaign.
- User applies the required MVP filters.
- User reviews matching job recipients.
- User unticks recipients before continuing.

What to test:
- Status filtering changes results.
- Salesperson filtering changes results.
- Quote date range filtering changes results.
- Selected/deselected recipients persist after saving.
- Jobs with missing channel contact detail are clearly excluded or warned.

Done means:
- A campaign can have a saved audience from job records.
- The UI shows matched count and selected count.
- No sending is possible yet.

Assumptions and decisions:
- Region is not included in the first MVP filter set.
- Job contact detail comes from `client.contactDetails.email` or `client.contactDetails.phoneMobile` based on channel.

Status:
- Completed 2026-06-18.

### Chunk 3: Duplicate Detection and Audience Blocking

What will be built:
- Detect duplicate email or phone values inside the selected audience.
- Highlight duplicate rows.
- Block progression while duplicate destination values remain selected.
- Show summary counts: matched jobs, selected recipients, duplicates, and exclusions.

User flow supported:
- User reviews audience safety issues before message setup.
- User resolves duplicates by deselecting extra rows.

What to test:
- Duplicate email addresses are highlighted in email campaigns.
- Duplicate phone numbers are highlighted in SMS campaigns.
- Continue/save-next is blocked while duplicate destinations are selected.
- Blocking clears when duplicates are resolved.

Done means:
- Duplicate safety rule is enforced before message/template work.

Assumptions and decisions:
- Duplicate comparison normalizes case/whitespace for email and common phone spacing characters for SMS.

Status:
- Completed 2026-06-18.

### Chunk 4: Sender Settings and Stub Sender Selection

What will be built:
- Add Communications settings for sender records.
- Support Email sender and SMS sender records with default selection.
- Provide stub reconnect/test-send actions for initial UI wiring.
- Add sender selection to campaign drafts.

User flow supported:
- User configures at least one sender per channel.
- User selects a sender for a campaign.
- User cannot progress if no sender exists for the campaign channel.

What to test:
- Sender records can be created/edited/disabled.
- Default sender is available when starting a campaign.
- Campaign blocks progression when no channel-appropriate sender exists.

Done means:
- Sender configuration and selection are persisted.
- Real provider credentials are not required yet, but the data model supports them later.

Assumptions and decisions:
- Stub sender actions are temporary and must be replaced by real Gmail/SMSgate integration before MVP completion.

Status:
- Completed 2026-06-18.

### Chunk 5: Template Selection, Campaign Message Editing, Preview, and Test Stub

What will be built:
- Reuse existing contact templates for email and SMS.
- Copy selected template subject/body onto the campaign.
- Allow campaign-specific edits without changing the saved template.
- Render preview using a selected recipient/job.
- Add test-send stub to a supplied email or phone number.
- Show SMS character count and estimated segment count.

User flow supported:
- User selects a template.
- User edits the campaign copy.
- User previews merge fields against a real job recipient.
- User sends a test via stub action.

What to test:
- Template selection copies content into the campaign draft.
- Edits persist only on the campaign.
- Merge fields render for selected recipients.
- Email requires subject/body.
- SMS requires body and shows count/segments.

Done means:
- Campaign content can be finalized and previewed safely.
- Test send is wired to a stub event until real providers are implemented.

Assumptions and decisions:
- Exact sent records must later store rendered subject/body per recipient, not just template ids.

Status:
- Completed 2026-06-18.

### Chunk 6: Confirm Send, Queue Model, and Stub Delivery

What will be built:
- Add final confirmation screen with campaign summary.
- Enforce unresolved duplicate, missing sender, missing content, and zero-recipient blockers.
- Add delivery limit settings for send hours, SMS-per-minute, and email-per-day.
- Create campaign recipient records and exact rendered message snapshots.
- Implement stub sending that marks recipients sent/skipped/failed for review.
- Add emergency halt state for sending campaigns.

User flow supported:
- User reviews final campaign safety summary.
- User confirms send.
- User sees campaign move from Draft to Sending/Sent using stub delivery.

What to test:
- Confirm screen blocks unsafe campaigns.
- Final recipient records are created with exact rendered message content.
- Stub send updates campaign and recipient statuses.
- Halt stops a sending campaign from continuing.

Done means:
- End-to-end MVP flow works without real external sends.
- Delivery schedule rules are represented and visible.

Assumptions and decisions:
- Stub delivery is not MVP-complete until replaced by real provider sends.

Status:
- Completed 2026-06-18.

### Chunk 7: Campaign Detail and Job Sent Communications

What will be built:
- Campaign detail summary page.
- Recipient table with contact, linked job, channel, status, sent time, and failure reason.
- Exact message view for each recipient.
- Job page Sent Communications section showing campaign communications linked to that job.

User flow supported:
- User audits what happened in a campaign.
- Staff can open a job and confirm exactly what was sent.

What to test:
- Campaign detail shows correct recipient statuses.
- Exact sent message opens from campaign detail.
- Job page shows linked campaign communications.
- Job page allows exact sent content to be viewed without losing job context.

Done means:
- Job-level visibility acceptance criteria are satisfied for stubbed delivery records.

Assumptions and decisions:
- The final sent record stores rendered content per recipient to avoid template drift.

Status:
- Completed 2026-06-18.

### Chunk 8: Real Gmail and SMSgate Sending

What will be built:
- Replace stub sender actions with real Gmail and SMSgate send paths.
- Connect/reconnect/disconnect provider flows as required by available APIs.
- Enforce send hours and limits during actual delivery.
- Preserve exact message snapshots and provider response/failure details.

User flow supported:
- User sends real email and SMS campaigns from configured senders.
- Delivery respects the configured guardrails.

What to test:
- Gmail sender can be connected and sends real test/campaign email.
- SMSgate sender can be connected and sends real test/campaign SMS.
- Failures are recorded per recipient.
- Send limits and windows are respected.

Done means:
- Stub send paths are replaced or clearly disabled in production.
- MVP can send real targeted campaigns safely.

Assumptions and decisions:
- Provider credentials/API details may still affect final production hardening.
- Provider setup should be handled from Settings, not by asking ordinary users to edit server environment variables.

## Completed Work Log

### Chunk 1 Completed 2026-06-18

What was completed:
- Added Campaigns as its own item under the existing More navigation.
- Added `/jobs/campaigns` with campaign summary counts, empty state, and draft campaign list.
- Added `/jobs/campaigns/new` with campaign name and Email/SMS channel selection.
- Added `/api/campaigns` with authenticated GET and POST endpoints.
- Added the `campaigns` overlay database table for draft persistence.

Implementation notes worth remembering:
- Campaign records currently store draft-level metadata only: name, channel, status, sender label, recipient count, created/sent fields, and timestamps.
- Campaign audience, sender selection, message content, recipient records, and delivery logs are intentionally not implemented yet.
- The campaigns table lives in the existing overlay database via `ensureOverlaySchema()`.

Decisions made:
- Campaign status values include `draft`, `pending`, `sending`, `sent`, `failed`, and `halted` so later chunks can support the proposal's states plus emergency halt.
- The campaign list shows "Details later" instead of linking to an incomplete campaign detail page.

Issues or follow-up items:
- Project-wide `npm run lint` is currently blocked by pre-existing unrelated lint errors in job pages. The files touched for Chunk 1 pass targeted ESLint.
- Real campaign details, audience selection, duplicate blocking, sender setup, template preview, and sending remain follow-up chunks.

### Chunk 2 Completed 2026-06-18

What was completed:
- Added campaign detail route `/jobs/campaigns/[id]` with an Audience step.
- Added job filters for status, salesperson, and quote date range.
- Loaded audience candidates from existing job records only.
- Used campaign channel to choose recipient destination: email address for email campaigns, mobile number for SMS campaigns.
- Added manual recipient selection/deselection.
- Added matched, excluded, selectable, and selected summary counts.
- Added saved audience persistence through `/api/campaigns/[id]`.
- Added `campaign_recipients` overlay database table with job/contact snapshots.
- Linked the Campaigns list rows to the campaign detail page.

Implementation notes worth remembering:
- Status filtering currently uses the job `stage` values available in the app: Lead, Quote, Scheduled, Installation, and Invoice.
- Jobs missing the selected channel destination are counted as excluded and cannot be selected.
- Saved audience rows are snapshots of the selected job/contact data, not just IDs.
- Filters themselves are not persisted yet; only selected recipients are persisted.
- Audience building is additive: applying filters creates temporary results, then `Add Selected to Audience` adds those rows to the saved audience without removing prior recipients.
- Previously saved recipients are marked as already in the audience when they appear in later filter results.
- Saved audience review/removal lives on `/jobs/campaigns/[id]/audience`.

Decisions made:
- The first audience detail page stays focused on recipient selection and does not introduce a multi-step wizard shell yet.
- The bottom saved audience preview was removed because it duplicated the result list and could be cut off.
- Summary cards were simplified to current results, selected to add, and saved audience.
- Jobs missing email/mobile are shown as a warning instead of a main summary card.
- Lead filters now include New, Callback, Quote booked, and Dead.
- Quote filters now include Open, Callback, and Dead.

Issues or follow-up items:
- Duplicate detection and blocking are not implemented yet and are the next chunk.
- Full project TypeScript passes. Targeted ESLint passes for the campaign files.

### Chunk 3 Completed 2026-06-18

What was completed:
- Made saved audience navigation more obvious with a dedicated panel and `Review Audience` / `Resolve Duplicates` button above the filters.
- Added duplicate detection against the saved campaign audience.
- Added duplicate normalization for email addresses and SMS phone numbers.
- Added duplicate warnings on the campaign builder.
- Added audience status messaging: no audience, ready, or blocked by duplicates.
- Highlighted duplicate saved audience rows on the dedicated audience page.
- Kept manual duplicate resolution inside the audience page by removing extra recipients.

Implementation notes worth remembering:
- Duplicate checks evaluate the saved audience only, not the current temporary filter result.
- Email duplicate matching trims and lowercases addresses.
- SMS duplicate matching lowercases and removes spaces, parentheses, periods, and hyphens.
- There is no sender/message step yet, so blocking is represented as status and warning UI rather than a disabled next-step button.

Decisions made:
- Duplicate rows are resolved by removing recipients from `/jobs/campaigns/[id]/audience`.
- The primary builder button changes to `Resolve Duplicates` when duplicate destinations exist.

Issues or follow-up items:
- If phone numbers include country-code variants such as `027...` vs `+6427...`, current normalization may not treat them as duplicates.
- Sender setup is next.

### Audience Management Revision Completed 2026-06-18

What was completed:
- Simplified builder navigation so the saved audience has one clear management entry point.
- Removed the redundant saved-audience summary card from the builder.
- Added duplicate-only filtering on the saved audience page.
- Added checkbox selection, select/clear visible, and bulk remove on the saved audience page.
- Changed audience writes from one database insert per recipient to a single bulk JSON-backed upsert.
- Changed bulk recipient removal to a single API/database operation.
- Cached overlay schema initialization per server process so API requests do not re-run all schema checks.
- Added in-flight and longer-lived auth caching for overlay API routes to reduce repeated slow auth checks.

Implementation notes worth remembering:
- Large audience add operations should now be dominated by one API request plus one bulk database upsert, not hundreds or thousands of round trips.
- Audience GET still returns all saved recipients for the campaign; this is acceptable for MVP scale but could need server-side pagination if lists grow much larger.
- Bulk remove sends recipient ids in the DELETE request body.

Decisions made:
- Duplicate remediation happens on the saved audience page using duplicate-only filtering plus multi-remove.
- The builder keeps only current filter result counts; saved audience management is handled by the dedicated audience panel/page.

Issues or follow-up items:
- If loading is still slow after this, the next likely bottleneck is remote auth or returning full recipient lists; add route-level timing logs before changing UX further.

### Chunk 4 Completed 2026-06-18

What was completed:
- Added `communication_senders` overlay database table.
- Added `sender_id` and `sender_label` campaign fields.
- Added `/api/communication-senders` list/create endpoint.
- Added `/api/communication-senders/[id]` update/delete/test-stub endpoint.
- Added Communications section in Settings for Email and SMS senders.
- Added sender create, default selection, enable/disable, and stub test controls.
- Added sender selection to the campaign builder.
- Added no-sender warning and status blocking copy on campaign setup.
- Added direct Settings link from campaigns to `Settings > Communications` for the current channel.

Implementation notes worth remembering:
- Sender providers currently use `stub`; provider enum allows `gmail` and `smsgate` for later real integration.
- Stub test only updates `last_tested_at` and returns a success message. It does not send externally.
- Campaign sender save stores both sender id and a human-readable sender label snapshot.

Decisions made:
- Sender management lives inside existing Settings rather than a separate top-level page.
- Campaign sender selection is independent from audience state but shown before audience filters so missing sender is obvious.

Issues or follow-up items:
- Real Gmail/SMSgate connect/reconnect/disconnect flows are still pending for the real-send chunk.
- Sender deletion currently deletes the sender record; future production behavior may prefer disable-only once campaigns have sent records.

### Chunk 5 Completed 2026-06-18

What was completed:
- Added campaign message fields: `template_id`, `message_subject`, `message_body`, and `test_sent_at`.
- Added template selection on the campaign builder using existing email/SMS contact templates.
- Selecting a template copies subject/body onto the campaign draft for campaign-specific editing.
- Added email subject editing and email/SMS body editing.
- Added SMS character count and segment estimate.
- Added rendered preview using a selected saved audience recipient.
- Added merge field rendering for common placeholders: customer name, first name, job number, address, salesperson, and quote date.
- Added stub test-send control requiring a test email address or phone number.
- Added save message and test-stub persistence through the campaign API.

Implementation notes worth remembering:
- Template edits on the campaign do not update the saved template.
- Unknown merge fields are left unchanged in the preview so missing/unsupported placeholders are visible.
- Test send is still a stub; it stores `test_sent_at` and shows success text only.
- Preview recipient list currently uses the first 200 saved recipients to keep the selector manageable.

Decisions made:
- Message setup lives on the campaign builder page for now, below sender and saved audience status.
- Test send validates that subject/body exists for email and body exists for SMS before marking a stub success.

Issues or follow-up items:
- Exact rendered message snapshots per recipient are still pending for the confirm/send chunk.
- More merge fields may be needed once final campaign copy is tested with real templates.

### Campaign Builder Layout Refactor Completed 2026-06-18

What was completed:
- Converted `/jobs/campaigns/[id]` into a compact campaign builder checklist.
- Moved audience filtering/results/add-to-audience into `/jobs/campaigns/[id]/audience-builder`.
- Kept saved audience review/removal at `/jobs/campaigns/[id]/audience`.
- Moved template selection, message editing, preview, and test stub into `/jobs/campaigns/[id]/message`.
- Main builder now summarizes sender, audience, message, and confirm readiness with clear action buttons.

Implementation notes worth remembering:
- The audience builder subpage owns the large filter/results table.
- The audience builder subpage intentionally does not show sender setup; sender remains on the main builder only.
- The message subpage owns the large editor/preview/test surface.
- Sender selection remains on the main builder because it is compact and controls setup readiness.
- Confirm remains on the main builder until Chunk 6.

Decisions made:
- Large task surfaces should live on campaign subpages instead of expanding the main builder.
- The main builder is now the orientation and readiness page for the whole campaign.
- Audience review backs up to the audience builder, not the campaign builder, because it is part of the audience-building subflow.
- Test sending is handled only inside the message page and is not a separate main builder checklist item.

### Chunk 6 Completed 2026-06-18

What was completed:
- Added confirmation modal on the campaign builder.
- Added final modal summary for channel, sender, and recipient count.
- Added safety blockers for missing sender, empty audience, duplicate recipients, missing subject/body, and already-sent campaigns.
- Added stub send action from the confirmation modal.
- Added recipient snapshot fields for exact rendered subject/body, sent time, status, and failure reason.
- Stub delivery renders merge fields per recipient, stores exact rendered message snapshots, marks recipients as sent, and marks the campaign as sent.
- Main builder opens the confirmation modal once setup is ready.

Implementation notes worth remembering:
- Stub delivery uses the same merge fields as preview: customer name, first name, job number, address, salesperson, and quote date.
- Stub send blocks if duplicate destination values still exist in the saved audience.
- Sent campaigns cannot be sent again through the confirm page.
- This does not send externally; it creates the audit trail that real sending will later use.

Decisions made:
- Confirm/send is a modal on the main builder, not a separate route.
- Test sending remains part of the message page and is not required by the main builder readiness check.

Issues or follow-up items:
- Delivery limits and send windows are represented conceptually only; real queue scheduling remains part of real sending/provider integration.
- Real provider response ids and failure details still need to be captured during the real-send chunk.

### Chunk 7 Completed 2026-06-18

What was completed:
- Added a job-level API for campaign communications linked to a job.
- Added job-launched SMS/email logging when a user opens a template or no-template SMS/email composer from the job page.
- Added a Sent Communications audit section to the campaign builder after delivery records exist.
- Added an exact message viewer on the campaign page for each delivered recipient.
- Added a Sent Communications section near the top of each job detail page.
- Added a job-level exact message viewer with campaign, sender, recipient, status, subject, and body.
- Changed sent campaigns into a read-only audit view focused on delivery records.
- Blocked sender, message, audience, recipient removal, and repeat-send mutations for sent campaigns at the API layer.

Implementation notes worth remembering:
- Job-level communications come from `campaign_recipients` joined to `campaigns`.
- Job-launched communications come from `job_communication_logs`.
- Only non-pending recipient records are shown at job level: `sent`, `failed`, and `skipped`.
- The campaign page uses the rendered subject/body snapshots created during the stub send.
- Job-launched logs record what the selected template would have said, because SMS/mailto handoff does not confirm what the user actually sends afterward.
- The job page keeps the communications section visible above the Job Info / Quote Info tabs so staff do not need to hunt for it.
- Sent campaigns show delivery records first, followed by a read-only campaign snapshot.

Decisions made:
- Campaign audit stays on the campaign builder page for now instead of adding a separate campaign report route.
- Exact message content is shown in modals/bottom sheets rather than expanding rows inline.
- Job-launched no-template actions are recorded with no body content, because there is no known message draft at launch time.
- Once a campaign is sent, the builder no longer shows sender, audience, message, or confirm editing sections.

### Chunk 8 Started 2026-06-18

What was completed:
- Added a server-side delivery adapter for `stub`, `gmail`, and `smsgate` providers.
- Added Gmail delivery using the Gmail `users.messages.send` API with MIME content encoded as base64url.
- Added SMSGate delivery using the `/messages` enqueue endpoint.
- Added sender provider selection in Settings.
- Added Gmail OAuth connect flow from the Settings sender row.
- Simplified Gmail sender creation so users enter only the sender name, then click Connect. The Gmail account address is set by the Google connection.
- Added SMSGate setup fields directly in Settings using the phone app labels: Server address, username, password, and device ID.
- Added provider status check so Gmail Connect is disabled with immediate feedback when app-level Google OAuth has not been configured yet.
- Added channel/provider validation so Gmail is email-only and SMSGate is SMS-only.
- Added confirmed sender removal from Communications settings.
- Added inline editing for SMSGate sender details.
- Wired sender connection checks to happen as part of Connect/Reconnect flows instead of exposing a separate test action for live providers.
- Wired campaign message `Send Test` to send one real provider test to the entered destination.
- Changed campaign send to use the selected sender provider instead of always marking stub success.
- Added per-recipient sent/failed persistence based on provider responses.
- Added provider message id storage and display in delivery record details.
- Replaced remaining campaign-send UI copy that implied live provider sends were still stub-only.
- Added server-side live sender guardrails: real campaign sends require a connected sender and must be inside the configured NZ send window.
- Added in-app Communication Settings with the proposal-level guardrails: allowed send hours, SMS texts-per-minute, and email daily limit.
- Moved sender management into a separate Settings tab named Configure Senders.
- Added `/api/communication-settings` to save and load delivery guardrails from `overlay_settings`.
- Added queued campaign delivery: confirming a campaign now renders exact message snapshots, schedules recipients, and moves the campaign to `pending`.
- Added `/api/campaigns/[id]/process` to process due recipients in small batches, enforce send windows, enforce email daily limits, and update per-recipient delivery status.
- Added campaign halt support. Halting a pending/sending campaign marks remaining pending recipients as skipped.
- Updated the campaign page to show pending/sending/halted delivery records, manual Process Due, and Halt Campaign controls.
- Extracted queue processing into `src/lib/campaign-queue.ts` so manual and scheduled processing use the same delivery rules.
- Added a Cloudflare Worker (`insulhub-campaign-queue`) with a one-minute Cron Trigger to call `/api/cron/process-campaigns`.
- Added `CRON_SECRET` to Vercel and Cloudflare Worker secrets so the cron endpoint can reject unauthorized requests.
- Added delivery limits and estimated delivery timing to the campaign confirmation modal before queueing.
- Improved the Campaigns history page with queued campaign count and per-campaign sent/pending/failed/skipped delivery counts.
- Added provider disconnect/reconnect controls: Gmail can reconnect from the sender row, and connected Gmail/SMSGate senders can be disconnected without deleting the sender record.
- Added draft campaign deletion from the campaign builder, limited to draft campaigns.
- Clarified campaign sender save state: changing the sender selection now shows an unsaved state and blocks confirmation until saved.
- Changed the message editor Save Message action to return to the campaign builder after a successful save.
- Changed campaign sender loading copy so the missing-sender warning only appears after sender loading finishes.
- Simplified Configure Senders by removing default/disable controls and showing connect/reconnect or disconnect based on provider connection state.
- Changed SMSGate creation and edit save to test the gateway connection before marking the sender connected.
- Changed Gmail sender creation to start the Gmail OAuth connection immediately instead of leaving users to find the row action afterward.
- Changed delivery scheduling so the first campaign recipient has no spacing jitter and is due at the first allowed send moment.
- Changed campaign queueing to immediately process any recipients that are already due, so the first send can happen in the same action instead of waiting for cron/manual processing.
- Updated the confirmation modal estimate so one-recipient campaigns say the first message sends as soon as delivery starts rather than showing the full spacing interval.
- Changed new draft campaign creation to open the campaign builder for the created draft instead of returning to the campaign list.
- Added Deselect All to the audience builder results toolbar.
- Changed Gmail test and campaign sends to use the sender label from Configure Senders as the email display name in the `From` header.
- Added inline Gmail sender editing so the sender display name can be changed from Configure Senders.
- Gmail test and campaign emails append the synced Gmail signature stored on the sender.
- Replaced manual Gmail signature editing with Gmail signature sync. Reconnecting Gmail now requests signature-settings access, syncs the account's Gmail signature HTML, and stores it against the sender.
- Simplified live sender row actions to Connect/Disconnect, Edit, and Remove. Gmail Connect automatically tests the connection and syncs the Gmail signature.
- Changed Gmail OAuth callback to store the actual connected Gmail send-as address on the sender, avoiding mismatches between a typed address and the linked Gmail account.
- Changed Gmail email MIME generation to send multipart plain-text and HTML email when a Gmail HTML signature is present, so colours, links, and hosted signature images can render instead of exposing raw HTML.
- Changed new senders to save with no default sender state, and changed the campaign builder to start with a blank sender selection unless a sender was already saved on that campaign.
- Changed campaign email daily limit enforcement to be per sender across all campaigns.
- Updated campaign confirmation delivery limits to say email limits are per sender.
- Updated campaign delivery estimates to be duration based, including under-one-minute wording for small sends.
- Added more salesperson merge-field aliases for template preview and campaign test sends, including `{salesperson name}`, `{sales rep}`, and salesperson first-name variants.
- Changed the SMS test phone placeholder to a local NZ mobile example and clarified that local NZ mobile numbers are formatted automatically.
- Moved draft campaign deletion to the campaign list page.
- Added campaign archiving for sent campaigns from the campaign list.
- Added a View Archived mode on the campaign list with Unarchive actions.
- Replaced remaining browser-native campaign/settings confirmations with the shared system-styled `AppDialog`.
- Improved campaign list and sender settings actions so successful delete/archive/update/remove operations update local state instead of doing an immediate full reload.
- Changed archive eligibility from sent-only to any non-draft campaign so failed/approved campaigns can be archived.
- Added `{salesperson first name}` as a supported campaign/template merge field.
- Changed test email/SMS sends to render merge fields using the currently selected preview recipient.
- Normalized preview/test SMS destinations and SMSGate delivery destinations from local NZ mobile formats such as `027...` / `021...` to `+6427...` / `+6421...`.
- Made SMSGate sender phone/display number optional; SMSGate sends use the configured gateway/device credentials, not the display number.
- Added automated communication tests covering send-window scheduling, SMS spacing rollover, email daily rollover, Gmail signature/scope handling, Gmail MIME rendering, and SMSGate request normalization.
- Fixed delivery scheduling so long email/SMS queues consume time only inside allowed send windows. Recipients that would land exactly on or after the send-window end now roll to the next allowed window instead of becoming overdue and bunching up later.
- Removed Stub from the Configure Senders add flow. Email senders now add Gmail and SMS senders now add SMSGate.
- Moved Sent Communications into the Quote Info tab and collapsed it to the most recent communication by default, with a View more toggle for older records.
- Added merge-field name formatting so all-caps customer names render as readable name case in job and campaign communications.
- Cleared 4 archived campaign records from the overlay database; no archived campaign records remained after cleanup.

Implementation notes worth remembering:
- Gmail sender setup uses app-level Google OAuth client config; Connect Gmail stores access/refresh tokens on the sender.
- Gmail OAuth redirect URI is `/api/communication-senders/gmail/callback` on the current app origin. Sender id is carried in OAuth state.
- SMSGate sender setup stores the phone app's server address, username, password, and optional device ID on the sender.
- SMSGate hosted server addresses such as `api.sms-gate.app:443` are normalized to `https://api.sms-gate.app/3rdparty/v1`.
- SMSGate test connection validates the configured Device ID against `/devices` when provided.
- SMSGate sends retry without Device ID if SMSGate rejects the configured device as not found.
- Gmail connection tests now also require Gmail settings access because synced Gmail signatures depend on the Gmail send-as settings endpoint.
- Secrets are not returned by the sender APIs; public sender responses only include non-secret fields and boolean flags.
- Disconnecting a provider clears stored tokens/connection status but keeps the sender record for later reconnect.
- Draft campaign deletion uses the existing campaign-recipient cascade, so saved audience rows are removed with the draft.
- Campaign sender readiness now depends on the saved campaign sender id matching the currently selected sender id.
- Email/SMS schedule offsets are applied only inside allowed send windows. The first recipient is immediate when queued inside the window; if outside the window, it waits for the next allowed window.
- Gmail sender display name comes from the Configure Senders label, while the email address still comes from the sender value/address.
- Gmail's web UI signature is not automatically applied by Gmail API sends. InsulHub now imports the Gmail send-as signature through OAuth and appends the synced HTML signature at send time.
- For Gmail senders, the editable name is the InsulHub sender/display label. The email address is read-only after connection and comes from the actual Gmail account.
- Campaign archive state is stored as `campaigns.archived_at`. Archived campaigns are hidden from the default list and shown in the archived list.
- Draft deletion remains a permanent delete; approved campaign cleanup uses archive/unarchive instead.
- SMSGate sender value falls back to the sender label when a phone/display number is not provided.
- Test sends use the selected preview recipient for merge field rendering but still save the raw template body/subject on the campaign.
- SMSGate enqueue success is treated as a sent attempt in the current MVP status model; deeper delivery polling/webhooks are still pending.
- Stub senders still work for local testing and create stub provider ids.
- Stub senders remain supported internally for automated/local testing, but users can no longer add new stub senders from Configure Senders.

Decisions made:
- Gmail account tokens and SMSGate credentials are managed from Settings for the MVP connection experience; Google app OAuth client setup remains app-level.
- Campaign delivery remains synchronous in this pass so the UI immediately gets sent/failed audit results.
- Live campaign sends default to the proposal-style NZ delivery window of 08:30-17:30 and can now be changed from Settings > Communication Settings.
- Test sends intentionally ignore campaign delivery limits so sender setup can be verified quickly.
- Existing Gmail senders connected before Gmail signature sync need to reconnect once so Google grants the additional signature-settings permission.
- Email spacing includes small random jitter except for the first recipient in each daily limit block. Multi-day rollover is handled by queued scheduling plus Cloudflare Worker cron processing.
- The queue is processed by both the campaign page/manual Process Due button and Cloudflare Workers Cron. Cron calls are protected with `CRON_SECRET`.
- On 2026-07-17 the always-on Neon polling was replaced with a Cloudflare Durable Object alarm. Queueing or manually processing a campaign activates the Worker through `CAMPAIGN_QUEUE_WORKER_URL`; the alarm calls Neon only while recipients remain pending and deletes itself when the queue is empty. The legacy one-minute Cron Trigger now performs a Cloudflare-only initialization check and does not contact Neon after initialization.
- Vercel rejected once-per-minute cron on the current Hobby account, so unattended minute-level scheduling moved to Cloudflare Workers.
- Confirmation estimates use the saved Communication Settings and communicate that email sends are spaced with random jitter.
- Audience filter presets and opt-out/exclusion handling are intentionally out of MVP scope per product decision on 2026-06-19.
- Configure Senders no longer exposes default sender or disable controls for MVP. The campaign builder now requires a deliberate sender selection instead of auto-picking a sender.

Issues or follow-up items:
- Monitor Cloudflare Worker invocation logs after the first live queued campaign to confirm expected cadence and error handling.
- Existing project lint warnings remain in unrelated EBA/site-plan/job-list code; full lint now passes with warnings only.

## Current Next Chunk

Continue Chunk 8: production hardening for larger sends, including a queued/background delivery worker or another durable delivery strategy.
