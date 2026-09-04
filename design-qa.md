# Partner Portal Chunks B–D2 Design QA

**Final result: passed**

## Evidence

- Source visual truth: `docs/design-reference/insulhub-login-source-desktop-1440x900.png` and `docs/design-reference/insulhub-login-source-mobile-390x844.png`.
- Rendered implementation: `docs/design-reference/partner-login-implementation-desktop-1440x900.png`, `docs/design-reference/partner-login-implementation-mobile-390x844.png`, `docs/design-reference/partner-dashboard-implementation-desktop-1440x900.png`, and `docs/design-reference/partner-dashboard-implementation-mobile-390x844.png`.
- Chunk C quote evidence: `docs/design-reference/partner-quote-implementation-desktop-1440x900.png` and `docs/design-reference/partner-quote-implementation-mobile-390x844.png`, both authenticated captures at their named viewport and pixel dimensions.
- Combined comparison inputs: `docs/design-reference/design-qa-login-desktop-comparison.jpg` and `docs/design-reference/design-qa-login-mobile-comparison.jpg`.
- Desktop viewport: 1440 × 900 CSS pixels; source and implementation captures are both 1440 × 900 pixels, so no density normalization was required.
- Mobile viewport: 390 × 844 CSS pixels; source and implementation captures are both 390 × 844 pixels, so no density normalization was required.
- State: existing unauthenticated Insul Hub login compared with unauthenticated partner login in explicitly labelled fictional demo mode. The additional partner copy and demo chooser are intentional product-state differences.
- Authenticated dashboard source limitation: no safe legacy account was available. Existing authenticated layout/components and public assets listed in `docs/design-reference/README.md` were used as secondary evidence; no unsupported authenticated legacy screen was fabricated.

## Full-view comparison

The normalized mobile and desktop comparison inputs were inspected together. The implementation retains the source Inter hierarchy, navy/orange palette, gray page, white rounded card, subtle border/shadow, field sizing, full-width orange action, and restrained centered composition. It deliberately adds the verified existing icon asset, partner-only explanatory copy, and the mandatory demo label/account chooser. The authenticated shell continues the same navy navigation, orange active/action treatment, rounded white cards, and compact status pills.

## Focused comparison

No additional crop was needed: the mobile combined input renders the logo, card, typography, demo treatment, fields, borders, radii, and primary action legibly at original pixels. The desktop combined input was also inspected to verify card scale and centering.

## Required fidelity surfaces

- Fonts and typography: Inter is preserved with comparable weights, line heights, uppercase orange eyebrow text, and readable hierarchy. No clipping or broken wrapping remains.
- Spacing and layout rhythm: source card radii, shadows, field heights, page padding, and vertical grouping are retained. Dashboard cards and counters collapse cleanly at 390 pixels.
- Colors and tokens: navy `#1a3a4a`, orange `#e85d04`, gray-50 background, white surfaces, and semantic status colors are consistent and maintain contrast.
- Image quality and assets: the verified existing `public/icon-192x192.png` asset is used at native aspect ratio; no handcrafted or invented brand art is present.
- Copy and content: partner authentication is clearly distinct from legacy credentials, demo content is explicitly fictional, drafts/submission immutability are honest, and the EBA/install/completion/invoice/settlement facts independently say “Awaiting update.”
- Interaction/accessibility: semantic labels, keyboard-focus rings, 44-pixel-or-larger controls, reduced-motion handling, mobile menu state, login errors, dashboard filters, and draft save states were exercised.

## Chunk C responsive quote review

The Lead → Quote flow was checked at 1440 × 900 and 390 × 844. Cards collapse to one column without horizontal overflow; at 390 pixels the document, body, and viewport widths all remain 390 pixels. The local quote identity, product controls, derived R-value/bags/line price, extras, totals, advisory readiness, and sticky save status remain readable in document order. Extra add, remove, and up/down controls use keyboard-reachable semantic buttons with a minimum 44-pixel height, focus moves predictably after list changes, and a polite live region announces the result. The draft section pills expose the active step, the complete readiness list can be expanded, and calculated outputs/totals are live read-only regions.

The browser save used a fictional Northwind wall quote with 42.5 m² at $158.25/m², 15 cm cavity, $330 Council Fee, $25 consent, and 30% deposit. After the API save, the view showed revision 1 with R4.2, 8.5 bags, $6,725.63 wall, $7,055.63 contract, $1,058.34 GST, $8,138.97 total, and $2,441.69 deposit. The remaining readiness item was intentionally the Chunk D floor-plan requirement.

