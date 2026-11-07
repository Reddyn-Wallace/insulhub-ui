# Persistent installation splits implementation plan

The owner explicitly requests implemented and committed CRM functionality, not a demo. The previous prototype scope is superseded.

Approved behaviour: complete a percentage of the whole job on a dated visit; carry the remainder to a planned date or unscheduled queue. Completed portions appear in usage even if parent status remains unfinished. Use quoted bag budget before final checksheet completion; then retrospectively allocate actual total across visits, retaining explicit manual usage if present. Label every estimated visit allocation. Never duplicate parent and visit totals.

Implementation:
- Persist percentage visits and snapshot quote values in the overlay database, with version checks and atomic audit records. Canonical job/quote/checksheet remain in the original backend. No upstream schema changes or automatic customer communications.
- Add authenticated read/write routes and migration. Server verifies job access and obtains snapshot/checksheet from upstream; accepts actions rather than arbitrary replacement state. Reads fail visibly if storage is unavailable.
- Real job page visit editor plus calendar editor; split job dates are owned by visits, original date remains a legacy reference. Protect completed dates. Provide remaining-work queue. Final work completion does not automatically complete the job or send paperwork.
- Calendar projects each visit using saved snapshot area/value and preserves original job ID. Usage projects completed visits independently of parent installed status and reads final checksheet fresh. Keep existing wall-bag meaning (actualBags versus separate ceiling field) rather than mixing quantities.
- Weekly sales/install report projects visits for installs/upcoming, counts sales only once, and bypasses stale report snapshots when split records exist. Clear browser calendar caches after saves.
- Remove fictional trial and navigation. Regression tests cover model, routes, concurrency, projections and UI; run required project suites/build and safe mocked browser tests. Commit only; do not migrate production, merge or deploy.

Critical cases: 60/25/15 across three weeks; unscheduled return; parent unfinished; zero and missing actual; actual-total allocation before visits reconciled; stale saves; retries; quote changes do not move previous allocations; cancelled/archived jobs; duplicate React row keys; upstream and storage outages.
