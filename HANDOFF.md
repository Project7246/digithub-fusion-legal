# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: account names first, Daewoo loading next.
- New admin-only Edit name action on every courier account in /couriers.
  Changes label only, scoped by realm+id; retains credentials/history/bank links.
- New courier-account-router.js; server.js wiring; public/couriers.html button.
- Rename tests and all 30 check:all PASS; private HR importer not run.
- Previous Daewoo parity/Banking change 5c88daf is visible in owner screenshot.
  Real invoice lock/bank confirmation not tested; migration 006 already shipped.
- IN PROGRESS: Daewoo RESPONSE_TOO_LARGE recovery, short scoped cache and removal
  of duplicate dashboard account dropdown/Manage account link, requested by owner.
- Deliberately dirty daewoo-portal.js + new daewoo-report-range.js contain initial
  adaptive splitting/cache helper; NOT part of this rename commit. Finish + test.
- Deployment verification pending; continue Daewoo work after rename push.
- Singapore server/DB retained; compute savings unproven. M&P tests worked;
  fresh Trax/QB round-trips pending. Ohio read-only >=13 Nov, deletion deferred;
  reconcile Singapore writes before rollback. Private migration backups retained.
- Older Trax/M&P backfills, nine Trax posting review, PostEx webhook gaps pending.
  Naming deferred; 2-3 day monitoring not scheduled. No private data/credentials.
