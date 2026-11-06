# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: compact shared rail/home cards and clearer selected headings.
- User accepted prior Settings/hierarchy change, requested less spacing/scroll and theme selection.
- Changed public/app.css (non-:root): tighter brand/nav/rows/indents; aqua active links with
  dark text, teal-tinted active parents; labels keep wrapping rather than being cut off.
- public/nav.js: one top-level group open, compact overview default, last group remembered;
  active route wins on work pages. Adds selected ancestor classes and aria-current links.
- public/index.html: compact icon/title card grid, 4/3/2/1 responsive columns; short-height rule.
- public/tiles.css: compact module tile shelves consistently across app sections/companies.
- Extended tools/navigation-check.mjs: compact defaults, remembered/active groups, accordion,
  selected semantics; existing exact account matching, rights pruning and Settings tests retained.
- Docs: docs/pages-and-screens.md. No server, money, scope, config, :root or poller changes.
- Checks: npm.cmd run check:all PASS (20 checks), navigation fixture PASS, git diff whitespace PASS.
- Pre-push live baseline 1793954901328, setup-check all required true. Post-push version pending.
- Visual viewport/browser layout not independently verified (browser connector/native input
  unreliable). Owner should refresh and inspect home grid + active rail on normal/narrow screens.
- No data is hidden to remove scrolling; very narrow/short windows or large zoom may still scroll.
- Previous super-admin profile Settings -> /settings#storage remains; actual server rights unchanged.
- Singapore migration retained: e.availity.pk, same app SGP1; Neon Fusion Singapore
  wispy-dream-34764792 / production br-calm-bonus-ao4mnaaa / neondb.
- Ohio billowing-poetry-08559264 stays READ-ONLY >=13 Nov; no deletion authorized.
  Reconcile new Singapore writes before rollback. SESSION_SECRET and relay preserved.
- Final copy matched 47 row fingerprints, 538 columns, 28 sequences. Private backups outside git:
  LOCALAPPDATA/FusionMigration/20261106-055453; never upload/commit their contents.
- Owner verified companies/CPR, all courier Tests Works, Database screen 105.1 MB/10.3%.
  Fresh QB OAuth/independent portal round-trip unobserved; copied compute meter is not savings.
- Leftovers unchanged: Trax ElRB/old M&P backfill, nine unposted CPRs, PostEx AH/UR hooks,
  M&P Rose Belle unrelated work. No migration number reserved. No unrelated dirty files.
