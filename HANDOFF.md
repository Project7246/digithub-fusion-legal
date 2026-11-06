# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: separate Banking section access.
- Owner override: opened Banking beyond ADMIN_EMAILS; separate Banking reports / Manage Banking.
- All access includes management; Reports only reads; custom grants bankingreports / banking.
- banking-access.js owns method-aware guards and scoped access audit; every bank route still
  requires company membership and existing realm-filtered operations. No money formula changed.
- access.js separates page discovery from writes; whoIs preserves v2 grants; existing access
  editors receive Banking options. Portal edits preserve per-module money restrictions.
- users.js/accounts.js audit Banking grant changes/initial staff grants atomically with rights.
  Existing banking_entry_audit stores actor, before/after and timestamp; no migration required.
- public/banking.html: reports/CPRs/exports for readers; management tabs/actions hidden and
  direct management views normalized. Writes remain server-blocked for report-only users.
- nav.js/tiles.js/index.html show implemented authorized pages; removed future placeholders
  and misleading Being built launcher fallback. Existing layout/profile links retained.
- Checks: npm.cmd run check:all PASS (22 checks), including synthetic Banking access/audit,
  UI, cross-company CPR checks, money fixtures, shared navigation and password regression.
  Syntax/whitespace PASS; HR file importer excluded because private input folder is absent.
- Live baseline before push: 1793962887392; setup values all true. Post-push verification pending.
  No authenticated browser QA: owner refreshes Banking and People access editor, then verifies
  reports-only read access and management access using their own authorized accounts.
- Previous password self-service and super-admin recovery retained (6a0a6db); prior compact
  navigation and Settings/Database entry retained. No production account/data tests performed.
- Singapore migration: e.availity.pk, same DO app SGP1; Neon wispy-dream-34764792,
  production br-calm-bonus-ao4mnaaa / neondb. SESSION_SECRET and relay unchanged.
- Ohio billowing-poetry-08559264 READ-ONLY >=13 Nov; do not delete; reconcile before rollback.
  Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload/commit contents.
- Leftovers: Trax ElRB/old M&P backfill, nine unposted CPRs, PostEx AH/UR hooks; Rose Belle unrelated.
- No dirty files at takeover; task files only. No migration reserved. Lock released after push/check.
