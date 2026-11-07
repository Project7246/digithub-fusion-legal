# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: attach Daewoo live-report connector in app.
- Added daewoo.js registry adapter: non-secret portal user as account token;
  API key/user/password + portal password in existing encrypted extra credentials.
  Save tests locations API, fresh portal login and exact/unique customer selection.
- Added scoped daewoo-routes.js (/api/daewoo), registered in server.js;
  report/money grants + realm/account/customer/invoice ownership checks.
- /daewoo page: orders/status, COD/CPR covers, service references, selected
  invoice detail/RST/WHT. Original/null figures preserved; search/pagination;
  manual reads only, abort/ignore stale scope responses. Shared nav/labels wired.
- Explicit limit: live reports, NOT stored parcel/CPR import or tracking API
  sweeps. No financial posting/settlement inference/webhook advertised. Keeper
  skips manualOnly; shared Pull/hook selectors exclude it. No schema/migration.
- Existing daewoo-finance.js typed invoices/payment allocations retained;
  payment advice/allocations, date completeness/order mapping still need proof.
- Tests: all 26 check:all PASS; server syntax and diff check PASS.
  Real saved account/report test awaits owner-entered app credentials.
- Migration follow-up retained: Singapore project confirmed; 2.33 CU-hours
  baseline includes possible copy work, savings unproven. Both M&P tests had no
  visible error and refreshed sync times. Fresh Trax/QB round-trips pending.
- Prior DO console blank/cached; exact active commit not independently read.
  Prior live version 1794010292045, e base/callback, all required values true.
- Ohio read-only >=13 Nov; no deletion, reconcile Singapore writes before rollback.
  Both private backups present/non-empty: LOCALAPPDATA/FusionMigration/20261106-055453.
- Older Trax/M&P backfills, nine Trax posting review, PostEx webhook gaps remain.
  Naming deferred; 2-3 day monitoring needs dated observations, not scheduled.
- No private exports/credentials committed. Task files only; deployment pending.
