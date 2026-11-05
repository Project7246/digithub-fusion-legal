# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 5 Nov 2026

## A Trax receipt now holds what Trax say it holds

- **Their per-parcel call does not name the payment they pay against.** Its
  `id` was written on as a CPR number, so payment 1839584 carried **1,709
  parcels against the 924 on their own screen** - parcels still in transit
  among them. `fetchPayment` no longer returns a receipt number; a courier
  with a payment screen is never asked parcel by parcel; `savePayments`
  keeps the number it has when handed an empty one; `clearCprStrays` lets a
  parcel go of a payment it was never in; **`adjusted` was the third kind
  and was not being read**. Every payment is now within a few parcels of
  Trax's own count (920 of 924, 2,363 of 2,370 - the rest are parcels this
  app holds no row for).
- **The screen**: status as a column and in the receipt (Paid / Processed),
  "What is in this receipt" in the courier's own kinds, Money with **all
  five deductions named** - the withholding and COD SST were not on the page
  at all, 79,646 of it on one receipt - and "By status" underneath.
- **Each courier's receipt is read in that courier's own columns.** Trax's
  money block is their six and only their six - total amount, charges, GST,
  WHT, COD SST, payable. **No IBFT line**: their row carries the field but
  their screen prints no such column, so it is named in the difference note
  instead, and the receipts list draws no Bank fee cell for a Trax row. The
  list's Tax column is every tax cut, not just the GST.
- **Every courier now has the second table PostEx has** - its own payment
  book, month by month, with the courier's own status word. Built only from
  covers the courier's payment screen wrote.
- `npm run check:trax` is new and synthetic. `check:all` = 18 ok.

## What the owner must check

- **Trax - ElRB (account 9) still shows 22 receipts with no payment behind
  them** (1 to 1,858 parcels, no status, no date). Those are the invented
  numbers. They clear themselves the moment that account's payment screen
  answers - and it is not answering, so **its sonic.pk sign-in is the thing
  to check**: re-save it on the Couriers page, which checks it before saving.
- 9 Trax CPRs are still not in QuickBooks (21,603,433) - the books, not a bug.
- PostEx **AH (10) and UR (11) have no webhook**. M&P GlowCart unreconciled.
- Next free migration number is **006**. Working tree clean.
