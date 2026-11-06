# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: Daewoo private portal/session + invoice verifier.
- Owner reported DAEWOO_API=PASS from PC. Earlier rejection superseded; cause unknown.
  PC locations PASS is not SGP1 authenticated API, website login or CPR proof.
- daewoo-portal.js: fixed-origin, private per-instance cookie session; observed read-only
  AuthenticateUser/session/customers/GetReport/GetDetailReport; sanitized errors only.
  Redirects refused, 4 MB response cap, max seven-day range, customer/invoice identity checks.
- tools/daewoo-connection-check.mjs --portal --from YYYY-MM-DD --to YYYY-MM-DD:
  hidden normal WEBSITE login, session/customer validation, covers and one detail sample.
  Prints only fixed flags; no names, identifiers, money figures or credentials.
- Next owner step: private portal diagnostic on the September report period (short window).
  Portal-run result PENDING. Login credentials may differ from API Management.
- tools/daewoo-portal-check.mjs written first with known synthetic money/session fixtures;
  cookie/auth/wrapper/error/scope/date/paisa/missing/duplicate/mismatch checks pass.
  Added to check:all: 23 checks PASS; final targeted scope tests rerun PASS.
  Existing API helper self-test (9 response + 11 reason + hidden input) PASS.
- docs/daewoo-integration-plan.md and logistics notes updated with actual phase.
- No adapter registered or account attached; no app routes/UI/schema/env/data writes.
  No migration reserved, unmetered timer, financial posting or production experiments.
- Native verification: export XLSX valid; selected detail/footer sums match but COD differs
  from its cover, even tested tax subtraction. Preserve exception; no automatic posting.
- Portal reports are browser-paged full-range responses; future sync must use bounded windows.
- Same DO app Healthy/SGP1: container portal GET 200; API root 403, not a credential test.
- Banking f42c0c1 previously passed 22 checks; personal passwords/recovery/nav retained.
- Singapore e.availity.pk / same DO app; Neon wispy-dream-34764792/production/neondb.
- Ohio billowing-poetry-08559264 read-only >=13 Nov; no deletion; reconcile before rollback.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload contents.
- Leftovers: Trax ElRB/old M&P backfill, nine unposted CPRs, AH/UR hooks; Rose Belle unrelated.
- Task files only, pushed; release lock after final checks. No deliberate dirty files.
