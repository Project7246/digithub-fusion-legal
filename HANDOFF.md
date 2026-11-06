# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: sanitized Daewoo rejection diagnosis.
- tools/daewoo-connection-check.mjs: fixed HTTPS read-only getLocations, muted inputs,
  no input history, redirects refused, 25s timeout, only sanitized status output.
  No credential values in code/arguments/files/logs. Node-only, no dependencies/settings.
- Run: node tools/daewoo-connection-check.mjs. Owner pastes three credentials privately.
  Owner result REJECTED; reason unresolved. New DAEWOO_REASON categories require private rerun.
- Offline --self-test: 9 response + 11 safe-reason + hidden-input/no-echo checks PASS.
  Node syntax/whitespace PASS. Earlier PowerShell draft removed; no policy bypass/change.
- docs/daewoo-integration-plan.md holds contracts/findings and helper instructions.
- Native UI reads began timing out; owner is doing manual API Management inspection.
- Previously: portal invoice export passed private XLSX integrity/header checks.
- Services: Admin.asmx/GetFinancialReport, GetReport, GetDetailReport,
  LoadDatewiseReport (custom mode 4). Wrappers vary; explicit session/error handling needed.
- Auth: no-session report redirects Login.aspx and session check rejects; public login
  contract AuthenticateUser(userName,password). Fresh server login/renewal NOT tested.
- Financial report is browser-paged after full range response: use bounded windows.
- Private paisa checks: cover internally matches; detail row count/COD/charges/taxes
  match footer, but detail COD DOES NOT match cover, even tested tax subtraction.
  Preserve exception; no automatic posting. Service/ledger output semantics unverified.
- Existing app Healthy/SGP1. Container portal script GET 200; API root GET 403.
  Portal reachable; API root response is NOT a credential test. No relay/env changes.
- No Daewoo adapter/account/runtime/schema edits or booking/payment mutations; no migration.
  API Management password must be used; portal-login password is not assumed identical.
- Banking f42c0c1 previously passed 22 checks; password/recovery and navigation retained.
- Singapore e.availity.pk / same DO app; Neon wispy-dream-34764792/production/neondb.
- Ohio billowing-poetry-08559264 read-only >=13 Nov; no deletion; reconcile before rollback.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload contents.
- Leftovers: Trax ElRB/old M&P backfill, nine unposted CPRs, AH/UR hooks; Rose Belle unrelated.
- Task files only, pushed; lock released after check. No deliberate dirty files.
