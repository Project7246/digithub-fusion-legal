# Handover - current folder state
Last agent: Claude (Sonnet 5) - 6 Nov 2026. Task: migration Step A (add e.availity.pk).

## In progress - Step A of docs/migration-2026-11.md
- Owner authorized Claude to click Hostinger + DigitalOcean directly for this one
  step only ("sb tm khud kro allowed hy aj ky liye", 6 Nov 2026). Recorded as a
  dated exception in CLAUDE.md next to the rule it sets aside. Does not cover
  Steps B-D (BASE_URL, region, DATABASE_URL) - those still wait for the owner.
- Done: Hostinger `availity.pk` DNS - added `CNAME e -> hammerhead-app-z86ki.ondigitalocean.app`,
  TTL 14400. Verified in the records list afterwards; no other record touched.
- Done: DigitalOcean `hammerhead-app` -> Networking -> Add domain -> `e.availity.pk`,
  management option "You manage your domain" (kept Hostinger nameservers - did NOT
  select "We manage your domain", which would have moved DNS off Hostinger).
  `ca.availity.pk` left as PRIMARY, untouched.
- Waiting: DigitalOcean shows `e.availity.pk` status **Pending** (certificate not
  issued yet). `https://e.availity.pk` returns no response (curl 000) until that
  finishes; DNS itself already resolves. `ca.availity.pk` confirmed unaffected
  (`/api/version` unchanged) throughout.
- Next: once Pending -> Active, verify `https://e.availity.pk` opens the app and
  `ca.availity.pk` still works, then stop - Step A ends there. Step B (BASE_URL,
  QuickBooks/Shopify redirect URIs, signs everyone out) needs the owner's go-ahead
  per PROMPT.md, separately, not folded into this.
- Agent lock still held (migration not finished). Files uncommitted before this
  task: none; this commit carries CLAUDE.md (exception note) and this file.

## Complete and verified
- Read AGENTS.md, START-HERE.md, PROMPT.md, CLAUDE.md and docs/migration-2026-11.md.
- Safe pull/pre-flight: HEAD d74f91d, origin/main equal; application working tree unchanged.
- Earlier baseline /api/version: 1793905495981 (2026-11-05T19:06:51.617Z).
- Earlier DNS check: ca CNAME targets hammerhead-app-z86ki.ondigitalocean.app; e NXDOMAIN.
- No DNS, domain, hosting, region, environment or database setting changed; no migration executed.
- Native Chrome observation temporarily recovered; input activation/bounds failed, then URL verification stopped Computer Use. Automatic review rejected further browser retries; do not bypass.
- Current configured Node, Node REPL and Windows sandbox helper files exist; earlier missing-helper error is historical, not current proof. MCP registration alone does not prove runtime access.

## Remaining and next step
- Owner may continue in a separate Chrome session; coordinate first, never run two migrations in parallel.
- Verify live consoles read-only, then prepare Step A: new e CNAME/domain while keeping ca primary. Explain check/undo and await owner instruction before each live change.
- Follow runbook A/B/C/D. New resource display names use Fusion; preserve existing IDs, links and SESSION_SECRET. No application code changes.
- Before database copy, agree how all writers/webhooks/background jobs will be quiesced and data verified. This remains unresolved.
- Files uncommitted before this task: HANDOFF.md only. This commit contains it; no application changes are pending.
- Checks: documentation diff/whitespace and under-30-line check; no application tests required for documentation-only change. Post-push deployment verification must be reported separately.
- No migration number reserved; 006 remains free. Agent lock released after push.

## Preserved Claude work and leftovers - 5 Nov 2026
- Receipts join covers and parcels as equals; covers remain visible without local parcels. M&P receipt count/cover reconciliation was verified by Claude.
- absorbPayouts reports wrote/held/lost after read-back; sync returns actual stored results.
- /api/courier/receipts refreshes accounts serially and names failed reads; Trax payment-list timeout fixed; M&P/Trax use provider-specific columns.
- Still open: parcel backfill for Trax ElRB and older M&P payments; courier covers are correct but named consignments are absent locally.
- Nine Trax CPRs unposted in QuickBooks; PostEx AH (10) and UR (11) lack webhooks; M&P Rose Belle untouched.
