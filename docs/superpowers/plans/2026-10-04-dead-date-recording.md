# Dead dates — UI recording and agreed historical cohort

User-approved scope: finish locally without deployment or live messages. Quotes dated before 1 January 2026 are never in this follow-up queue. For eligible existing Dead quotes use the latest dated CRM note, otherwise quote date plus 30 NZ calendar days. These are assumptions, not actual transitions. Future confirmed UI entries/exits have durable server-observed timestamps and actor provenance. Retain offer counts on re-entry.

Ruling: this explicitly supersedes the original prohibition on UI-only capture. Other CRM changes remain outside capture. Cutoff is fixed at 2026-01-01, not rolling yearly. Missing/invalid quote dates cannot qualify. Future fallback dates wait rather than require manual correction. Previous-offer review remains required before sending.
Ruling: date assumptions are frozen in overlay storage when enabled, so follow-up notes do not move the original date. No production backfill or migration will run. Preview with flags off may calculate assumptions without writing.
Ruling: server observes confirmed canonical before/after states around UI mutations; it cannot make two databases atomic. Persist intent before dispatch; uncertain outcomes block follow-up until a fresh server observation resolves them conservatively. No mutation auto-retry.

- [x] Date/cohort rules with NZ boundaries and last-note parser tests.
- [x] Durable baseline and transition/intent storage; UI mutation interception, failures/retries/re-entry coverage.
- [x] Queue, controls and send enforcement using the same recorded/assumed date; provenance UI.
- [x] Migration/readiness/docs and local regression/database/browser/build verification; independent review.


## Verification and review

951 Vitest tests passed in the final full suite, including 182 follow-up tests and 19 real local PostgreSQL cases, plus the communication script suites. Production build, TypeScript, targeted lint and whitespace checks passed. All five browser scripts passed at 390px and 1280px; date screenshots inspected. Storage readiness passed against the isolated local integration schema with all production-related flags off.

Independent review found three actionable issues: fresh-send uncertainty was not rechecked, preparation could be enabled without capture, and JavaScript normalised impossible ISO dates. Each received a failing regression and fix; reviewer reran 24 focused tests and confirmed no further material findings. Browser verification exposed an ambiguous alert selector matching the Next route announcer; constrained it to the expected simulated network error.

Ruling: preparation implies date capture; the independent capture flag supports capture-only rollout. Unrelated lead/non-QUOTE saves bypass date storage. Existing QUOTE saves and explicit transitions into QUOTE remain captured. Current UI mutations were audited through the shared gql helper; direct browser fetches found were read-only email-log queries.

No production backfill, schema changes, feature enablement, messages, merge or deployment. Keep the branch/worktree and local review server. Outstanding release work is migration, enablement and controlled live integration checks. Changes made in the other CRM and atomic cross-CRM note append remain outside this UI-only implementation.
