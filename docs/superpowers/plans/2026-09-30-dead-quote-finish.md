# Dead quote follow-ups — finish locally

User requested completing the remaining work as far as possible without deploying. Existing branch and commits retained.

- [x] Shared editable first/second SMS/email templates, exact amount merge, revision/audit protection, admin-only settings.
- [x] Positive-evidence resolution for unconfirmed sends with immutable staff provenance, no dispatch/retry, no unsupported "not sent" override.
- [x] Clear status/timing/sorting/counts and persisted draft/sent differences; recovery usable outside Dead.
- [x] Repeatable local pre-release checks, integration/database/browser coverage, rollout/handoff and outstanding backend limitations.
- [x] Full suite/build/lint, fresh independent review, final local commit. No deployment, production writes or live messages.

Ruling: existing Gmail connection grants send/settings scopes only, not mailbox read. Do not add permissions or pretend email provider lookup is available. Staff may positively attest a saved attempt was sent after checking the actual Sent folder/device and providing evidence. Never infer "not sent" from absence or permit an unknown attempt to be resent.
Ruling: staff verification preserves immutable original recipient/content/discount and records reviewer/evidence separately. Successful observation time remains conservative for second follow-up.
Ruling: shared templates use a required {{discount}} merge field and optional {{name}}/{{quoteNumber}}; unsupported tokens fail validation. Only admins change shared defaults, staff can edit individual messages. Configuration changes use CAS and audit history.
Ruling: preserve acknowledged backend limitations (exact Dead transition and atomic canonical note append). Finish local verification and a concrete rollout checklist, without claiming a live integration test.

Verification: 921 Vitest tests pass across the full npm test command, plus existing communication script checks. Follow-ups: 152 tests, including 13 real PostgreSQL cases. The end-to-end local lifecycle proves one dispatch after a lost response, one note append after a lost note response and the delayed second approach. All four browser scripts passed at 390px/1280px; screenshots inspected. Production build, TypeScript, targeted lint and whitespace checks pass. Read-only readiness CLI passed on the dedicated local integration schema with both feature flags off.

Independent review found no actionable P1/P2 findings. Updated the documentation to replace the old no-verification limitation with the positive-evidence recovery flow. Visual inspection found the new pages highlighting Leads; a failing browser navigation assertion reproduced it, and follow-up routes now stay under Quotes. The final build/browser checks include that fix.

No production database changes, feature flag changes, deployment or customer messages. Remaining external acceptance items and canonical backend contracts are in docs/dead-quote-followups-release.md.
