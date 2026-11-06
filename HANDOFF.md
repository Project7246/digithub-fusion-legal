# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: Daewoo read-only portal/Singapore verification.
- docs/daewoo-integration-plan.md contains verified contracts and remaining gates.
- Signed-in invoice covers/detail inspected. Private Downloads XLSX export passed
  ZIP/workbook/worksheet/header checks. No real amounts/IDs copied into tracked files.
- Portal services: Admin.asmx/GetFinancialReport (date/customer), GetReport (covers),
  GetDetailReport (invoice/customer), LoadDatewiseReport (custom reportMode 4, tab-specific).
- .d wrappers differ: financial Data JSON string; invoice Data array; date-wise .d array.
  Explicit Success/SessionExpired plus legacy literal expiry handling are required.
- No-session report redirects Login.aspx; CheckUserSession rejects. Login contract:
  Admin.asmx/AuthenticateUser(userName,password). Fresh credential auth not tested.
- Financial table pages in browser after full range response; use bounded resumable windows.
- Private integer-paisa checks: cover arithmetic internally matches; detail row count,
  COD/charges/taxes match footer, but selected detail COD DOES NOT match its cover,
  even with tested tax subtraction. Preserve exception; no automatic posting yet.
- Reimbursement types: COD Invoice (Services), COD Customer Ledger. Their loaded output,
  accounting meanings, date boundaries and upstream ownership enforcement are unverified.
- Existing DO app Healthy/SGP1; container Node GET: portal report script HTTP 200,
  API root HTTP 403. Portal reachable; root 403 is NOT an authenticated endpoint test.
- Console pastes add markers: strip prefix/trailer before Enter; Ctrl+E hits browser search.
- Pending: API credential validation, fresh portal login/renewal, full financial reconciliation.
- No adapter/account/runtime/schema/env edits or production booking/payment mutations.
  No migration reserved. Docs-only checks; app tests not rerun, no new runtime deploy claimed.
- Previous Banking f42c0c1: 22 checks passed; live 1793969262656/setup true last seen.
  Authenticated role QA unobserved; password/recovery and compact navigation retained.
- Singapore: e.availity.pk, same DO app; Neon wispy-dream-34764792 / production
  br-calm-bonus-ao4mnaaa/neondb. SESSION_SECRET/relay unchanged.
- Ohio billowing-poetry-08559264 READ-ONLY >=13 Nov; reconcile before rollback; no deletion.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload/commit contents.
- Leftovers: Trax ElRB/old M&P backfill, nine unposted CPRs, PostEx AH/UR hooks; Rose Belle unrelated.
- Task notes committed/pushed; lock released after checks. No deliberate dirty files.
