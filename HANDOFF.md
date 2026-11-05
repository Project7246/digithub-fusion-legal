# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 5 Nov 2026

## One receipt system per courier, not one per account

- **`/api/courier/receipts` asked the courier nothing.** It is the route the
  page reads for every courier but PostEx, and the chase lived on screens a
  Trax or M&P tab never calls - so Trax - AA Traders only came right because
  its payment screen was read by hand, and **ElRB was never asked at all**.
  That route now starts the chase, and `chaseCpr` takes a courier as well as
  an account, so one tab asks every account of that courier.
- **A read that failed is on the screen now.** `receiptSources()` keeps, per
  account, when its receipt screen was last read and the reason if it could
  not be - the page names the account and the courier's own words for why.
  Silently dropping it is what let one account be right and the next invented.
- **M&P bill, they do not deduct**, and the receipt says so: their own six
  columns (RR amount, invoice amount, MON_FIX, tax amount, IBFT, net
  payable), the invoice in the parts they bill it in (shipment, fuel, GST,
  extra, OSA/NSA + its own GST), and the withholding split into income tax
  and sales tax. **MON_FIX was never read**; the OSA/NSA line was on no
  screen at all.
- **A payment's parcels come from the payment**: `absorbPaymentParcels`
  (mnplive.js) reads their detail report - 298 consignments, 273 delivered,
  25 returned on the one checked - and clears strays. A payment of 235,668
  had shown four parcels.
- `saveCprs` merges `raw` instead of writing it whole; `mergeCprRaw` adds to
  a cover without disturbing M&P's audited write path.
- New: `npm run check:mnp-receipts`. `npm run check:all` = 19 ok.

## What the owner must check

- **Trax - ElRB**: open `/receipts?courier=trax`. Either its receipts become
  Trax's own figures, or the page now names the reason - most likely its
  sonic.pk sign-in. Re-save it on the Couriers page, which checks it.
- **M&P - GlowCart**: parcel counts per payment should become M&P's own
  (298, not 4). Rose Belle is the other account and was not looked at.
- 9 Trax CPRs are still not in QuickBooks (21,603,433) - the books, not a bug.
- PostEx AH (10) and UR (11) have no webhook. Next migration number is **006**.
