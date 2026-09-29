# Paid-invoice job-link audit — 29 September 2026

Source evidence: approved Xero sales invoices read directly; owner-scoped CRM source snapshot checked 22:02 NZDT containing 2,953 jobs; targeted CRM details for quote/name candidates; live CRM searches and Hands job page. No source invoices or CRM records changed. No owner decisions invented.

Eight links can be recovered with explicit quote evidence plus full customer/site corroboration, or exact slash-quote punctuation. Seven are installed. Warren's job has conflicting completion signals; existing explicit not-installed status takes precedence, with no partial valuation.

| Invoice | Customer | Xero paid NZD | Why it failed / evidence | Job and status | Deposit effect |
|---|---|---:|---|---|---:|
| INV-0023 | Jenny Eagle | 1,325.00 | E0557 reused for Susan Hes. Exact E0557 plus full Jenny Eagle contact distinguishes job. | 17795, E0557, 50 Dundas Street; installed, Completed | 0 |
| INV-0029 | Wellington City Council / PAE | 7,163.75 | E0468 reused for Blair Marett. Invoice line explicitly names 33 Worcester Street, matching the E0468 job. | 25190, E0468; installed, Completed | 0 |
| INV-0090 | Stephen Hart / Amber Von Espy | 350.00 | Invoice E03051/2; CRM E03051. Revision suffix plus exact full customer matches uniquely. | 23800, E03051, 8 Oak Avenue; installed, Completed | 0 |
| INV-0091 | Neil / Henrietta Sushames | 1,641.44 | E0490 reused for Charlie Wang. Exact quote plus full contact distinguishes job. | 25279, E0490, 2/17 Hepara Street; installed, Completed | 0 |
| INV-0092 | Warren Fitzgerald / Katie McCarthy | 1,207.50 | Reference `#R25184/2)` not recognised; CRM exact quote R25184/2. Invoice says 15m² still to complete. | 21888, 77 Rotherham Terrace; **INSTALL_NOT_FINISHED**, stage Completed | **+1,207.50** under existing rule; owner clarification requested |
| INV-0101 | Sharon Barnden | 523.25 | BW26083 and customer absent from returned CRM index; live Barnden search no results. | No verified job | Excluded pending job link/status |
| INV-0103 | Roz Pilott | 1,746.56 | E0512 reused for Marg Lawson and James Sime. Exact quote plus full contact distinguishes job. | 25478, E0512, 23 Taylor Terrace; installed, Completed | 0 |
| INV-0178 | Insulmax New Zealand Ltd | 800.59 | No quote; line is **Control cable repairs**. This appears to be a non-installation sale, not a customer deposit. | No installation job established | Excluded; retained visibly rather than silently classified |
| INV-0216 | Mark Bennett / Jane Ganley | 16,500.00 | Invoice E0700-1; CRM E0700. Exact full customer and invoice address 47 Penryn Drive corroborate revision link. | 26329, E0700; installed, Completed | 0 |
| INV-0255 | Zachary Goodley-Hornblow | 1,686.75 | R24266 reused for Nathan Cain. Exact quote plus full customer distinguishes job. | 18476, R24266, 166 Daniell Street; installed with variations, Completed | 0 |
| INV-0310 | Jessamy Richards / Albertus Peters | 1,072.95 | BW27734 and customer absent from returned index; live BW27734 and Jessamy searches no results. | No verified job | Excluded pending job link/status |
| INV-0368 | COLUMBUS FINA | 1,686.75 | Reference Zachary Hornblow, line says incorrect amount/customer deposit not accounted for. Amount equals INV-0255, but no explicit quote/invoice link. Likely finance correction; not proven job link. | Plausible R24266 / 18476, installed; **not automatically linked** | Excluded pending correction context |
| INV-0419 | Mark and Dina Hands / trustees | 3,829.50 | Opaque reference `0000000a23d8ec67`; Xero customer adds Mobile. Candidate matches customer, but no quote, site address or invoice relation proving identity. | Plausible 28408, BW28408, 22 Duchess Place; live CRM says installed and Completed; **not automatically linked** | Excluded pending explicit job confirmation |

Original unclassified paid: **39,534.04**. Eight recovered links classify **31,621.00**: **30,413.50** belongs to installed jobs and **1,207.50** remains held. Remaining five: **7,913.04**. Snapshot replay changes deposits from **27,903.99** to **29,111.49**, without changing completed-job debt or bank/card values.

The API's returned index contains no archived rows. The code does not filter archived jobs, but this does not prove complete historical/archive coverage from the upstream API. Missing records cannot be declared deleted or absent from the full CRM; owner job links requested. No access permissions were expanded.

Matching safeguards: no name-only or amount-only linking; exact quote required. Shared quotes and revision candidates are all fetched in detail before final selection, so existing explicit invoice relations can resolve or expose conflicts. Multiple corroborated candidates remain unresolved.

## Separate receipt check: Kay / Kimberly Da Silva

INV-0445 / AP28218 is installed, AUTHORISED, NZD3,338.25 due with zero Xero paid. A read-only Akahu search across January–September found no Silva/Kay/INV-0445/AP28218 reference or exact3,338.25 receipt. Feed last updated29September19:47NZDT. No deduction created; actual bank entry date/reference/account requested. Feed delay or another account are possibilities, not established causes.
