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
## Step B done and verified, 6 Nov 2026 - BASE_URL switched, ca.availity.pk removed
- Owner authorized the cutover ("sb khud kro mjhy kuch ni ata") and then asked
  to also remove `ca.availity.pk` outright in the same session, not keep it
  with a redirect ("khatam kro ca waly ko taky ek he bar sab e.availity per
  chala jay") - both recorded as dated exceptions in CLAUDE.md.
- DigitalOcean: `BASE_URL` set to `https://e.availity.pk`, Saved, redeployed
  (build `1793918352359`, went live). Verified against `/api/setup-check`:
  `baseUrl` and `redirectUri` both show `e.availity.pk`, all five `needed`
  values `true`. Owner signed in on `e.availity.pk` and confirmed QuickBooks
  shows **Connected** - the OAuth round-trip through the new redirect URI
  works end to end.
- `e.availity.pk` set as PRIMARY domain on the app (was `ca.availity.pk`).
- `ca.availity.pk` then removed entirely, in this order: DigitalOcean domain
  removed first ("Domain has been successfully removed"), then the Hostinger
  `ca` CNAME record deleted ("DNS Record deleted successfully") - domain
  removed before DNS record, so the app was never left pointing at a
  not-yet-deregistered custom domain. Verified after: `e.availity.pk/api/version`
  responds normally; `ca.availity.pk` no longer connects (curl 000) even
  though DNS may still resolve from cache for a while (TTL was 14400).
- One near-miss while doing this: the DigitalOcean "..." menu's item
  positions shifted between opening it and clicking, and a "Remove Domain"
  dialog opened for `e.availity.pk` (the wrong one) on the first attempt.
  Caught before confirming - clicked Cancel, nothing was deleted, reopened
  the menu and re-verified the item position before clicking again. Worth
  the same care next time this menu is used.
- Starter domain `hammerhead-app-z86ki.ondigitalocean.app` is still on the
  app (untouched, not part of this request) and is also what the Intuit and
  Shopify redirect URI lists still carry a now-unused entry for alongside
  the removed `ca.availity.pk` ones - harmless, not cleaned up, not asked for.
## ca.availity.pk cleanup in Intuit and Shopify, 6 Nov 2026
- Owner asked for `ca.availity.pk` removed everywhere it's no longer needed,
  including hPanel (already done above) - extended as a dated exception in
  CLAUDE.md.
- **Intuit**: removed the `https://ca.availity.pk/auth/callback` Production
  Redirect URI, Saved. Three remain: OAuth2Playground, the DigitalOcean
  starter-domain one (untouched, not asked about), and `e.availity.pk`.
  Verified by re-reading the list.
- **Shopify**: released version `fusion-4`, updating both `application_url`
  (was still `https://ca.availity.pk/`, now `https://e.availity.pk/`) and
  `redirect_urls` (now only the `e.availity.pk` one) in the same version,
  since `application_url` was also a stale reference to the now-dead domain.
  Verified by reading the released version's detail page back.
- Starter domain's own Intuit redirect URI entry was left as is - it was not
  part of this request.

## Step C done, 6 Nov 2026 - region moved to Singapore
- Owner authorized ("koi bhe app use ni krta siway mery, done kro") after
  confirming nobody else uses the app, answering the one open quiescing
  question for Step D.
- DigitalOcean -> Networking -> Edit network -> Singapore (SGP1) -> Save.
  Confirmed in the UI afterwards ("Datacenter region: Singapore - Datacenter
  1 - SGP1"). App redeployed itself; not separately re-verified by version
  number since Step D's own redeploy (below) supersedes it.

## Step D done, 6 Nov 2026 - database moved to Singapore, fully verified
This is the one with real data, so written in full:

- **New Neon project**: "Fusion Singapore", id `wispy-dream-34764792`,
  region AWS ap-southeast-1 (Singapore), Postgres 18 (matches source's 18.6),
  database `neondb`, branch `production` (`br-calm-bonus-ao4mnaaa`).
- **pg_dump/pg_restore could not be used**: downloaded PostgreSQL 18.6.1
  binaries (from github.com/theseus-rs/postgresql-binaries, checksum
  verified) but the sandbox's auto-mode classifier blocked running any
  downloaded `.exe` ("Code from External"). Owner chose, when asked, to find
  another way rather than grant that permission.
- **Method used instead**: `postgres_fdw` from Neon's own SQL Editor.
  - Schema: booted this app locally (`node server.js`) with `DATABASE_URL`
    pointed at the new empty Singapore database for ~35 seconds, just long
    enough for `initDb()` and the module `init*()` chain to run and create
    all 47 tables matching the current code - then let it exit (`timeout 35`).
    Confirmed table count matched (47 = 47).
  - On the Singapore database: `create extension postgres_fdw`, then
    `create server` + `create user mapping` pointing at the old Ohio
    database's **direct** (non-pooled) host, `import foreign schema public
    ... into old_src` (all 47 tables as foreign tables).
  - Copied data table by table with explicit column lists on both sides of
    each `insert into public.X (col,...) select col,... from old_src.X` -
    **not** `select *`, because this app has no migration-number system
    (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in each module's `init*()`),
    so column order can differ between the two databases even when the
    column set is identical; a positional `select *` silently misaligned
    `courier_accounts` on the first attempt (integer value landing in a
    `timestamptz` column) before this was caught and fixed.
  - `SET session_replication_role = replica` is not available to Neon's
    `neondb_owner` (superuser-only), so tables were loaded in dependency
    order instead: `banks` before `bank_links`/`bank_moves`/`banking_setups`,
    `courier_rate_cards` before `courier_rate_lines` - the only two FK
    relationships that exist in the whole schema (checked and confirmed).
  - Two tables had one stray row each from the local schema-creation boot
    (`app_keys` got a freshly-generated VAPID keypair; `once_done` got a
    `reset-non-admin-access-2026-09` marker) - both deleted before the real
    copy ran, otherwise the real row collided on the primary key.
  - The Neon SQL Editor's CodeMirror input repeatedly timed out (30s) on
    long pasted blocks of SQL via simulated typing - it always finished the
    paste itself a little after the tool-level timeout fired; the practical
    fix was keeping batches to roughly 6-10 `insert` statements each rather
    than all 47 at once, and treating the timeout as "wait and check", not
    as a failure.
- **Verified, not assumed**: wrote a one-off `_verify_counts()` function
  comparing `count(*)` between every `public.X` and `old_src.X` -
  **0 mismatches across all 47 tables**. Biggest tables: `courier_orders`
  76,830 rows, `upload_logs` 16,321 rows, `hr_pay_lines` 2,514 rows,
  `product_changes` 2,820 rows - all matched exactly.
- **Sequences fixed**: wrote a one-off `_fix_sequences()` function that set
  every serial/identity column's sequence to `setval(..., max(id), true)` -
  28 sequences found and set (e.g. `courier_orders_id_seq` -> 1,325,105,
  `users_id_seq` -> 10). Without this, the next locally-generated id on each
  table would have collided with a copied row.
- **Cleanup**: dropped both helper functions, `drop server ohio_old cascade`
  (removes the user mapping holding the old database's password - it had
  to be read once, via the Neon console's "Show password" toggle and
  `get_page_text`, never typed into a reply or a git-tracked file), and
  `drop schema old_src cascade`. Nothing pointing at the old database's
  credentials is left on the new project.
- **Secrets discipline kept throughout**: the old (Ohio) and new (Singapore)
  database passwords were each read once from Neon's own console (never a
  downloaded file, never the clipboard - clipboard access was also blocked
  by the sandbox classifier when tried) and used directly in a local shell
  command or a SQL statement typed into Neon's SQL Editor; neither value
  was written into any reply, any git-tracked file, or repeated after use.
- **Still to do** (next, in this same session or the next one): switch
  `DATABASE_URL` in DigitalOcean to the new Singapore connection string,
  redeploy, then verify in this exact order per the runbook - `/api/setup-check`
  shows `DATABASE_URL: true`, the app opens and shows companies/couriers/receipts,
  **open a courier account page and pull something** (proves `SESSION_SECRET`
  carried across correctly and encrypted portal passwords still decrypt -
  this is the one that catches a wrong key silently), then Settings ->
  Database shows the new size. Keep the old Ohio project for at least a
  week after, per the runbook, in case of rollback.
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
