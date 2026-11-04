# Handover - the state of this folder

The last agent to finish rewrites this file, in the same commit as its work.
Keep it under 30 lines. Read it in the pre-flight; see AGENTS.md section A.

**Last agent**: Claude (Opus 5) · **4 Nov 2026**

## Finished and pushed

- The receipt range buttons on `/receipts` work again. The listener asked for
  `.bar button[data-days]` while the markup says `.cbar`, so Today / 7 / 30 / 90
  days did nothing on the live site. Codex had the fix on disk, uncommitted, from
  3 Nov; it is committed now with its assertions in `tools/postex-audit-check.mjs`,
  and the "Paid to us" card reads **Net CPR amount**.
- `CLAUDE.md` split into a short core plus `docs/` per module - word for word,
  nothing dropped. It was 3,443 lines (~50,000 tokens) loaded in full at the start
  of every session by both agents; it is now 267. The index is in CLAUDE.md.
- `AGENTS.md` rewritten as the one protocol for both agents: pre-flight, the
  `.agent-lock`, the shared files, migration-number reservation, the checks
  table, the push and this handover, and how to spend the allowance.
- `npm run check:all` (14 checks, one command) and `npm run check:banking` added.
  `.agent-lock` added to `.gitignore`.

## Unfinished, and what is left

- Nothing is in flight. The working tree is clean.

## Files left dirty on purpose

- None.

## Migration number reserved

- None. `migrations/` holds 001 to 005; the next free number is **006**. Claim it
  here, in the same change, before you create the file.

## For the owner to check

- `/receipts`: the Today / 7 / 30 / 90 day buttons, and that the card reads
  **Net CPR amount**.
