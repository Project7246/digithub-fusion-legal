# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: account names + Daewoo large reports.
- 36e00af pushed first: admin-only Edit name on every courier account /couriers.
  Label-only scoped update; IDs, credentials, history and bank links unchanged.
- Daewoo: removed duplicate account selector/Manage account; sidebar-only scope,
  default 30-day read, no-account prompt, plain provider subtitle.
- New daewoo-report-range.js: oversized responses split into complete sequential
  date partitions; duplicate-safe merge; bounded calls/rows/bytes; no partial totals.
- Dashboard has scoped credential-keyed 2-minute/16-MiB memory cache + coalescing;
  Refresh bypasses it. Access rechecked; settlement records always fresh. No timer.
- All 31 check:all PASS; syntax/diff checks PASS. Private HR importer not run.
- Rename deployment version verified: 1794040066711 (was 1794038182246).
  Daewoo loading-fix deployment pending this commit.
  Need live Edit name control, 30-day/3-month Daewoo reads and new version check.
- Earlier 5c88daf UI visible in owner screenshot; migration 006 shipped already.
  Actual financial lock/bank confirmation remains owner task; no real test posting.
- Singapore server/DB retained; compute savings unproven. M&P tests worked;
  fresh Trax/QB round-trips pending. Ohio read-only >=13 Nov; deletion deferred;
  reconcile Singapore writes before rollback. Private migration backups retained.
- Older Trax/M&P backfills, nine Trax posting review, PostEx webhook gaps pending.
  Naming deferred; 2-3 day monitoring not scheduled. No private data/credentials.
- Dirty: task files only; will commit/push together. No new migration reserved.

