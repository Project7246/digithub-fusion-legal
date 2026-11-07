# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: Daewoo UI parity + Banking invoice locks.
- Owner confirmed Daewoo connection/CPR/charges working after 72849ac.
- Standard Parcels / Finance / Receipts + subtabs now share courier-dashboard.css;
  former courier styles extracted unchanged; other courier handlers/formulas unchanged.
- Provider extras: delivery/tax detail and Banking invoice matching; missing pickup
  dates and unallocated parcel nets remain unavailable. No stored parcel import/timer.
- New daewoo-locks/store/banking-router + matching widget: exact allocations,
  pending lock, separate actual bank receipt, audited reversal; existing dated
  bank links/fiscal placement via transactional saveCprs. No QuickBooks posting.
- Migration 006_daewoo_settlements.sql RESERVED/created this task; startup applies
  once transactionally. Both new tables have realm filters + FORCE RLS.
- Tests: all 29 check:all PASS; syntax + diff checks PASS; reversed-history
  preview regression PASS. Private HR file importer not run (owner folder needed).
- Deployment pending this commit; pre-push version 1794030492058. Live tabs and
  migration startup need verification; no real financial lock/receipt executed.
- Owner check: one documented invoice match and separate actual bank confirmation.
- Singapore server/database retained. Neon 2.33 CU-hour baseline includes copy;
  savings unproven. Both M&P tests worked; fresh Trax/QB round-trips pending.
- Ohio read-only >=13 Nov; deletion deferred; reconcile Singapore writes before
  rollback. Private backups LOCALAPPDATA/FusionMigration/20261106-055453 retained.
- Older Trax/M&P backfills, nine Trax posting review and PostEx webhook gaps pending.
  Naming deferred; 2-3 day monitoring needs observations, not scheduled.
- Dirty: task files only, including this checkpoint. No credentials/private exports.
