# CRM quote history

After a saved quote change, **Quote versions** appears beside **Edit** on the job's Quote card. It opens a read-only copy of the Edit Quote sheet. **Previous** and **Next** move through versions of the quote, including its scope, pricing, charges, deposit and quote comments. Sends and acceptance alone do not create a new priced version.

The CRM captures the saved quote before and after new revisions. Earlier tracked versions are labelled **Reconstructed from edit history** and reverse the recorded field changes from the nearest saved snapshot. Unknown values are shown as **Unavailable**. Fields with a recorded blank are shown as **Not recorded**. The history cannot reconstruct edits from before tracking began.

**Last send acknowledged** links the InsulHub save-and-send response to the saved revision and amount. It shows when the current tracked quote differs from that revision. The legacy API exposes no delivery receipt or attachment identity on this response. The old email-log match is by address and cannot identify a revision or reliably distinguish jobs sharing that address. Marked accepted records a CRM staff action on the saved quote.

The data belongs to the CRM overlay in Neon. History covers CRM quote mutations, quote site-plan attachments, and the CRM's Quote PDF action. The legacy PDF endpoint receives the original quote input and may write it while rendering. The proxy validates the response and compares the saved quote after generation. A detected change is attributed to the PDF action when the changed values match its input. The legacy app, external clients and partner submissions can still write directly to InsulHub. The next CRM read observes any net difference and records the observation time with unknown attribution. Intermediate external changes and historical edits cannot be reconstructed from the current quote.

Each tracked job has a short-lived advisory lock during a CRM write. The CRM persists intent before sending the upstream request. A lost upstream reply or failed history commit leaves a pending marker. After a minute, an authorised history read can reconcile the saved state. Recovery records any net change with unknown attribution and never retries an upstream send. If the CRM already received the upstream response and only history confirmation fails, it still returns that response.

The protected production build enables quote history by default and applies the additive migration. To enable it outside production, run `npm run quote-history:migrate` with a disposable Neon branch or PostgreSQL database, then set `QUOTE_HISTORY_ENABLED=true`. Setting the flag to `false` pauses capture and hides history while retaining prior entries.

The release regression suite tests the CRM handlers using a mocked InsulHub API and real PostgreSQL. A preview with an authorised test quote is required to confirm the legacy PDF output and whether generating it writes in that environment.
