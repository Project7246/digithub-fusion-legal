# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) - 4 Nov 2026

## Finished and pushed

- `/receipts` works again, in two places. The date buttons asked for
  `.bar button[data-days]` while the markup says `.cbar`, so Today / 7 / 30 / 90
  did nothing; and the detail dialog's order search and status dropdown were
  inside a `<div class="bar">`, which `app.css` keeps for a 7px progress bar with
  `overflow:hidden` - both controls were clipped to seven pixels and unusable.
  The "Paid to us" card reads **Net CPR amount**.
  `tools/postex-audit-check.mjs` now refuses any `class="bar"` in that page.
- `CLAUDE.md` split into a short core plus `docs/` per module - word for word,
  nothing dropped, verified line by line. It was 3,443 lines (~50,000 tokens)
  loaded in full at the start of every session by both agents; it is now 267.
  The index is in CLAUDE.md.
- `AGENTS.md` rewritten as the one protocol for both agents: pre-flight,
  `.agent-lock`, the shared files, migration-number reservation, the checks
  table, the push, this handover, spending the allowance, and working from more
  than one computer.
- `npm run check:all` (14 checks, one command) and `npm run check:banking` added.
  `.agent-lock` added to `.gitignore`.

## Unfinished, and what is left

- Nothing is in flight. The working tree is clean.
- Still open from the notes: DigitalOcean **Edge caching** and **Email
  obfuscation** should be turned Off (the owner's own console) - a cached page is
  how a deployed fix can still look missing in a browser.

## Files left dirty on purpose

- None.

## Migration number reserved

- None. `migrations/` holds 001 to 005; the next free number is **006**. Claim it
  here, in the same change, before you create the file.

## For the owner to check

- `/receipts`, after a hard refresh: the Today / 7 / 30 / 90 day buttons, the
  **Net CPR amount** card, and inside a receipt's detail the order search box and
  the status dropdown.
