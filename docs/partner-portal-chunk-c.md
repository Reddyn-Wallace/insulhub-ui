# Partner Portal Chunk C — Quote Drafts

Chunk C adds the exact local quote domain and draft UI. It does not add floor plans, submission, legacy writes, email, notifications, internal operations, payments, settlement automation, or richer tracking. A local quote number is deliberately labelled `LOCAL-…`; it is not the final initials-plus-job-number identifier used by legacy Insul Hub.

## Ownership and persistence

Migration `003_partner_quote_drafts` adds nullable company wall/ceiling rates, deposit, consent, default extras, and a defaults revision. Real pilot unit rates remain a production provisioning decision and may stay `NULL`; no price was invented for production. A job stores normalized `quote_data`, its initialized time, the defaults revision and an immutable JSON snapshot, plus the existing authoritative total-cents field. Company defaults are read only on first initialization. Later company changes do not alter an existing quote, while partners can override all rates and pricing inputs on a draft.

Every public job read initializes any missing quote before returning it, including list reads. Initialization uses a `quote_data IS NULL` compare-and-set guard, then reloads the winning row, so concurrent first reads converge on one snapshot and a list never exposes a transient projection of current company defaults. Defaults are bounded and shape-validated at migration, repository, domain, and provisioning boundaries; default extras are uniquely identified, named, nonnegative, count/size limited, and kept small enough to remain safe when duplicated into both the editable quote and its immutable snapshot.

The API derives company identity from the authenticated partner session. Recursive allowlists reject unknown tenant, company, total, calculation, and adapter fields at the request, draft, address, quote, product, extra, and defaults-snapshot levels. It accepts only bounded input fields, forces the server-generated local number/date and snapshotted defaults, recalculates every derived value and total, and persists only through the existing draft-only compare-and-swap revision. Cross-company IDs remain not found. Errors do not echo draft PII.

## Exact calculations and rounding

All stored money uses integer cents; the deposit percentage uses basis points. Decimal dollar and percentage strings are parsed directly and rounded half-up, so `$10.075` becomes `1008` cents and `10.075%` becomes `1008` basis points without binary floating-point ambiguity. Product line cents are rounded half-up after multiplying area by the integer rate. GST is rounded half-up from 15% of contract cents, and deposit is rounded half-up from total cents times deposit basis points. Ceiling thickness preserves the exact decimal `R × 42` result while bags remain rounded to one decimal.

- Wall: 10 cm derives R2.8 and bags = area ÷ 6.5; 15 cm derives R4.2 and bags = area ÷ 5. Displayed bags are rounded to one decimal.
- Ceiling: thickness = R × 42 mm; bags = R × area × 0.0405, rounded to one decimal. Downlights initialize to zero when ceiling is enabled.
- Contract = enabled wall line + enabled ceiling line + extras.
- GST = 15% of contract. Total = contract + GST + consent. Deposit = total × deposit percentage.
- Disabling a product clears all of that product’s stored inputs and removes its contribution.

The default pricing shape is consent `$0`, deposit `25%`, and one `Council Fee` extra at `$330`. The later server-only adapter maps only proven legacy DTO fields from `API_SCHEMA_NOTES.md`: dollar-valued `SQMPrice`, consent, extras and calculated totals; percentage deposit; metre-valued cavity depth; calculated R/bags/thickness; nullable disabled products; and `quoteResultNote: ""`. It makes no request and is never included in a partner response or browser model.

## Draft UX and readiness

The responsive draft is sectioned as **Lead → Quote**, using the established Inter/navy/orange/rounded-card partner system. Quote identity, R-values, thickness, bags and money totals are read-only/live outputs. Extras support keyboard-reachable add, remove and reorder controls with focus recovery and announcements. Readiness can expand to every item, its outputs are announced accessibly, and the step pills expose the active section. Every possible normalized quote error path resolves to an existing editable control or described group with an inline error; only editable targets become links in the focused summary. Raw money and deposit text is preserved while typing and normalized exactly on blur/save. During an in-flight save the complete fieldset is disabled, preventing a late response from overwriting newer edits. A stale-revision response immediately removes browser recovery, locks every mutation and further save, and stays locked until a refreshed server revision deterministically replaces the form state. Disabling a populated product asks for confirmation because it clears data.

Draft saving remains permissive. The readiness panel is advisory and submission is not enabled. A future submission will require customer name, phone or email, a full address, local quote number/date, at least one complete enabled product, positive rates and areas, valid depth/R/downlights, nonnegative consent/extras with named extras, and a 0–100% deposit. Floor-plan readiness remains explicitly pending Chunk D.

The existing opaque tenant/user-scoped `sessionStorage` recovery now uses schema v3 and includes quote fields. It retains the seven-day TTL, mismatch rejection, non-throwing storage behavior, stale-revision quarantine/reset, and session-expiry handling from Chunk B.

## Demo and production blockers

Northwind and Harbour use different, explicit fictional rates and pricing defaults in the loopback-only demo. These values are not pilot recommendations. Production still requires Neon, the full real-PostgreSQL migration up/probe/down/up gate, approved pilot rates/defaults, and all Chunk A configuration. Live legacy quote mapping and number reconciliation remain unverified future integration work.
