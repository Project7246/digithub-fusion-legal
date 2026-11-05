# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 5 Nov 2026

## A receipt exists whether or not its parcels are here

- **`recentCprs` and `listCprs` were built `FROM courier_orders`**, grouping
  parcels by the receipt number on them - so a payment whose consignments
  this app holds no row for was not an empty receipt, it was no receipt at
  all. Four of M&P GlowCart's 29 payments were invisible on `/receipts`
  while sitting in `courier_cprs` and on M&P's portal. `recentCprs` now
  joins covers and parcels **as equals**, the way `bankingReceipts` always
  has. **Verified: 29 of 29, and 31 Oct ties to M&P's own row** - 136
  parcels, COD 319,649, charges 0, tax 12,321, IBFT 100, net 307,228.
- **`absorbPayouts` reads back what it wrote** (`wrote`/`held`/`lost`), and
  `/api/courier/sync` passes it through. `payments: 2` used to count the
  rows handed to the writer, not the rows the table held afterwards - and
  believing it cost three wrong diagnoses.
- Earlier the same day: `/api/courier/receipts` asked the courier nothing
  (now it does, per courier, in a queue, and a failed read is named on the
  page); Trax ElRB's timeout was the **payment list** asking for 200 rows
  on a parcel-page budget, not the sign-in; M&P's receipt is now in M&P's
  own columns, Trax's in Trax's.

## What is still open

- **Parcels, not receipts.** Trax - ElRB and M&P's older payments name
  thousands of consignments this app has no row for (ElRB: 2,618 on one
  payment, 3 here; M&P 31 Oct: 136 named, 0 here). Every figure on the
  receipt is the courier's own and both counts are printed, but a backfill
  of those accounts is what closes it.
- 9 Trax CPRs not in QuickBooks (21,603,433). PostEx AH (10), UR (11) have
  no webhook. M&P - Rose Belle untouched. Migration 006 is free.
