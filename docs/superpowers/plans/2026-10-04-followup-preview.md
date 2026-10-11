# Follow-up presentation and interactive local preview

- [x] Remove requested pricing, assumed-date and previous-offer warning panels. Preserve date evidence and eligibility rules.
- [x] Remove all queue filters; retain search and show only quotes needing follow-up. Waiting, snoozed, excluded, completed and uncertain records stay out. Prior-offer review remains required before sending. Restore/snooze/date recovery remains available from job follow-up history.
- [x] Omit absent and zero-area scope values. Flag every negative extra as an existing discount, displaying individual amounts and their sum excluding GST without netting positive extras.
- [x] Load canonical pages with at most four concurrent requests, read independent overlay data concurrently, use linear attempt lookups and memoised list derivation. Return visits show a token-scoped snapshot for up to 30 seconds while fresh data loads; edits remain disabled until refresh succeeds. Live latency has not been benchmarked.
- [x] Provide localhost-only sample preview using real UI and domain functions, persistent local sample state, editable templates/discounts/history and simulated SMS/email with discount notes. No live business API proxy, production writes or messages.
- [x] Verify 194 follow-up tests, production build/TypeScript, targeted lint, five browser regression scripts and real sample-preview interactions at 390px and 1280px. Independent review completed; zero-area ceiling finding fixed and covered.

Separate origin http://127.0.0.1:3117 isolates sample sign-in. Sample mode is visibly labelled. Real-data preview on 3116 retains disabled capture/preparation/sending flags. No deployment or production database change.
