# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: preserve latest migration preparation.

## Complete and verified
- Read AGENTS.md, START-HERE.md, PROMPT.md, CLAUDE.md and docs/migration-2026-11.md.
- Safe pull/pre-flight: HEAD d74f91d, origin/main equal; application working tree unchanged.
- Earlier baseline /api/version: 1793905495981 (2026-11-05T19:06:51.617Z).
- Earlier DNS check: ca CNAME targets hammerhead-app-z86ki.ondigitalocean.app; e NXDOMAIN.
- No DNS, domain, hosting, region, environment or database setting changed; no migration executed.
- Native Chrome observation temporarily recovered; input activation/bounds failed, then URL verification stopped Computer Use. Automatic review rejected further browser retries; do not bypass.
- Current configured Node, Node REPL and Windows sandbox helper files exist; earlier missing-helper error is historical, not current proof. MCP registration alone does not prove runtime access.

## Remaining and next step
- Owner may continue in a separate Chrome session; coordinate first, never run two migrations in parallel.
- Verify live consoles read-only, then prepare Step A: new e CNAME/domain while keeping ca primary. Explain check/undo and await owner instruction before each live change.
- Follow runbook A/B/C/D. New resource display names use Fusion; preserve existing IDs, links and SESSION_SECRET. No application code changes.
- Before database copy, agree how all writers/webhooks/background jobs will be quiesced and data verified. This remains unresolved.
- Files uncommitted before this task: HANDOFF.md only. This commit contains it; no application changes are pending.
- Checks: documentation diff/whitespace and under-30-line check; no application tests required for documentation-only change. Post-push deployment verification must be reported separately.
- No migration number reserved; 006 remains free. Agent lock released after push.

## Preserved Claude work and leftovers - 5 Nov 2026
- Receipts join covers and parcels as equals; covers remain visible without local parcels. M&P receipt count/cover reconciliation was verified by Claude.
- absorbPayouts reports wrote/held/lost after read-back; sync returns actual stored results.
- /api/courier/receipts refreshes accounts serially and names failed reads; Trax payment-list timeout fixed; M&P/Trax use provider-specific columns.
- Still open: parcel backfill for Trax ElRB and older M&P payments; courier covers are correct but named consignments are absent locally.
- Nine Trax CPRs unposted in QuickBooks; PostEx AH (10) and UR (11) lack webhooks; M&P Rose Belle untouched.
