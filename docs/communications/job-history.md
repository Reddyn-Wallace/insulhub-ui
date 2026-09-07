# Job communications history — chunk 2

The job page displays the new Communications section when the existing CRM messaging controls allow the authenticated account. Otherwise it retains Sent Communications. The settings are not automatically enabled by this deployment.

The new section shows existing CRM SMS, CRM email and campaign records newest first, with SMS/email filters, search and expandable messages. Email displays the original saved HTML including its signature in the existing sandboxed preview; it does not regenerate a signature from the current connection. Sender name, address/number and staff member come from the saved message snapshot. Older campaigns lack a separate original sender-address snapshot and disclose this limitation. No current connection is substituted for historical sender data.

Manual app launches remain available in an expandable, explicitly unconfirmed history. CRM message counts exclude those launches. Failure and unknown statuses remain visible. Initial load errors and refresh errors offer retry without discarding loaded records or claiming history is empty.

The existing SMS status hook updates the record in place without resending or collapsing the expanded message. Gmail acceptance is labelled as acceptance, with no delivery/read tracking implied. Existing composers, manual contact options and notes remain available. No inbox sync, reply capture, new sending transport or database schema is introduced.

## Verification

- All 761 tests in `npm test` passed, plus the three communications script checks.
- Production build and targeted lint passed.
- `npm run test:job-communications-browser` against a local production build passed at 390px and 1280px: initial load failure/retry, saved records/signature, filters/search, automatic SMS status, no horizontal overflow, flag-off legacy layout and manual contact options.
- Browser business requests were simulated and external requests blocked; no messages were sent.
- The combined history query passed EXPLAIN against the existing production schema without data changes.
- Independent code review found no remaining new blockers after the initial-error and campaign-metadata fixes.

## Production acceptance

In Settings → Communication Settings, select **Test only with my account** before **Enable CRM SMS and email**. Refresh a job with saved CRM messages. Expand SMS and email records, check original content/signature and sender details, try filters/search, and confirm other accounts still see the existing layout. Turning CRM messaging off restores the old layout without removing any records.
