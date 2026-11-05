# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 5 Nov 2026

## Trax - AA Traders now reconciles with the portal

- **Trax had no receipts at all.** absorbPayment() only opens a payment the
  webhook names, so an account whose webhooks were never switched on had none.
  traxportal.js now reads `/cod/finance/payments/list` (the Finance > Payments
  screen) and `/..._shipments` for the parcels under each. **9 payments kept,
  9,180 parcels put under one.** App total **21,603,433 = portal 21,603,433**,
  and all nine match one by one, statuses included.
- **One definition of a paid receipt, not two.** cprMoney() kept its own
  `= 'CLOSED'` while the parcel side read CPR_CLOSED, so the same nine
  receipts were "received" on one screen and "still owed" on the other. Both
  read PAID_WORDS now (closed, paid, cleared, confirmed, transferred,
  processed) - Trax say **Paid**, PostEx say CLOSED.
- **A missing pickup date is not a parcel nobody collected.** Trax return
  `rider_picked_status_date` null on every row, delivered ones included (500
  of 500 checked live), and that read as "3,831 not picked up yet". It now
  says "collected, no pickup date given" and only booking-stage parcels count
  as uncollected.
- `sessionFor` takes three arguments; calling it with one made the payment
  read sign in afresh and fail as "Trax did not accept that email and
  password" on a visit that had just signed in. The backfill hands its own
  session over.

## Checked tab by tab on that account - all correct

Parcels: summary, days, status, cities, handed. Finance: statement, months,
ageing, CPRs, pending, cities. Net receivable 0.00 with 9 of 9 CPRs paid,
ageing says nothing outstanding, and the three agree.

## Still open

- **9 Trax CPRs are not in QuickBooks yet** (21,603,433) - the books, not a bug.
- PostEx **AH (10) and UR (11) have no webhook** (0 hits); to be set in their
  portal. **Trax - ElRB (9)** has parcels but its payments are not read yet -
  run the same backfill with `withCpr: true`.
- M&P GlowCart's total is not reconciled against the M&P portal.
- Next free migration number is **006**. Working tree clean.
