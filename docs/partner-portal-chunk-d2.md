# Partner portal Chunk D2 — plans UI and editor

## Scope

Chunk D2 adds the partner-facing Plans step, ordered floor-plan cards, and the full-screen partner drawing editor on top of the Chunk D1 APIs. It does not add submission, legacy attachment, outbox, operations, or tracking behavior; those remain Chunk E work.

## Routes and flow

- Saved drafts expose `3. Plans` in the lead/quote form and `/partner/jobs/:jobId/floor-plans` as a dedicated list. An unsaved lead shows “Save this draft before adding floor plans.”
- `/partner/jobs/:jobId/floor-plans/:drawingId` hosts the partner editor. The adapter uses only the Better Auth partner session and local D1 API routes.
- The list uses collection revision CAS for add, order, and delete. Drawing name/document saves use drawing revision CAS. A 409 locks the relevant mutation surface until an authoritative reload; a DRAFT transition permanently changes the list to read-only.
- Readiness is server-authoritative and advisory: at least one floor, a persisted unique name per floor, at least one wall per floor, and a current PDF for every floor. Empty or stale extra floors block readiness. There is no Submit action in D2.

## Shared editor and staff boundary

`SitePlanDrawingEditor` is storage/auth neutral. It provides outline and single-wall placement, endpoint and orthogonal snapping, selection and Shift multi-select, grouped step movement, 90-degree rotation, solid/dotted and colour styling, dimension overrides/toggle, text placement/edit/box sizing, undo, clear, keyboard coordinate entry, and accessible wall/note object lists. Shared geometry in `site-plan-editor-geometry.ts` is also consumed by the existing staff editor for distance, clamping, endpoint snapping, and orthogonal snapping.

The legacy staff page intentionally retains its existing GraphQL, local token, upload, direct-drag, marquee, arbitrary rotation handle, and close-shape implementation. Replacing that mature interaction surface with the new partner component was not treated as safe within D2 because it would also replace staff storage/export behavior. D2 does not claim pixel- or gesture-level parity with those advanced staff-only controls; it preserves them and shares the neutral domain/geometry seam without importing legacy auth, upload, `localStorage`, or external API calls into the partner route.

## Conflict, recovery, and PDF behavior

- Recovery records are scoped by tenant recovery scope, user session, job, and drawing, validated recursively, and expire after seven days. Logout removes every scoped site-plan recovery record.
- Stale recovery is quarantined immediately. Save, generate, reorder, rename, and delete remain locked until the latest saved state is loaded. Network/session failures keep local edits; session expiry offers a sign-in action.
- Blank drawings can be saved. PDF generation requires a persisted, clean drawing with at least one wall and renderable note layout. A failed regeneration leaves the previous current-pointer download available and visibly stale.
- Downloads fetch only the current D1 route, never expose an artifact identifier or storage key, announce success/error/session expiry, and defer object-URL cleanup until after the browser starts the download.
- The explicit fictional demo uses the same repository contract. Real PDF bytes are kept in a process-scoped memory adapter because pg-mem cannot safely parse a full binary PDF parameter; metadata remains in the fictional pg-mem database and download SHA verification is still enforced. Production continues to use immutable PostgreSQL BYTEA artifacts and SECURITY DEFINER publication.

## Accessibility and responsive behavior

Controls are at least 44 px, including the mobile Menu, navigation links, and Sign out action. Focus is restored after list mutations and dialogs, dangerous/warning dialogs initially focus Cancel, and polite/alert regions announce saves, recovery, order changes, generation, and downloads. Keyboard users can create both walls and notes using coordinates and operate every object through semantic lists. Touch drawing waits for an intentional short tap and ignores moved/cancelled gestures so scrolling does not place walls. The touch grid appears immediately after its tools/instructions; coordinate forms follow the canvas as keyboard alternatives. The viewport no longer disables user zoom.

White CTA text uses the darker brand-action orange `#c04e03` (4.85:1 contrast) while `#e85d04` remains the accent/focus colour. Returning a drawing exactly to its persisted snapshot removes its scoped recovery record; the initial recovery adoption is guarded so a genuine recovery is not removed before React applies it.

The editor is not described as fully canvas-accessible: keyboard-complete creation and object operations are provided and tested, but the SVG is still a visual workspace. At 390 × 844, command rows and list actions wrap without page overflow.

## Verification evidence

- Focused D2 UI/component suite: 22 passing tests, including edit → recovery write → exact revert → recovery removal → clean remount.
- Full partner suite: 21 files / 159 passing tests.
- Shared site-plan domain suite: 6 passing tests.
- TypeScript: clean.
- Browser flow on the fictional Northwind draft: authoritative empty list → Add Ground floor → blank editor → keyboard wall and note → save → deterministic PDF generation → secure 94,119-byte download with SHA header → PDF current. Address/name/document edits show stale until save/regeneration. Browser console remained clean.
- Exact-viewport captures: `partner-d2-plans-list-1440x900.png`, `partner-d2-plans-list-390x844.png`, `partner-d2-editor-1440x900.png`, and `partner-d2-editor-390x844.png`. Measured `body`, root, and viewport widths were identical (1440 or 390) for every captured list/editor state.

The disposable real-PostgreSQL role/migration gate remains an external launch gate and was not run because no safe gate URL was supplied. See `partner-portal-chunk-d1.md` for that contract.
