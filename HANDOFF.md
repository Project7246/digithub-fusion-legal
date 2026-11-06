# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: self-service passwords + super-admin staff-ID recovery.
- New account-password.js router: POST /api/me/password targets only verified session user,
  requires current password + new/confirmation, scrypt, existing try limiter, old-hash CAS update.
  Viewer/report-only users may change their OWN password; demo/disabled and foreign-target attempts refused.
- Existing POST /api/portal/people/password moved from server.js into router: requireBoss,
  member account only, new/confirmation required. Existing company-scoped reset remains unchanged.
- server.js: router import/registration, personal POST-gate exception, canChangePassword status flag.
  No whoIs/PAGE_NEED/RIGHT_OF_PATH policy changes, company rights changes or new DB objects.
- public/settings.html: masked personal form under profile; shared nav.js offers Change password.
- public/people.html: masked Reset password dialog replaces prompt and plaintext success echo.
  public/account-password.js handles forms, confirmation, duplicate submit and field clearing.
- Tests: npm.cmd run check:all PASS (21 checks); server/pages syntax and whitespace PASS.
  New synthetic account-password check covers ownership, viewer access, invalid/wrong/oversized
  inputs, throttling, races, hashes, boss-only recovery and form behavior. No real account touched.
- Docs: docs/accounts-companies.md. No credential values recorded, no new timers/migration reserved.
- Live pre-push baseline 1793956112999; setup required all true. Post-push verification pending.
- Owner to refresh: staff avatar -> Change password, profile form, and super-admin People -> Reset
  password. User supplies own credentials privately. No independent browser layout verification.
- Previous compact rail/home cards and aqua selection preserved; Settings/Database boss-only retained.
- Singapore migration retained: e.availity.pk, same app SGP1; Neon Fusion Singapore
  wispy-dream-34764792 / production br-calm-bonus-ao4mnaaa / neondb.
- Ohio billowing-poetry-08559264 READ-ONLY >=13 Nov, no deletion authorized; reconcile before rollback.
  SESSION_SECRET/relay unchanged; final copy matched 47 public row fingerprints/538 columns/28 sequences.
- Private backups LOCALAPPDATA/FusionMigration/20261106-055453; never upload/commit contents.
- Owner previously verified companies/CPR, all courier Tests Works, Database 105.1 MB/10.3%.
  Fresh QB OAuth/separate portal-login unobserved; copied compute history is not proof of savings.
- Leftovers: Trax ElRB/old M&P backfill, nine unposted CPRs, PostEx AH/UR hooks; Rose Belle unrelated.
- No dirty files at takeover; task files only. Lock released after push/check.
