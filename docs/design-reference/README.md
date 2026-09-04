# Insul Hub visual source capture

Captured 2026-08-29 from the existing unauthenticated `/login` route with the Codex in-app Browser. These screenshots are the selected visual source for the partner portal; they contain no credentials or customer data.

- `insulhub-login-source-desktop-1440x900.png`: desktop viewport, 1440 × 900.
- `insulhub-login-source-mobile-390x844.png`: mobile viewport, 390 × 844.
- `partner-login-implementation-desktop-1440x900.png`: partner login at the matching desktop viewport.
- `partner-login-implementation-mobile-390x844.png`: partner login at the matching mobile viewport.
- `partner-dashboard-implementation-desktop-1440x900.png`: authenticated fictional Northwind dashboard.
- `partner-dashboard-implementation-mobile-390x844.png`: authenticated fictional Harbour dashboard.
- `partner-quote-implementation-desktop-1440x900.png`: authenticated fictional Northwind quote at the Quote section after a server-authoritative save.
- `partner-quote-implementation-mobile-390x844.png`: matching responsive quote evidence with the saved local identity and wall calculation visible.
- `partner-d2-plans-list-1440x900.png` and `partner-d2-plans-list-390x844.png`: authenticated fictional Northwind floor-plan list with one wall, one note, and a current PDF.
- `partner-d2-editor-1440x900.png` and `partner-d2-editor-390x844.png`: the same saved floor in the full-screen partner editor, including the wrapped command rows and keyboard coordinate alternatives.
- `partner-d2-plans-empty-1440x900.png`: an intermediate empty-state capture retained for the add-floor flow history; the populated list files above are the final D2 evidence.
- `design-qa-login-desktop-comparison.jpg` and `design-qa-login-mobile-comparison.jpg`: normalized side-by-side comparison inputs used for visual QA.
- `partner-e5-ready-draft-1440x900.png` and `partner-e5-ready-draft-390x844.png`: the fictional Northwind quote at the irreversible submission action, with authoritative saved totals and two current plans.
- `partner-e5-completed-status-1440x900.png` and `partner-e5-completed-status-390x844.png`: the same job after the real E4 state machine and independent fictional notification reached terminal success.
- `design-qa-e5-ready-desktop-comparison.jpg`, `design-qa-e5-ready-mobile-comparison.jpg`, `design-qa-e5-completed-desktop-comparison.jpg`, and `design-qa-e5-completed-mobile-comparison.jpg`: source and E5 implementation combined at their exact matching viewports for the final visual review.

The source establishes Inter typography, navy `#1a3a4a`, orange `#e85d04`, gray-50 page backgrounds, white rounded cards, subtle shadows, eight-pixel fields/buttons, orange focus rings, and a mobile-first full-width form. The verified existing icon assets are `public/icon-192x192.png`, `public/icon-512x512.png`, `public/apple-icon.png`, and `src/app/favicon.ico`; they are reused rather than redrawn.

No authenticated legacy screen was opened because this worktree has no safe legacy account. Existing source code was therefore used as secondary evidence for reachable authenticated patterns: `src/app/jobs/layout.tsx`, `src/app/jobs/page.tsx`, `src/components/StageTabs.tsx`, `src/components/AppDialog.tsx`, and `src/components/InstallPlanningForm.tsx`. They confirm sticky navy navigation, orange active pills/actions, rounded white surfaces, compact filters, and responsive mobile layouts. This limitation is intentional and does not justify inventing a new brand mark or unsupported legacy behavior.

The source screens were first captured before partner UI edits. During final visual QA they were recaptured from the unchanged `/login` route after each viewport override settled, avoiding a browser-scaling artifact and keeping source/implementation captures at identical CSS and pixel dimensions.

Chunk D2 was captured at the exact named CSS and image dimensions. Automated browser measurements reported no horizontal overflow: document body, root element, and viewport widths were all 1440 px on desktop and 390 px on mobile. The final captures were checked against the same source palette, Inter hierarchy, white-card/border/radius treatment, accessible dark-orange actions (`#c04e03`, 4.85:1 with white), orange accent/focus, and navy partner shell. The revised mobile editor capture places the calibrated touch grid in the first viewport directly after its tools/instructions; keyboard coordinate alternatives follow below. The partner editor deliberately uses a gray workspace and the existing calibrated grid rather than introducing new brand art.

Chunk E5 browser evidence is intentionally coordinated only after its code/test checkpoint. The required final filenames are `partner-e5-ready-draft-1440x900.png`, `partner-e5-ready-draft-390x844.png`, `partner-e5-completed-status-1440x900.png`, and `partner-e5-completed-status-390x844.png`. They must be captured with the in-app Browser (not Playwright), at the exact CSS/image dimensions, after authenticating as fictional Northwind and exercising the real E4 engine through `NW-2026-READY`. The QA comparison must verify the source palette/hierarchy, 44px mobile targets, visible keyboard focus, dark-orange irreversible CTA, no overflow, and distinct submission-versus-fictional-notification terminal copy.

That E5 browser gate is complete. Root/body/viewport widths were 1440/1440/1440 on desktop and 390/390/390 on mobile. The final Submit, dialog confirmation, shell navigation and frozen-plan actions measured 44 px high. Escape closes the confirmation and restores focus to the still-enabled Submit quote trigger; the warning action renders as `rgb(192, 78, 3)` (`#c04e03`) with white text. The browser saw the committed processing state before the worker completed, then the distinct `SUCCEEDED` submission and `Delivered in the demo only` notification results. Frozen plans remained read-only, their secure PDF route returned 200, and a Harbour session received only the generic tenant-safe not-found screen for the Northwind job.

## Final operations and tracking captures

Chunk F2 (31 August 2026): `partner-f2-companies-1440x900.png`, `partner-f2-companies-390x844.png`, `partner-f2-queue-1440x900.png`, `partner-f2-queue-390x844.png`, `partner-f2-ops-job-1440x900.png`, `partner-f2-tracking-1440x900.png`, `partner-f2-tracking-390x844.png`, `partner-f2-tracking-payment-390x844.png`, and `partner-f2-remittance-390x844.png`. These fictional internal and partner views were inspected with the matching source captures in the same comparison inputs. See the root `design-qa.md` and `docs/partner-portal-release.md` for acceptance evidence and live-launch blockers.
