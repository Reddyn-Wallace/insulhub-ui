# Partner portal feedback — batch 8

Implemented locally; not deployed. Continues the autosave, drawing grid and submit-navigation fixes in batch 7.

## Behaviour

- Submission warnings use short actions without repeated field labels. Wall/ceiling numeric requirements are grouped, with links to the relevant fields and persistent inline error descriptions.
- Partner jobs always use a full-width list, including desktop.
- Password reset and invitation emails use the same navy/orange InsulHub styling as job notifications, include a clear action button and retain plain-text alternatives. Partner branding uses “Insulmax”.
- Partner companies in Settings no longer contain a Jobs section. Each company links to its own `/jobs/settings/partners/[companyId]` page for company details, InsulHub connection and users. Creating a company opens that page at user setup.
- Companies can be archived and unarchived. Archiving disables all partner employees and invalidates sessions/account links. Jobs remain stored. Unarchiving leaves employees inactive; staff reactivate them individually.
- Partner users have Sales or Admin roles. Existing users default to Sales; staff assign each company's first Admin. Both roles retain the same job access. Admins receive a Manage users link to `/partner/users`, limited to their own company.
- Employee reactivation and role changes are available in user management. Partner Admins cannot disable themselves or change their own role through the UI; the backend prevents removal of the final active Admin's own access.
- A correct-password login for a disabled employee or archived company explains that the account is disabled and directs the user to their administrator. Wrong credentials retain the generic message.
- Newly created drafts adopt their server-generated quote number/date/defaults without overwriting text entered while autosave is running.

## Release requirements

Apply migration `022_partner_company_access` before deploying this version. It adds Sales/Admin roles and restricted, tenant-aware company/user management functions. Existing users are not promoted automatically.

Company archive/unarchive and user actions use the normal InsulHub Settings authentication for staff, and authenticated partner identities for company Admins. Both are rechecked in the database. No production account changes or emails were made during development.

## Verification

- Browser checks used local fictional data or intercepted API responses: company creation routes to its dedicated page; role-aware invitation; connection/name saves retain current revisions; archive/unarchive; individual employee reactivation; role changes; mobile layout.
- Real local PostgreSQL checks cover migration application and company/user permission boundaries, archive session/link invalidation, inactive restore, role changes and final Admin protection.
- Draft browser checks confirm generated quote metadata, stable focus on warning links, list layout and desktop/mobile email previews.
- During development, saving screenshots inside the source checkout triggered Fast Refresh and simulated a form remount. Final browser checks saved screenshots outside the checkout before copying completed evidence.

Screenshots and an email preview are in `output/partner-ux/`. Automated regression/build results are recorded in the task's completion message.

Final checks passed: 631 partner tests, 6 drawing tests, 5 Cloudflare worker tests, communication checks, ESLint and production build. The full 22-migration PostgreSQL gate passed; after the final legacy session-fence adjustment, migration 022 down/up plus security and concurrent lock-order probes passed again. The disposable PostgreSQL process was stopped after verification.
