# Handover - current folder state
Last agent: Claude (Sonnet 5) - 6 Nov 2026. Task: migration Step A (add e.availity.pk).

## Step A of docs/migration-2026-11.md - DONE and verified, 6 Nov 2026
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
- Certificate finished provisioning. Both domains now Active in DigitalOcean
  Networking: starter domain, `ca.availity.pk` (PRIMARY), `e.availity.pk`.
  `https://e.availity.pk/api/version` and `https://ca.availity.pk/api/version`
  both return the same version (`1793914031013`) - same live app, nothing
  user-facing changed.
- Step A is complete. **Not started**: Step B (BASE_URL to e.availity.pk,
  QuickBooks + Shopify redirect URIs added first, signs everyone out), Step C
  (region to Singapore), Step D (database to Singapore). Each needs the owner's
  go-ahead separately per PROMPT.md - none folded into this session's override.
- The 6 Nov "allowed hy aj ky liye" override in CLAUDE.md covered Step A's two
  clicks only; it does not carry forward to Steps B-D.

## Step B prep done, 6 Nov 2026 - redirect URIs only, BASE_URL not touched
- Owner extended the override ("dono login kr diy hy ... tm krdo") to add the
  two redirect URIs Step B needs, ahead of time, per the runbook's own
  instruction to add them *before* BASE_URL changes.
- **Intuit/QuickBooks** (`developer.intuit.com`, app "Fusion", workspace
  DigitHub, AppID starts `392c7def...`): added
  `https://e.availity.pk/auth/callback` to the **Production** Redirect URIs.
  The old `https://ca.availity.pk/auth/callback` and the two original entries
  (OAuth2Playground, the DigitalOcean starter domain) are untouched - 4 URIs
  total now. Saved and verified by re-reading the list.
- **Shopify** (store `pureclans`, custom app "Fusion", Partners org "Availity
  Consultancy", org id 154801226, app id 437145206785): the app is CLI/Dev-Dashboard
  managed (no config file in this repo) - redirect URLs are set by creating a
  new app version in the Dev Dashboard, not a simple settings form. Created and
  released version `fusion-3`: `application_url` left as `https://ca.availity.pk/`
  (unchanged - that is Step B's actual cutover), `redirect_urls` now holds both
  `https://ca.availity.pk/auth/shopify/callback` and
  `https://e.availity.pk/auth/shopify/callback`. Verified by reading the
  released version's detail page back.
- Still not done, still waiting on the owner: Step B's actual cutover
  (`BASE_URL` env var in DigitalOcean, and Shopify's `application_url` if that
  needs updating too - the runbook doesn't say it does, only the redirect
  URLs), which signs everyone out. Steps C (region) and D (database) also
  untouched.
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
