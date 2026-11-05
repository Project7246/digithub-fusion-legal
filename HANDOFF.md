# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 5 Nov 2026

## One receipt system per courier, not one per account

- **`/api/courier/receipts` asked the courier nothing.** It is the route the
  page reads for every courier but PostEx, so a Trax or M&P tab listed
  whatever had been written down by some other path. It starts the chase
  now, `chaseCpr` takes a courier as well as an account, and the accounts
  run in a queue with a gap between them.
- **A read that failed is on the screen** (`receiptSources`): the account is
  named with the courier's own words for why. That is how ElRB was found.
- **M&P bill, they do not deduct**, and the receipt says so: their six
  columns (MON_FIX among them, never read before), the invoice in the parts
  they bill it in - shipment, fuel, GST, extra, OSA/NSA + its own GST - and
  the withholding split into income tax and sales tax. Verified live:
  475,676 - 16,215 - 18,458 - 100 = **440,903**, their own net.
- **A payment's parcels come from the payment.** `absorbPaymentParcels` read
  29 covers and linked **1,317 parcels**; a payment of 355 consignments had
  been showing 1. A receipt lists every word the courier used, not two -
  M&P say DELIVERED 241 / UNDELIVERED 77 / UNKNOWN 37.
- New: `npm run check:mnp-receipts`. `npm run check:all` = 19 ok.

## The one thing the owner must do

**Upload `tools/courier-relay.php` to the website in its current form.**

Trax - ElRB is the only account with no cached portal session, so it is the
only one that signs in - and the sign-in POST is slower than a list call.
Measured alone, with nothing else on the relay: **50 seconds, two attempts
of twenty-five**. Twenty-five is the relay's own `CURLOPT_TIMEOUT`, now 40
in the repo. Until that file is uploaded the relay cuts every ElRB sign-in
and its 22 receipts stay as the invented numbers they are. Nothing else is
wrong with that account - the route itself answers in 9.9 seconds
(`/api/courier/reach?courier=trax`), and the password was never the problem.

Also open: 9 Trax CPRs not in QuickBooks (21,603,433). PostEx AH (10) and
UR (11) have no webhook. M&P - Rose Belle was not looked at. Migration 006.
