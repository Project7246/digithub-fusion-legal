# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 4 Nov 2026

## Finished, pushed and verified against the couriers themselves

- **compute.js** read **-498,120 hours**, so the stop-at guard and the sweep's
  pacing were off since 1 Nov. A spell is a duration now. `check:compute`.
- **The relay returns gzip** with no `Content-Encoding`, so every relayed body
  was read as mojibake - "the Trax portal did not hand over a sign-in form",
  and Trax's API calls too. `Accept-Encoding: identity` out, `readBody()` back.
  `check:relay`.
- **Trax portal now signs in from the server.** Both accounts backfilled from
  the portal: **AA Traders 4,247 -> 13,989** (portal says 13,989) and
  **ElRB 9 -> 31,287**.
- **A generated M&P payment is not money received.** `mnp.js` set `settled`
  from the mere presence of a PaymentID, so 116 parcels on PENDING payment
  20261547934 were counted as received. `GOT_SQL` now lets a cover we hold
  overrule the flag; where no cover is held the flag stands as before.
  Verified live: got 5,965,044.75 -> 5,691,675.75, pending 0 -> 273,369 on
  116 parcels. `check:mnp`.
- **Net receivable** is one figure with its two halves under it; the charges
  card shows charges and tax for each half. PostEx HT reconciles to the portal
  exactly: orders 12,189 = 12,189, CPRs 7 = 7, 17,031,377.05 closed and
  4,828,910.42 approved.
- `CS-Consignee Shifted` mapped to `review` and rebucketed. `/courier-dash` no
  longer rebuilds itself every 8s; `/receipts` date controls match it.

## Known and NOT bugs - do not "fix" these

- **M&P tax is 0 honestly.** Their QSR report carries no money column at all,
  tracking carries only CODAmount and AmountPaid, and Payment_Report only
  RRAmount/InvoiceAmount/NetPayable. No GST anywhere. Confirmed by peek.
- **M&P - Rose Belle (6) is empty on purpose** - the owner says the account is
  blank. QSR and Payment both answer "no record". Leave it.
- **M&P `other` holds blank statuses** - M&P send an empty RRStatus until a
  parcel finishes. `movingTrackings()` already asks about blanks first, 60 a
  sweep, so they clear by themselves.

## Unfinished

- PostEx **AH (10) and UR (11) have no webhook** (0 hits) - to be set in the
  PostEx portal. HT and RB fire normally.
- GlowCart's **total** (4,440) is not yet reconciled against the M&P portal.
- Next free migration number is **006**. Working tree clean.
