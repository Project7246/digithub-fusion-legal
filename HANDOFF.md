# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: app-wide network loading cue and Daewoo sync status.
- `7c1eb85` pushed Daewoo persistent report import and shared courier workflow. Owner screenshot shows shared Daewoo dashboard; initial version request still returned 1794040351633, so check live version after this push.
- Current change: `public/nav.js` tracks concurrent fetches; after 180 ms it shows progress cursor and small spinner; quick requests do not flash. It does not block input.
- Daewoo sync button now spins while syncing and has its own accessible status text, isolated from the dashboard's background refresh message.
- Checks: `npm.cmd run check:all` => 31 passed; private HR files check not run. `git diff --check` passed.
- Current task files: `public/nav.js`, `public/courier-dash.html`, `docs/pages-and-screens.md`, `docs/logistics-couriers.md`, `tools/navigation-check.mjs`, `tools/daewoo-app-check.mjs`, `HANDOFF.md`.
- Still to commit/push and check `/api/version`, then remove `.agent-lock`.
- Daewoo source sync is manual and limited to 200 COD covers / 100,000 detail rows; user must run it for the chosen date range after deployment. No bank posting is automatic.
- Ohio source remains read-only with private backups; do not delete before 13 Nov. Reconcile Singapore writes before rollback. Compute savings unproven.
- Fresh QuickBooks OAuth/courier-portal round trips remain to verify; monitor courier sync/CPR/QB for 2-3 days.
- Older pending work: Trax/old M&P backfill, review nine Trax CPR postings, PostEx webhook gaps. Naming cleanup deferred.
