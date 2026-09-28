# Finance reviewer fixes

User direction supersedes the earlier bank-evidence-only reserve contract.

1. Use Xero AmountPaid for advances and AmountDue for installed-job debt. Bank matching is an independent reconciliation check and cannot gate or double-adjust either total.
2. Match recognised full quote labels and verify direct invoice-number links from CRM job detail. Use customer names only to find candidates for detail verification, never as proof of linkage. Display unlinked outstanding debt explicitly.
3. User clarified the business workflow is binary: installed or not installed. Use detailed CRM installation status and completed CRM stage; no partial-work valuation or new status. Installed releases all advances; not installed retains Xero paid amount.
4. Load bank reconciliation on demand. Fetch Xero invoices in larger pages and CRM/detail pages with bounded concurrency. Measure live response time. Keep owner checks and no-store responses.
5. Regression-test revised semantics, matching conflicts, completion states, binary job status, incomplete bank evidence, and core-load independence. Deploy and verify live source samples and page timings. Preserve all existing decisions/audit records; flag incompatible old decisions.
