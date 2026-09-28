# Current calculation contract — 28 September 2026

This section supersedes the original bank-evidence-only contract below, following the owner's reviewer feedback and explicit binary installation clarification.

- **A — Bank balance:** latest Akahu Trading Account current balance, excluding overdraft availability, with its source timestamp.
- **B — Paid advances for jobs not installed:** sum Xero invoice AmountPaid for NZD invoices linked to CRM jobs not installed. Bank matching is not a prerequisite. Historical opening allocations, bank receipts and retained-release decisions never add to or subtract from this total. Paid final invoices are also advances until installation is done.
- **C — Owed for installed jobs:** sum Xero invoice AmountDue for NZD invoices linked to installed CRM jobs. Credits are already represented in Xero due. Bank receipts do not create an extra deduction; potential unreconciled receipts appear in the separate bank check.
- **Job status is binary:** installed or not installed. Detailed CRM installed-result enums establish installed. Completed CRM stage supports legacy records whose default installation result was not maintained. An explicit INSTALL_NOT_FINISHED result blocks that fallback and is flagged if the stage says completed. No completed-work valuation or partial-payment reserve percentage is introduced.
- **Links:** whole verified quote labels and direct CRM invoice numbers; names only select candidate jobs for direct invoice verification. Conflicting or missing evidence remains unlinked. Unlinked outstanding debt is shown separately, never silently dropped or called installed debt.
- **Bank reconciliation:** optional, separate and timestamped. Paid-but-unmatched in Xero can include settlement delay or historical missing evidence; it is not extra debt. Bank-check failure does not remove an already loaded overview.
- **Freshness/performance:** overview skips historical bank/payment reads. A 60-second owner-scoped server-memory cache and in-flight deduplication reduce repeat loading; explicit refresh bypasses it. Every request still verifies the canonical owner. HTTP responses remain no-store/private.
- **Old review records:** preserved for audit. Historical retained releases are incompatible with the new binary calculation and must be flagged rather than applied. Owner invoice links still apply; bank allocations remain separate evidence.

Examples: Xero paid 1,000/not installed/unmatched bank => B 1,000. Same job installed => B 0. Installed invoice due 600 with a 400 unmatched bank receipt => C 600 until Xero is reconciled. Unlinked invoice due 600 => 600 in unclassified outstanding, not silently assumed installed.

## Historical contract — superseded

# Insulmax cash dashboard — chunk 1

Status: calculation rules and acceptance examples approved by the owner, including the three highlighted advance-payment, cancellation and processing-fee policies. No live connections or product changes. Prepared 27 September 2026.

## Agreed scope

One main NZD bank account through the owner's personal Akahu app; Xero invoices and payments; CRM jobs. Owner-only access. No Windcave integration initially. Clear, uniquely supported bank receipt matches may adjust the dashboard automatically; ambiguous matches require review. Xero itself remains unchanged.

Purpose: explain bank cash, customer advances attached to unfinished installations, and money customers still owe for installed jobs. This is a management cash view, not a statutory deferred-revenue calculation or a measure of spendable profit.

## Definitions

- **A — Bank balance:** Akahu's reported current balance for the selected main account, with its balance timestamp. Never calculate this by adding invoice payments to the bank balance. Show available balance separately if useful; credit facilities are not cash owned.
- **B — Deposits reserved for unfinished jobs:** gross customer advances evidenced as settled into the selected bank account and allocated to unfinished jobs, less settled refunds or explicitly approved releases. Keep the full remaining advance reserved for partial installations. Do not cap B at A: money may already have been spent and A minus B may be negative.
- **C — Still owed for installed jobs:** sum of Xero outstanding invoice amounts on installed jobs, less confirmed bank receipts allocated to those invoices that Xero has not yet reflected. Show the original Xero amount and local adjustment alongside the result. Never deduct the same receipt twice, or allow an allocation beyond the outstanding amount; excess is an overpayment requiring classification.
- **A minus B — Bank cash less reserved deposits, before other commitments:** excludes supplier bills, wages and tax reserves. Never label it free cash or safe to spend. It is provisional whenever unresolved receipts or missing job links could change B.
- **Paid in Xero, bank receipt unconfirmed:** payment recorded in Xero without sufficient bank settlement evidence. Split between unfinished and installed jobs. This is not proven Windcave money in transit, is not extra bank cash, and is not customer debt. A manually recorded payment can also be wrong.
- **Receipts needing matching:** bank receipts whose purpose or allocation is unresolved. Already included in A; do not add them again or guess which job they belong to. Show their total and flag affected headline figures as provisional.

