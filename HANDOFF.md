# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 5 Nov 2026

## Trax receipts now read like PostEx's, and the figures are the courier's own

- **Their per-parcel call does not name the payment they pay against.**
  `/shipment/payments`'s `id` was being written on as a CPR number, so
  payment 1839584 carried **1,709 parcels against the 924 on their own
  screen** - parcels still in transit among them. `trax.js fetchPayment` no
  longer returns a receipt number; a courier with a payment screen is never
  asked parcel by parcel (`askAboutMoney`), and `savePayments` keeps the
  number it already has when handed an empty one.
- **`clearCprStrays`** is the half that was missing: of the parcels carrying
  a receipt number, the ones the courier did not name let it go. Only ever
  given a complete list - all three kinds. **`adjusted` was not being read.**
- **The screen**: status (Paid/Processed) as a column and in the receipt;
  "What is in this receipt" - delivered/returned/adjusted, theirs beside
  ours, with COD; Money with **all five deductions named** (the withholding
  and COD SST were not on the page at all, 79,646 of it on one receipt);
  "By status" for any courier.
- `npm run check:trax`, new, synthetic. `npm run check:all` = 18 ok.

## What the owner must look at

- `/receipts?courier=trax` repairs itself on the first visits: each payment
  out of step is re-read (6 per visit, 6-hour hold), parcels it was never in
  are let go. **The counts should come to the courier's own.**
- **Trax - ElRB's payments have still never been read** - it now will on a
  visit, as it has a portal sign-in; if its receipts stay empty, run the
  backfill with `withCpr: true`.
- 9 Trax CPRs are still not in QuickBooks (21,603,433) - the books, not a bug.
- PostEx **AH (10) and UR (11) have no webhook**. M&P GlowCart is unreconciled.
- Next free migration number is **006**. Working tree clean.
