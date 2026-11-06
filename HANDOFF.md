# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: updated Daewoo tax PDF verification.
- Owner API/portal login PASS, customer CONFIRMED, CPR READ_OK; charges/cover arithmetic
  MATCH, COD DIFFERENT, taxes present, no duplicate parcels in sampled detail.
- Updated private PDF shows RST/WHT and payable; same invoice matched private XLSX.
  COD differs, charges match; adding/subtracting both taxes does not explain difference.
  COD minus charges and both taxes also differs from summary payable; basis unresolved.
- Original unchanged in Downloads; scratch cleaned. No private figures/IDs logged.
- reconcileInvoice returns reconciliationRequired for mismatch/missing/duplicate conditions;
  inputs untouched. Helper prints this plus FINANCIAL_POSTING=DISABLED. No posting route exists.
- Removed automatic unverified print/export request/save from checker; do not repeat reruns.
  Owner got NOT_PDF; response MIME/schema remains unknown, no arbitrary format accepted.
  Raw read-only invoiceExport transport remains for later validated support.
- Removed arbitrary seven-day clamp from client/helper. Full ISO-date range is forwarded
  directly to GetReport; no truncation/splitting/dedup. Auth/session/scope checks retained.
- Tests: full monthly request includes month-end and matches all non-overlapping partitions;
  existing session/scope/paisa/privacy/missing/duplicate checks and no-input-mutation checks.
- Actual upstream monthly boundaries/format and COD basis remain unverified; no correction
  invented. documents/plan notes in docs/daewoo-integration-plan.md and logistics module.
- No adapter registered, account attached, DB/schema/env settings or production records changed.
  No migration reserved, timers, booking/cancellation/payment changes or production experiments.
- Same DO app Healthy/SGP1; container portal 200, API root 403 (not an auth endpoint check).
- Singapore e.availity.pk, Neon wispy-dream-34764792/production/neondb; secrets unchanged.
- Ohio billowing-poetry-08559264 read-only >=13 Nov; no deletion; reconcile before rollback.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload contents.
- Previous Banking/password/nav work retained; prior courier leftovers unchanged.
- All 23 check:all checks PASS; diff check PASS. No deliberate dirty files.
- Updated PDF review is docs-only; no new code checks needed. Deployment check pending.
