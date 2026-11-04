# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 4 Nov 2026

## Finished and pushed

- **compute.js**: the month's meter read **-498,120 hours**, so `holding` was
  never true and the stop-at guard and the sweep's pacing were both off since
  1 Nov. A spell is a duration now (`spellOf`), never negative, and a stored
  negative is read as nought. `npm run check:compute`.
- **The relay hands bodies back gzipped** and passes on `Content-Type` but not
  `Content-Encoding`, so every relayed body was read as mojibake - which is
  what "The Trax portal did not hand over a sign-in form" really was, and it
  broke Trax's API calls too. `Accept-Encoding: identity` goes out and
  `readBody()` gunzips on the way back. Verified live: Trax now answers with
  3,877 cities. `npm run check:relay`.
- **Net receivable** is one figure with its two halves named under it (unpaid
  CPR net + delivered-no-CPR estimate); the charges card shows charges and tax
  for each of those halves. The statement's closing line now equals the two
  rows above it.
- `/courier-dash` no longer rebuilds itself every 8 seconds while a catch-up
  runs; `/receipts` date controls match `/courier-dash`.

## Verified against the PostEx portal (merchant 45250, PostEx - HT)

- orders **12,189 = 12,189**; CPRs **7 = 7**; six closed **17,031,377.05** and
  one approved **4,828,910.42**, both to the paisa. PostEx HT reconciles.

## Unfinished, and what is left

- **tools/courier-relay.php must be re-uploaded to Hostinger** for its half of
  the gzip fix. Fusion's half is live and works without it.
- **PostEx - AH (10) and PostEx - UR (11) have no webhook** - 0 hits ever, so
  their statuses only move when the sweep runs. To be set in the PostEx portal.
- **Trax portal sign-in is still not saved** (`portal_ready: false` on 8 and 9);
  the owner must press Sign in - a password is theirs to enter, not Claude's.
- Trax and M&P portals not yet reconciled against the app. That is next.

## Files left dirty on purpose / migration reserved

- None. Next free migration number is **006**.