## Comparison history

1. Initial mobile dashboard implementation capture showed the final “Needs attention” filter partly offscreen in a horizontal chip row (P2 responsive polish). The filter group was changed to a two-column mobile grid with the existing horizontal layout retained from the medium breakpoint. The revised 390 × 844 capture shows all four persistent controls without clipping.
2. Initial source screenshots exhibited a viewport-scaling artifact. The unchanged existing `/login` route and partner implementation were recaptured after each explicit viewport change settled. The final comparison inputs have equal CSS and pixel dimensions.
3. Critic revision added the independently tracked Invoice milestone and clarified that milestones appear as the Insul Hub team records them. The same card grid and token system are retained; the post-revision dashboard was recaptured at the matching viewports.
4. The initial Chunk C mobile evidence file showed an expired sign-in state, and the desktop full-page image contained sticky-element stitching duplication. Both were replaced with authenticated, single-viewport quote captures at exactly 390 × 844 and 1440 × 900.

## Findings

No actionable P0, P1, or P2 findings remain.

- P3: in explicit demo mode, the fictional account chooser makes the mobile sign-in action fall just below the first 844-pixel viewport. The page scrolls normally, and production has no chooser; keeping both fictional tenant choices visible is useful for the required isolation demo.

## Chunk E5 submission completion review

The final E5 implementation was inspected together with the source at 1440 × 900 and 390 × 844 using the four `design-qa-e5-*-comparison.jpg` inputs. The authenticated source limitation remains the one documented above, so the unchanged source login supplies direct palette, typography, field, radius and shadow evidence while the existing authenticated InsulHub components supply the shell pattern. The implementation preserves the Inter hierarchy, navy shell, gray page, white rounded surfaces, restrained shadows, orange focus accent and dark-orange irreversible action without introducing new brand art.

The real browser journey used fictional Northwind `NW-2026-READY`: quote totals were $38,536.00 contract, $5,780.40 GST, $44,316.40 total and $11,079.10 deposit, with two current plan PDFs. The dialog action was measured at 44 px and `#c04e03`; Escape restored focus to the enabled Submit quote trigger. The committed submission first rendered a read-only PROCESSING state, then reached `SUCCEEDED` while the separately modelled fictional internal notification reached `DELIVERED`. The terminal view never implies that a pending notification changes submission success.

The initial live run found one non-visual P1 integration defect: Next exposed the browser's zero-length POST as an ended non-null request stream, while the recovery guard incorrectly required `request.body === null`. The route now proves the zero-byte transport shape asynchronously and still rejects query parameters, body/content headers, non-zero or misleading lengths and non-empty streams. The focused route test models the real Next shape, and the restarted browser run completed normally.

Desktop and mobile root/body widths exactly matched their viewports, and visible primary controls were 44 px high. Submitted plan editing controls disappeared or were disabled, the frozen PDF endpoint returned 200, the dashboard changed from Draft to Submitted, and a Harbour login could not resolve the Northwind URL. Browser resource inspection and server evidence showed only loopback requests. No actionable E5 P0, P1 or P2 visual or interaction finding remains.

## Chunk D2 Plans and editor review

Final populated list and editor states were captured at 1440 × 900 and 390 × 844. In all four states, body/root widths exactly matched the viewport and the browser console had no errors. The final list shows authoritative “Plans ready”, persisted counts/update time, a current PDF status, secure download, ordered actions, and no artifact identifier. The editor shows the compact partner header, clear Saved/PDF state, wrapped commands, keyboard wall/note entry, calibrated grid, and accessible object-list path.

The initial live demo exposed a hidden create failure because pg-mem rejected the real-PostgreSQL deferred-constraint statement and its constraint name was misreported as a duplicate floor name. The explicit demo now follows the documented local PostgreSQL emulation path, Add Ground floor is authoritative, and the card/editor open correctly. A second live issue—pg-mem parsing a full PDF BYTEA—was isolated to the fictional adapter; process-scoped demo bytes now retain SHA-verified generate/download behavior without changing production storage.

The active Outline/Select tool initially had insufficient contrast because base utility styles won over active styles. The active background, border, and text are now forced to the navy/white selected state and were rechecked live. Submitted empty lists now state that they are read-only and that no plans were recorded, instead of showing draft completion instructions.

