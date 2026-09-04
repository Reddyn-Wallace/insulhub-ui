# Partner feedback, batch 1

## Acceptance criteria

1. Dashboard explanatory paragraph removed.
2. Job cards use compact inline milestones and smaller padding, without losing status or accessible navigation on mobile.
3. Lead street search reuses InsulHub AddressAutocomplete and fills street, suburb, city and postcode; manually editable and persisted. No lookup from read-only details.
4. No partner-selectable lead source. Submission snapshots derive the source from the authenticated company's name, independent of client input.
5. Local-reference disclaimer removed.
6. Turning either product off clears its inputs without a confirmation modal.
7. No consent/deposit fields. New and existing unsent drafts and newly frozen submissions enforce zero on the server. Historical frozen records are not rewritten.
8. No Submission readiness section. Validation remains server-enforced with actionable errors when Submit is clicked.
9. Rates match the checked-in InsulHub implementation: blank when first enabled, saved entered rates preserved; no invented demo rates. Original wall depth defaults to 10cm.
10. Original InsulHub canvas/gestures/toolbar copied, with partner persistence isolated: outlines, close shape, wall/endpoint and group drag, arbitrary rotation, styles/colors, dimensions, physical length editing, unlinking, inline text and undo. Current server-generated PDFs and tenant boundaries retained.
11. Submitted/in-progress/failed jobs show the complete lead and quote with disabled inputs, visible floor-plan review/download, and no mutation controls. Milestones/amendments remain independently updated.

## Review and verification

Independent critic reviewed the plan, original-source comparison, implementation and final corrections. Final source verdict: APPROVE, no remaining P1/P2 findings in this batch.

Verification (31 August 2026):

- Full test command passes: 436 partner tests across 41 files, six existing site-plan tests, all three communication scripts, and five Cloudflare tests.
- Production build with demo flags unset passes, including TypeScript. Targeted lint for partner components, routes, libraries and migration gate passes. Full lint retains only its inherited three CommonJS errors and 20 warnings outside partner files.
- Original canvas gesture regressions cover continuous outline/close/undo, wall and connected endpoint dragging, physical wall-length adjustment, arbitrary rotation, inline text, recovery adoption and read-only guards.
- Address selection fills all address fields without requerying; clearing a pending search aborts and clears its loading indicator.
- Repository/freeze tests enforce zero terms and server-owned company attribution. Historical schema-v1 queued snapshots with empty or multiple old lead sources remain processable without changing their frozen financial terms.
- Browser checks at desktop and 390×844 verify the compact dashboard, original floor-plan toolbar, no product-off confirmation, removed controls, and full disabled submitted detail fields with no horizontal page overflow.
- Browser flow: rename a floor, Update PDF (auto-saves), return to quote, update contact/notes, save, submit, and view the complete read-only job and floor PDFs. Fresh demo submission finished SUCCEEDED with fictional notification DELIVERED. An earlier long-lived hot-reloaded demo stopped for review; this did not reproduce in a fresh server or either independent source-level reproduction.
- That browser flow also exposed a StrictMode lifecycle bug leaving the completion panel on “Checking…”. Resetting its mounted guard during effect setup fixes it; the regression verifies automatic successful completion, delivered notification and exactly one recovery request.
- Final fresh-browser check after the fix: Submit → confirmation → SUCCEEDED and DELIVERED automatically, without refresh or reload. The local server remains running for review.
- Diff whitespace check and high-confidence secret scan pass. No commit or push.

Migration 008 changes the existing authoritative freeze function for company attribution and zero terms, with a matching rollback. The disposable real-PostgreSQL gate includes its forged-source rejection and valid zero-term freeze probes, but remains **not run** because the dedicated database URL is absent. In-memory tests are not evidence of PostgreSQL/PLpgSQL execution.

No production rollout or real legacy write is included. The existing live-integration configuration/contract gates remain in place.
