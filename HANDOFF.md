# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: guided final database migration; NOT complete.
- Owner transferred Claude's unfinished task; only Codex should continue this folder.
- A/B done: e.availity.pk primary and BASE_URL switched; ca domain/DNS/callback removed.
- Intuit callback uses e; fresh OAuth round-trip still not proven. Shopify Pureclans fusion-4 uses e.
- C: owner screenshot confirms app Healthy in SGP1, source main, recent commit 00cfc5e.
- Ohio source: billowing-poetry-08559264 / production br-wispy-sound-b4yb0j31 / neondb.
- Singapore target: wispy-dream-34764792 / production br-calm-bonus-ao4mnaaa / neondb, PG18.
- Claude's historical FDW copy/counts/sequences are recorded in HANDOFF history at 08faca6.
- Current owner CSV exports show 47 tables each; courier_orders Ohio 76934 vs target 76830,
  shopify_events 427 vs 428; other 45 counts match. Content equality is NOT established.
- Owner explicitly reports DigitalOcean maintenance mode enabled. Do not assume keeper stops.
- PostgreSQL 18.6 pg_dump/pg_restore/psql found under TEMP/claude scratchpad; --version works.
- Added tools/fusion-migration.ps1: owner runs manually; hidden connection prompts, region/version
  guards, MIGRATE confirmation, private target backup, Ohio read-only default + terminate sessions,
  final source dump, atomic target restore, full-row fingerprints/column/sequence comparisons.
- Helper NOT executed on databases yet. Ohio freeze NOT performed by Codex; DATABASE_URL unchanged.
- Checks: PowerShell parse, synthetic password URI decoding/direct-host conversion and wrong-region
  refusal PASS; git diff whitespace PASS. No app code changed or application tests required.
- Next: guide owner to run helper and enter source/target strings privately from Neon Connect.
  Keep maintenance ON until verified copy, DATABASE_URL save/deploy and live checks complete.
- Preserve SESSION_SECRET, PORTAL_KEY behavior, relay and all other settings. No credential in logs/git.
- On helper failure leave maintenance on; report phase. -UnfreezeOhio restores source write default
  only for rollback BEFORE resuming Ohio. After target writes, reconcile before switching back.
- Retain Ohio >= one week. No deletion, rename, new app or numbered migration authorized/needed.
- Browser host unavailable; native control last stopped on inability to verify current browser URL.
  Work is guided through owner screenshots; do not repeat unsupported browser recovery loops.
- Verify setup-check, companies/couriers/receipts, courier portal pull, Trax reach, Database size/OAuth.
- Leftovers: Trax ElRB/old M&P backfill; nine Trax CPRs unposted; PostEx AH/UR hooks; Rose Belle.