Formal contrast review found that white on the original action orange was 3.50:1. Partner CTA backgrounds now use `#c04e03`, measured at 4.85:1 against white, while the brighter orange remains the brand accent and focus colour. Mobile Menu, navigation, and Sign out targets now have a 44-pixel minimum height. The revised 390 × 844 editor puts the touch grid at 593 px from the viewport top and the first keyboard coordinate alternative at 1046 px, preserving keyboard completeness without burying the primary touch canvas.

Recovery review also caught an exact-revert edge: an old recovery could survive after edits returned to the saved snapshot. Clean-snapshot reconciliation now removes that drawing’s scoped recovery only after initial recovery adoption has been checked, and a remount regression proves the deliberately reverted edit is not resurrected.

Chunk D2 browser evidence exercised Add → Open → wall/note → save → generate → download/current, with a 94,119-byte one-page PDF returned through the secure current-pointer route. Mobile and desktop download success were announced, touch scrolling did not create a wall, and list/editor controls did not overflow. No actionable D2 P0–P2 visual finding remains.

## Primary interactions verified

- Fictional Northwind login to company dashboard.
- Dashboard counts, independent milestones, search/filter controls, and responsive mobile navigation.
- New fictional draft creation, save, reload, edit, second save, and revision increment.
- Logout and fictional Harbour login.
- Northwind unsaved-new recovery cleared at logout and did not appear after Harbour login.
- A stale edit reloaded the current server revision before allowing further edits.
- Guessed Northwind draft URL denied to Harbour with a generic not-found screen.

## Implementation checklist

- [x] Source and implementation compared at matching desktop/mobile viewports.
- [x] Responsive filter clipping fixed and recaptured.
- [x] Verified logo asset, typography, palette, surfaces, and copy checked.
- [x] Core interactions and tenant isolation checked in the in-app Browser.
- [x] No actionable P0/P1/P2 design findings remain.
# Chunk E3 submission QA

- Final authenticated E3 captures: `docs/design-reference/e3-submission-desktop.png` at 1440 × 900 CSS pixels and `docs/design-reference/e3-submission-mobile.png` at 390 × 844 CSS pixels. The automated browser check reported one Submit quote control and no console/page errors.
- The final submission action uses a 44px minimum target, a destructive/irreversible confirmation dialog, focusable readiness summary, live status announcements, and 44px section recovery links.
- Editor controls and plan navigation lock synchronously before the request. Direct plan-list and plan-editor routes also start fail-closed while checking job-wide PENDING recovery records. Recovery/sign-in/reload actions remain outside the disabled editor fieldset.
- A stale server-rendered DRAFT is checked before editing is exposed. Cross-tab PENDING changes lock the form and replay the same key.
- Copy distinguishes received/processing, internal retry, completed, and reconciliation states; no pre-success state says Insul Hub completed the submission.
- Layout remains a single-column mobile flow at 390px and expands actions without reducing touch targets.

## Chunk F2 operations and partner tracking review

Reviewed at 1440×900 and 390×844. The existing source login and the implementation images were opened together in the same comparison input: mobile company settings, queue and payment history; desktop company settings and partner tracking. The authenticated-source limitation described above remains unchanged. Inter, navy/orange branding, verified source icon, white rounded cards, subtle borders, generous fields and restrained semantic colours remain consistent. No new brand art was introduced.

The initial queue metrics used a single mobile column. They now use the existing partner dashboard's two-column pattern, keeping all four metrics readable and bringing the first record higher. Every reviewed root/body width matched its viewport; company fields, extras and financial definition lists did not overflow. The mobile partner menu, 44px update action, invoice and payment cards, and wrapped amendment text remain readable. All post-submit partner views had zero editing inputs.

Browser interaction review verified both manually recorded billing outcomes, company creation/pricing/extras, individual-user creation and login, persistent queue search, corrected install date, append-only amendment, pending-to-final settlement and partner isolation. Final payment initially exposed a duplicate sibling-key defect; type-prefixed form keys fixed the duplicated amendment card and a terminal-state rerender test now guards it. Date input and rapid-filter regressions were also corrected and tested.

Final F2 captures are `partner-f2-companies-*`, `partner-f2-queue-*`, `partner-f2-ops-job-1440x900.png`, `partner-f2-tracking-*` and `partner-f2-remittance-390x844.png`. Capture files were checked for exact intended viewport dimensions; no stitched full-page captures are used. No actionable P0–P2 visual findings remain. Production integration is a separate acceptance gate, not established by these fictional screenshots.
