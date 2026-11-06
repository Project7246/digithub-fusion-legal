# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: official invoice evidence for Daewoo COD mismatch.
- Owner reported DAEWOO_API=PASS from PC. Earlier rejection superseded; cause unknown.
  PC locations PASS is not SGP1 authenticated API, website login or CPR proof.
- daewoo-portal.js: fixed-origin, private per-instance cookie session; observed read-only
  AuthenticateUser/session/customers/GetReport/GetDetailReport; sanitized errors only.
  Redirects refused, 4 MB response cap, max seven-day range, customer/invoice identity checks.
- tools/daewoo-connection-check.mjs --portal --from YYYY-MM-DD --to YYYY-MM-DD:
  hidden normal WEBSITE login, session/customer validation, covers and one detail sample.
  Prints only fixed flags; no names, identifiers, money figures or credentials.
- Owner: portal PASS/customer CONFIRMED/CPR READ_OK; COD DIFFERENT, charges and cover math
  MATCH; taxes present, no duplicate parcels in sample. Source discrepancy reproduced.
- COD mismatch now triggers same-session official invoice PDF export (observed Print flow).
  Binary/size/redirect limits retained. Only PDF magic saved; no cookies/credentials on disk.
  Private random file in LOCALAPPDATA/FusionDaewooVerification, outside git; path guarded.
- Synthetic cookie/auth/wrapper/scope/date/paisa/missing/duplicate/mismatch checks pass.
  Existing check:all 23 checks PASS; binary/auth/export/path fixtures also PASS.
- Next: owner reruns same short-range command; inspect private official PDF for adjustments.
  Actual PDF result pending. Cause of COD difference not established; do not invent a correction.
- No adapter registered or account attached; no app routes/UI/schema/env/data writes.
  No migration reserved, unmetered timer, financial posting or production experiments.
- Native detail/footer sums previously matched; cover COD differs even after tested taxes.
  Preserve authoritative cover and detail separately; no automatic posting yet.
- Same DO app Healthy/SGP1: container portal GET 200; API root 403, not a credential test.
- Singapore e.availity.pk / same DO app; Neon wispy-dream-34764792/production/neondb.
- Ohio billowing-poetry-08559264 read-only >=13 Nov; no deletion; reconcile before rollback.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload contents.
- Leftovers: Trax ElRB/old M&P backfill, nine unposted CPRs, AH/UR hooks; Rose Belle unrelated.
- Task files only, pushed; release lock after final checks. No deliberate dirty files.
