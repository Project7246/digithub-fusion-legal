# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 5 Nov 2026

## One receipt system per courier, and all three accounts read

- **`/api/courier/receipts` asked the courier nothing** - the route the page
  reads for every courier but PostEx. It starts the chase now, `chaseCpr`
  takes a courier as well as an account, the accounts run in a queue, and a
  read that failed is named on the page (`receiptSources`).
- **Trax - ElRB was never the sign-in.** Made to name itself, the error said
  `GET /cod/finance/payments/list, gave up after 22s of 22s`. It asked for
  **200 payments in one page** and was timed as a parcel page. Now 50 a page
  (`TRAX_PAYMENTS_PAGE`) and `/cod/finance/` gets the sign-in's budget.
  **Verified: ok, 44 covers, 990 parcels linked, 28 of 28 receipts now have
  the courier's own cover. The 22 invented receipts are gone.**
- **M&P bill, they do not deduct**: their six columns (MON_FIX included,
  never read before), the invoice in its own parts - shipment, fuel, GST,
  extra, OSA/NSA + its GST - and the withholding split into income and sales
  tax. 29 covers, 1,317 parcels linked, and 475,676 - 16,215 - 18,458 - 100
  = **440,903**, their own net.
- A receipt lists every word the courier used, not two: M&P say DELIVERED
  241 / UNDELIVERED 77 / UNKNOWN 37.
- New: `npm run check:mnp-receipts`. `npm run check:all` = 19 ok.

## What is still open

- **Trax - ElRB's parcels were never backfilled.** Its payments name
  thousands of consignments this app has no row for - 2,618 on one, of which
  3 are here. The receipts are right (every figure is Trax's own) and the
  screen prints both counts, but a backfill of that account is what closes
  the gap. Same for the older M&P payments.
- 9 Trax CPRs not in QuickBooks (21,603,433). PostEx AH (10), UR (11) have
  no webhook. M&P - Rose Belle was not looked at. Migration 006 is free.