All amounts are NZD including GST, calculated in cents. This cash reserve does not also deduct a separate GST reserve. Invoice status alone is insufficient: credits can settle an invoice without a cash receipt.

## Installation and matching rules

Installed means CRM `installation.installStatus` is `INSTALLED_AS_QUOTED` or `INSTALLED_WITH_VARIATIONS_FROM_QUOTE`. Both release B and allow outstanding job invoices into C. `JOB_NOT_STARTED_YET` and `INSTALL_NOT_FINISHED` retain B. A calendar date, final invoice, signed paperwork or whole-job `COMPLETED` stage is not a substitute. Missing or conflicting status goes to review, not automatic release. Reopening an installation restores the applicable remaining advance reserve and removes its invoices from C; preserve the change history.

Link invoices using CRM Xero invoice IDs first, then confirmed invoice-number/quote-reference links. Include additional instalments and advance payments of final invoices for unfinished work; excluding them merely because they lack the word deposit would understate the reserve. A final invoice's negative deposit line reduces its bill total; it is neither a bank refund nor another deposit receipt.

Automatically allocate posted receipts only where a unique invoice/reference, amount and plausible timing support the match and neither side has already been allocated. Amount-only or name-only matches are suggestions. Partial receipts may match a unique reference when the remaining amount supports them. Combined receipts, net processor payouts and conflicting invoice links require review. Transfers, loans and owner contributions are not customer payments.

Track each allocation through local matching and later Xero recording. Once Xero reflects that same receipt, remove its local adjustment in the same calculation update. Matching is reversible and auditable. A refreshed Xero balance alone does not prove which receipt it includes.

Bank balance and transactions may refresh at different times. Display both timestamps and all source health states. Never combine missing data with zero or call a mismatched snapshot fully confirmed. Historical opening deposits need settlement evidence or an explicit owner-confirmed opening allocation; lack of old bank data must not silently make B zero.

## Worked examples

Each row is independent. Opening bank balance is a hypothetical $10,000.00 with no other reserves or debts. Receipts/outgoings stated below have posted unless explicitly unconfirmed. CRM status and bank evidence in every example are assumptions, not observations of the live accounts. Rows using real invoice values are marked **export**; the others are synthetic acceptance cases.

| Case | Inputs and event | A bank | B reserved | C owed, installed | A minus B | Other required display |
|---|---|---:|---:|---:|---:|---|
| 1 — received deposit (export) | INV-0426 / AP28968: $1,388.63 paid; assume bank receipt confirmed, job unfinished | $11,388.63 | $1,388.63 | $0.00 | $10,000.00 | Linked deposit and job |
| 2 — unpaid deposit (export) | INV-0434 / AP28894: $2,063.53 due; job unfinished; no receipt | $10,000.00 | $0.00 | $0.00 | $10,000.00 | Future-job invoice due $2,063.53, outside C |
| 3 — installed, final invoice unpaid (export) | INV-0420 deposit $860.34 settled; INV-0447 final balance $1,804.79 due; assume AP28896 installed | $10,860.34 | $0.00 | $1,804.79 | $10,860.34 | Do not deduct deposit again from final balance |
| 4 — partially paid deposit | $2,000 deposit invoice; $600 received; unfinished | $10,600.00 | $600.00 | $0.00 | $10,000.00 | Remaining $1,400 is unpaid future-job billing |
| 5 — online deposit unconfirmed | $1,000 payment recorded in Xero; unfinished; no bank settlement confirmed | $10,000.00 | $0.00 | $0.00 | $10,000.00 | $1,000 paid, bank receipt unconfirmed; provisional |
| 6 — online final payment unconfirmed | Installed job; $3,000 invoice paid in Xero; no bank settlement confirmed | $10,000.00 | $0.00 | $0.00 | $10,000.00 | $3,000 paid, bank receipt unconfirmed |
| 7 — bank deposit before Xero | Unfinished; $1,000 invoice still due in Xero; $1,000 posted receipt uniquely matched | $11,000.00 | $1,000.00 | $0.00 | $10,000.00 | Local match awaiting Xero |
| 8 — bank final payment before Xero | Installed; Xero due $3,000; uniquely matched posted receipt $1,200 not recorded by Xero | $11,200.00 | $0.00 | $1,800.00 | $11,200.00 | Xero $3,000 minus local $1,200 |
| 9 — Xero catches up to case 8 | Same bank cash; Xero now due $1,800 and its $1,200 payment is linked to the local receipt | $11,200.00 | $0.00 | $1,800.00 | $11,200.00 | Local adjustment now $0; no second deduction |
| 10 — installation finishes | $1,000 deposit settled; job moves from unfinished to installed; final invoice $3,000 due | $11,000.00 | $0.00 | $3,000.00 | $11,000.00 | Reserve falls $1,000; bank cash does not move |
| 11 — installation partly finished | $1,000 deposit settled; status INSTALL_NOT_FINISHED | $11,000.00 | $1,000.00 | $0.00 | $10,000.00 | Full reserve retained |
| 12 — cancellation, refund pending | $1,000 deposit settled; cancellation with full refund still owed | $11,000.00 | $1,000.00 | $0.00 | $10,000.00 | $1,000 refund owed, included once in B |
| 13 — cancellation, refund settled | Same $1,000 receipt followed by $1,000 bank refund | $10,000.00 | $0.00 | $0.00 | $10,000.00 | Refund history retained |
| 14 — partial refund | Unfinished job; $1,000 deposit received, $200 refund settled | $10,800.00 | $800.00 | $0.00 | $10,000.00 | Remaining customer advance $800 |
| 15 — unidentified receipt | $1,000 incoming bank receipt, no reliable invoice/job match | $11,000.00 | unknown | unknown | unknown | $1,000 needs matching; no invented reserve or debt reduction |
| 16 — processor fee | Unfinished job; customer paid $1,000; payout $980 and fee $20 explicitly evidenced and allocated | $10,980.00 | $1,000.00 | $0.00 | $9,980.00 | Full customer advance reserved; fee borne by business |
| 17 — grouped payout unresolved | Bank receives $2,940; Xero has several paid invoices, no proven payout allocation | $12,940.00 | unknown | unknown | unknown | Review payout; never guess allocation from net amount |
| 18 — advance on final invoice | Unfinished job; $3,000 final invoice paid directly into bank in advance | $13,000.00 | $3,000.00 | $0.00 | $10,000.00 | Reserve despite invoice being labelled final |
| 19 — credit note, no cash | Installed job; $3,000 invoice reduced by approved $500 credit; no payment | $10,000.00 | $0.00 | $2,500.00 | $10,000.00 | No bank receipt or settlement-unconfirmed payment created |

