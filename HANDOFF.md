# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: Daewoo selected-period finance totals.
- Fixed Daewoo booking date parsing and COD invoice detail matching so selected
  date ranges can include previously undated parcels and their charges/tax.
- Daewoo re-sync updates existing booked_on values; other courier behavior stays
  unchanged. Owner must re-sync Daewoo reports after deployment.
- Checks: Daewoo app, portal, settlement, and banking checks passed; `npm.cmd
  run check:all` passed (31 checks; private HR files check skipped); diff check passed.
- Current task files: `couriers.js`, `daewoo-map.js`,
  `docs/logistics-couriers.md`, `tools/daewoo-app-check.mjs`, this file.
- Still to commit/push and verify `/api/version` and live Daewoo finance page;
  remove `.agent-lock` after verification.
- Daewoo source sync is manual. Sync the needed date range after the fix deploys;
  no bank posting is automatic.
- Ohio source remains read-only with private backups; do not delete before 13 Nov.
  Reconcile Singapore writes before rollback. Compute savings unproven.
- Fresh QuickBooks OAuth/courier-portal round trips remain to verify; monitor
  courier sync/CPR/QB for 2-3 days.
- Older pending work: Trax/old M&P backfill, review nine Trax CPR postings,
  PostEx webhook gaps. Naming cleanup deferred.
