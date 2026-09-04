# Partner feedback batch 4 — 31 August 2026

## Approved scope and acceptance criteria

- Both partner submission failure states display **Contact Insulmax**. Help directs the partner to the Insulmax team with their reference; it works on hover, focus and tap, remains available while hovered/focused, and dismisses with Escape, toggle or outside interaction. Backend states, retry processing and internal operations remain unchanged.
- Remove dashboard metric cards. Preserve search, status filters, company isolation and compact job cards.
- **Add floorplan** saves pending quote changes, creates one drawing and immediately opens that drawing. It serializes double clicks, locks quote inputs/navigation through the transition, stays put on save failure, and requires a collection reload after an ambiguous creation response.
- Remove **Save as draft** and the leave-with-unsaved-changes modal. **Back to quote** saves edited floorplans as Draft before leaving, keeps edits in place on error, and does not invalidate an untouched completed drawing. Exact edit/undo remains a draft until completion as previously agreed.
- **Save as complete** still persists a fresh revision, regenerates its PDF and returns only after completion succeeds. No PDF controls are added to the partner view.
- Floorplan recovery has no age expiry. Retain company/user scope, drawing/job identity, revision, value-shape and future-timestamp guards, plus logout cleanup. This is a tab-local safety copy, not a promise that unsaved edits survive closing a tab. Server-saved drawings do not have this expiry. Quote recovery policy is outside this batch.
- Submit quote is a prominent 56px-high action in normal document flow at the bottom, not sticky/floating.

## Implementation and review

Client/UI-only changes; no schema, authentication, pricing, legacy adapter or production deployment changes.

The independent critic reviewed the plan and implementation. The focused review passed with no remaining P0–P2 findings. Its tooltip focus-persistence finding is fixed and covered by a combined keyboard/pointer regression. React/Next.js review guided stable event handling, accessible help and serialization of navigation with saves.

## Verification

- Full automated tests: 473 partner tests across 44 files; shared site-plan 6 tests; communication scripts; Cloudflare 5 tests, all passed.
- Added coverage for quote-save/create ordering, field locks across delayed navigation, blocked Back during creation, double-click Add, failed quote save, ambiguous creation response, dirty Back serialization/errors, blank-name validation, unchanged completed Back, old valid recovery and future/stale rejection, generic status labels, tooltip interaction, removed metrics, and non-sticky submit styling.
- TypeScript and targeted ESLint passed. Full lint remains the inherited 3 CommonJS errors and 20 unrelated warnings, with no partner findings.
- Production build with demo flags unset passed again after the final navigation-lock safeguard. The critic independently rechecked that safeguard and passed 43 autosave/floorplan tests with no new findings.
- In-app browser: fictional Northwind quote creation, pending Notes saved before Add, direct editor opening, name edit saved by Back, reopening the saved drawing, drawing a wall, completion/PDF generation, return showing Complete, and unchanged completed Back preserving Complete.
- Desktop and 390×844 mobile checks: no dashboard metric cards; both error jobs use Contact Insulmax; tooltip remains within the viewport (left 105px/right 361px at width 390px); no horizontal overflow; submit measures 56px high with static-positioned ancestors. Browser logs contained no application errors.

The local demo is restarted after build verification, resetting fictional records. No commit, push, live submission or deployment. Existing live integration and real-PostgreSQL release gates remain outside this feedback batch and are not newly claimed as complete.