Unknown means the complete figure is not defensible from the example's inputs. In the actual dashboard show known subtotals plus the unresolved amount, not an empty screen and not a falsely precise total. For case 15, if this is the only unresolved receipt, known B is $0 and possible additional reserve is up to $1,000; A minus B is between $10,000 and $11,000 until classified. C's existing confirmed subtotal stays visible, with potential adjustments unresolved.

## Approved policy choices

1. Reserve gross settled customer advances, even where a confirmed processor fee reduces the bank payout. The fee does not reduce the work owed to the customer. Without evidence of gross-to-net allocation, the payout remains unresolved.
2. Retain cancelled-job money as a refund reserve within B, separately labelled. Release only when a refund settles or an owner-approved retained amount is resolved. Do not assume a deposit is non-refundable.
3. Keep all advance receipts on unfinished jobs in B, including additional instalments and early final-invoice payments. Do not release amounts automatically for partial completion.
4. Show uncertain amounts openly. Unmatched paid invoices are not automatically Windcave settlements; unknown job links do not imply completed work.

## Source evidence and limits

Invoice values were reread from `SalesInvoices_Insulmax Insulation (Wellington and Wairarapa) Limited_2026-Sep-27.12.40.53.csv` in the owner's Downloads folder. Invoice-level fields repeat across line items; group by invoice number before counting or summing. No customer names, addresses or emails are reproduced here.

AP28896 final invoice: $3,441.38 gross work less $860.34 deposit deduction less $776.25 variation discount = $1,804.79 due. The export proves invoice values and recorded payment amounts only, not actual bank settlement, payment channel or installation status.

Current CRM source evidence: `src/app/jobs/[id]/page.tsx` defines the installed statuses above; `src/lib/queries.ts` requests installation status and Xero invoice links. Live completeness and consistency remain unverified.

Previously identified exceptions to carry into the live register: INV-0389 and INV-0444 share BW28592 and each show $1,496.44 paid; confirm whether distinct real payments. Some deposit references are opaque CRM IDs. INV-0408 is future-dated relative to the export. Do not silently discard, merge or re-date these records.

## Chunk 1 acceptance and next boundary

- Invoice examples traced to export; arithmetic checked independently.
- Synthetic scenarios explicitly separated from observed data.
- Installation trigger, settlement uncertainty, credits, refunds, fees and double-counting behaviour specified.
- Owner approved the proposed rules after clarification that a reserve is a dashboard deduction only: no funds are moved or locked. Use “Deposits for unfinished jobs” as the primary dashboard label.

Chunk 1 review is complete. Chunk 2 covers source connections. No credentials, production records, schema, payment instructions or application code are changed in chunk 1.
