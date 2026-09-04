# Partner portal UX fixes — 5 September 2026

Implemented in the existing partner portal checkout (`c1b0/insulhub-ui`). Not deployed.

## Changes

- Autosaves no longer disable the form to repeat a submission check already confirmed by the successful draft save. Pending submission keys and cross-tab locking remain in place.
- New drafts are promoted in place after creation, retaining focus and typing. Further saves update the same draft; the address bar reflects its saved URL.
- The drawing instructions remain present after the first wall, preventing the canvas from resizing beneath the pointer.
- Confirmed successful submissions return to the dashboard with a success message. Failed and uncertain submissions retain their existing recovery/status flow.
- Saving a new company opens its first-user setup. Company and user changes update in place. User entry appears before the existing-user list.
- InsulHub connection settings live inside the selected company’s Edit panel. Saving a connection clears the password and refreshes the company revision while preserving an unsaved company-name edit.

## Verification

- Partner regression suite: 59 files, 609 tests passed.
- Production build, TypeScript and lint of changed files passed.
- Browser: focus retained through first and subsequent autosaves; next edits target the same saved draft.
- Browser: first wall leaves canvas position and size unchanged (326 × 308 px at the checked desktop viewport).
- Browser: floor completion returns to the quote; dashboard → new quote opens a blank form after in-place draft creation.
- Browser: fictional demo submission returns to `/partner?submitted=1` with a success message.
- Browser: company → first user, connection editing, revision refresh, retained company-name edits and mobile width checked with mocked staff API responses. No real invitations or connection changes were sent.
- Scoped independent code review found no confirmed actionable issues.

Production auth, database structure and transfer APIs were not changed.
