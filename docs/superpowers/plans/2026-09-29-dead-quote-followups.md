# Dead quote follow-ups — first implementation slice

Scope authorised in chat: chunks 1–2, date foundation and read-only queue. Quotes only; discount is a dollar amount, with a job note only after confirmed sending in later chunks.

- [ ] Establish canonical transition integration. Blocked: backend source is not in this checkout or connected project/repository inventory. User confirmed no access to that repository; exact capture remains blocked.
- [x] Build/test quote-only classification, date provenance, NZ calendar timing and historical-note review.
- [x] Build/test authenticated, paginated, read-only canonical quote queue. Never infer absence of prior offers from absence of structured history.
- [x] Build/test queue and selected quote review UI; show missing evidence and read-only scope explicitly.
- [x] Verify build, regression tests, browser layout and independent review.

Ruling: do not introduce a frontend timestamp or write to canonical notes as a substitute for canonical transition capture. Exact recording remains blocked until backend integration is available.
Ruling: historical-note parser produces review suggestions only, not approved Dead dates. Existing quotes require history review; no live job is labelled due merely because no offer record exists.
Ruling: no production migration, deployment or messages in this slice. No new shadow copy of canonical jobs. No sending controls.

Canonical handoff: record entry/exit events at the effective quoted-Dead state boundary in the canonical backend, transactionally with status changes. Event ID, job ID, episode ID, server occurredAt, previous/new state and actor; repeat writes to the same state do not create an entry. Expose authorised reads. An ACCEPTED quote, archived job or stage other than QUOTE is never currently eligible. Conflicting callback/dead flags require review. Expose a concurrency/version token for later send validation. This is a proposed contract, not an assumed existing GraphQL field.

Verification ledger will be completed with observed results before handoff.

## Verification ledger

Rules: initial missing-module failure observed; implementation passed 30 focused rule tests. API: initial missing-module failures observed; 10 server/route tests then passed. UI: initial missing-module failure observed; four UI tests passed.

Final review: independent reviewer found two Important issues, no Critical or Minor findings. Malformed nested status records and auth-expiry display produced failing regressions, then were fixed. DST repeated/nonexistent-hour tests also pass. Total focused tests now 51.

Final: Ruling: canonical capture remains blocked, not replaced with a UI timestamp — user has no backend access — cost: no operational due queue can be claimed yet.
Final: Ruling: live schema/production permissions/data population remain unverified; reads reuse established fields and token access — cost: production integration needs a separate authenticated acceptance check before rollout.
Final: Ruling: provider/concurrency/lifetime persistence review belongs to later sending chunks — no transport or write path exists in this slice — cost: this foundation is intentionally read-only.
Final: browser layout and full regressions are checked separately by the implementing agent; reviewer did not claim to verify them.

No customer data, production schema, messages or unrelated primary-checkout files changed. Existing uncommitted work remains in the primary checkout; this branch starts from committed HEAD 1988dbe.

Final verification: npm test passed (820 Vitest cases plus three communication script suites); additional job-list regression tests passed (3). Production build and targeted ESLint passed. Browser smoke passed on 390px and 1280px after review fixes; both screenshots inspected. No deferred review findings. Exact transition recording and operational history remain incomplete as stated above.
