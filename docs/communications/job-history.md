# Job communications history

CRM messaging is available to all authenticated staff with access to the job. The master enable switch and account-only testing controls have been retired. Old stored rollout settings are ignored; no database migration is required. The former settings endpoint remains read-only for older tabs and rejects obsolete setting changes.

The main Text and Email buttons open the CRM composers. Only the signed-in user's connected senders are available, and the server verifies ownership before sending. Legacy Comms offers the existing template pickers and external SMS/mail app flow.

When there is no connected sending account, Text or Email opens a modal offering Connect an account (the matching Configure Senders tab in Settings) or Use Legacy Comms (the original channel template picker). Dismissing it launches neither action. Account-load failures remain retryable and unresolved send attempts retain their recovery screen.

The Communications section shows the newest CRM SMS, CRM email or campaign record by default. Show all communications displays older messages, search and manual app history. Show latest only returns to the newest card regardless of the current search. Each message expands to show its saved content and sender details.

Email displays the original saved HTML, including its signature, in the existing sandboxed preview. Sender name, address/number and staff member come from the saved message snapshot. Older campaigns disclose when their original sending address was not saved. No current connection is substituted for historical sender data.

Manual app launches remain in an expandable, explicitly unconfirmed history. CRM message counts exclude those launches. Failure and unknown statuses remain visible. Load and refresh errors offer retry without discarding loaded records or claiming history is empty.

The existing SMS status hook updates records without resending or collapsing an expanded message. Gmail acceptance does not imply delivery or read tracking. No inbox sync, reply capture, new sending transport or database schema is introduced. Other communication can be added as job notes.

## Production acceptance

Refresh a job as a staff account. Text and Email should open the CRM composer using only that account's connected senders, or offer connection setup and Legacy Comms when none are connected. Confirm the latest saved message appears immediately and older messages expand. In Communication Settings, the enable and test-only controls are gone; campaign timing settings remain available.

## Verification

Route tests cover sending and history despite absent, disabled or tester-restricted retired settings, while retaining job-access checks, sender ownership, duplicate prevention and saved message snapshots. Compatibility endpoint tests verify authentication and rejection of stale settings writes without database changes. Composer tests cover account setup, legacy fallback, failed account loading and uncertain send recovery.

Mocked browser checks at 390px and 1280px cover latest-message history, saved email signatures, automatic SMS status, primary CRM actions, legacy template/app flows, connection links to the matching Settings tab, and removed rollout controls. Business APIs are simulated and external requests blocked; no messages are sent.
