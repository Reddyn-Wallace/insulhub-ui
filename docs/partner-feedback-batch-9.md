# Partner feedback — dates, references and management layout

No new database migration is required for these changes.

- Job rows show Submitted (when recorded) and Last updated using stored job timestamps, never the status-check timestamp. The last-update value reflects the portal's saved job record; it is not a newly fetched upstream modification timestamp.
- Submitted jobs display their final quote reference or InsulHub job number instead of the draft reference. The original reference remains searchable. Job details use the same display reference.
- Saved job rows show street, suburb, city and postcode.
- Submission notification settings are collapsed below the company list.
- Add company opens a three-step setup: company, first user, InsulHub connection. User/connection setup can be finished later. The first user defaults to Admin. Saving a connection then finishing setup refreshes the authoritative company revision.
- Manage company opens a summary, with company details and users together. Edit company explicitly opens the name/connection forms. Add user explicitly opens the user form.
- Archiving a company returns to Partner companies with confirmation. Unarchiving a company leaves employees archived.
- User Archive deactivates access and hides the user from the default Active list. Archived and All filters retain access to their records; Unarchive reactivates their account. These actions reuse the existing account-access endpoints and session revocation behaviour.

Verification: full test suite, TypeScript and ESLint; production build; desktop/mobile browser flow using fictional API responses (no email sent). The browser covers company creation, Admin invitation, connection, saved revision, compact manager, user archive/filter/unarchive and company archive redirect.
