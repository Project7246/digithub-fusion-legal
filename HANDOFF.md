# Handover - current folder state
Last agent: Codex - 7 Nov 2026. Task: Daewoo separate invoices/payment model.
- Owner clarified: COD/CPR invoices and delivery/tax invoices are separate;
  applicable invoices are deducted at payment. Earlier cover/detail difference
  is NOT proof of settlement discrepancy. No source values changed.
- Added daewoo-finance.js: scoped typed docs + explicit payment allocations,
  exact paisa, partial balances, duplicate/over-allocation checks, no double tax.
  MATCH is arithmetic of declared links only; bank proof false, posting disabled.
- Renamed comparison to compareInvoiceFigures; no settlement inferred there.
  Helper now reports DOCUMENT_LINKS_REQUIRED. No credential rerun needed.
- Portal financialRows preserves separate service/payment invoice references,
  paid/payable/null fields; synthetic HTTP and scope contracts checked.
- Native portal ledger/services reports loaded/exported privately in Downloads:
  COD Booking  FastEX (1).xlsx = ledger; (2).xlsx = services. Never upload/commit.
  Bank-paid descriptions have no observed invoice-reference pattern; services
  export lacks invoice refs/RST/WHT. Two service sums need source-basis review.
  Ledger selected month returned longer history; date behavior unverified.
- Next: identify service invoice IDs/payment allocation source, verify dates and
  full order discovery/mapping, then register adapter/shared courier UI.
- No account attached, DB/schema/env/production record changes or migration reserved.
- Checks: all 24 check:all PASS; helper self-test and diff check PASS.
- Singapore e.availity.pk / Neon wispy-dream-34764792; secrets unchanged.
  Ohio billowing-poetry-08559264 read-only >=13 Nov; retain rollback, no deletion.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload.
- Prior Banking/password/navigation and old courier leftovers retained.
- Task files only; no deliberate dirty files after commit. Deployment check pending.
