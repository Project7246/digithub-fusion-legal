# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: persist Daewoo reports in shared courier screens.
- d34fea6 is live: `/api/version` 1794040351633. Edit-name control, shared courier styling and bounded 30-day Daewoo read verified; 3-month result remained unverified at that handoff.
- Account rename changes label only. Daewoo portal reports were previously live-only; owner now requested persisted parcels/status, CPR, payment, charges and tax data.
- Current task reserves migration 007 in this checkpoint before creating `migrations/007_daewoo_source_reports.sql`.
- Daewoo sidebar accounts should open `/courier-dash`; no changes to other providers' screens or formulas.
- Sync is manual/on-demand (no Daewoo webhook). It must preserve separate COD, delivery/tax invoice and actual bank receipt meanings; no automatic financial posting.
- Source import must be account/realm scoped and bounded; no partial success. Keep null source values distinct from numeric zero.
- Task files: `HANDOFF.md`, `couriers.js`, `daewoo-portal.js`, `daewoo-routes.js`, `daewoo-banking-router.js`, `daewoo.js`, `daewoo-map.js`, `daewoo-store.js`, `daewoo-sync.js`, migration 007, shared dashboard/matching UI, and two synthetic checks.
- All 31 repository checks passed. Commit/push and live `/api/version` verification remain; remove `.agent-lock` after deployment check.
- Ohio source remains read-only with private backups; do not delete before 13 Nov. Reconcile Singapore writes before any rollback. Compute savings are unproven.
- Fresh QuickBooks OAuth and courier-portal round trips remain to verify. Monitor normal courier sync/CPR/QB for 2-3 days.
- Older pending work: Trax/old M&P parcel backfill, review nine Trax CPR postings, PostEx webhook gaps. Naming cleanup deferred.
- No real invoice posting, settlement or bank confirmation is part of this task.
