# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: Daewoo analysis and integration plan only.
- Owner wants identical shared courier UI; API differs. Owner confirms merchant portal
  https://codportal.daewoo.net.pk/Index.aspx and no webhook/other published API.
- PDF filename v1.3, contents v1.6 (2021); API has tracking, no documented order-list/CPR.
- Native Chrome read-only inspection confirmed DatewiseBookingReport.aspx with parcel,
  status/COD/charge columns and Excel export; CODInvoiceSummaryReport.aspx has invoice,
  COD/charges/reimbursed totals and Excel; CODReimburseDet.aspx has report filters.
  No records loaded/exported, no booking/cancellation/settings change; tabs left open.
- docs/daewoo-integration-plan.md records endpoint/field mapping, portal-reader + tracking
  design, import fallback, status/identity contradictions, unknown-money handling,
  company isolation, redaction, compute pacing, validation stages and unresolved gates.
- docs/logistics-couriers.md links plan and supersedes old Daewoo-not-started scope note.
- Next: inspect private portal report/session flow and invoice detail; verify ownership,
  date/pagination/export semantics, actual charges/tax/settlements and SGP1 connectivity.
  Same UI feasible; fully automatic financial integration not yet proven. No adapter built.
- Owner prioritizes Financial Summary CPR/delivery-charge sources over huge parcel report.
  FinancialReport.aspx headers confirmed: separate payment/service invoice IDs, payment
  status, COD, charges, payable and paid amounts; no private figures logged. Plan updated
  for covers first, bounded resumable date windows and verified server pagination.
- Docs-only: whitespace checked, app tests not rerun. No runtime/schema/env/data edit or migration.
- Previous Banking f42c0c1: 22 checks passed; current live version 1793969262656 and setup true.
  Authenticated role QA still unobserved; password/recovery and compact navigation retained.
- Singapore: e.availity.pk, same DO app SGP1; Neon wispy-dream-34764792 / production
  br-calm-bonus-ao4mnaaa / neondb. SESSION_SECRET/relay unchanged.
- Ohio billowing-poetry-08559264 READ-ONLY >=13 Nov; do not delete; reconcile before rollback.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload/commit contents.
- Leftovers: Trax ElRB/old M&P backfill, nine unposted CPRs, PostEx AH/UR hooks; Rose Belle unrelated.
- No dirty files at takeover; task scratch cleaned. Lock released after docs push/check.
