# Fusion - the working protocol for coding agents

This is the one protocol. It applies to **Claude and to Codex equally**, on every
task, and neither is above it. Where it and an older handover disagree, this file
and the current code win.

It exists for three reasons, in this order:

1. **Neither agent's work may be lost or quietly undone by the other.**
2. **The owner's app must not break between deploys** - a change for one module
   cannot disturb another.
3. **The month's allowance is finite** - Claude's limit, Codex's limit and Neon's
   100 compute hours. Reading more than the task needs is a real cost, so this
   protocol is written to be *cheap to follow*, not thorough for its own sake.

`CLAUDE.md` is what the app is and what the owner has decided. It is short on
purpose now; the per-module notes are in `docs/`, and a task reads only the one
it touches. That table is in CLAUDE.md.

---

## A. Pre-flight - before you touch anything

**One command, not six.** Everything the pre-flight needs comes back from a single
shell call, so it costs one round trip:

```
git status --short; git log --oneline -8; git fetch origin -q;
git rev-list --left-right --count origin/main...main; cat HANDOFF.md;
ls .agent-lock 2>/dev/null
```

Then, in this order:

1. **Read `CLAUDE.md`** (Claude already has it; Codex must read it) and **the one
   `docs/` file** for the module the task touches. Do not read the other module
   files. Do not read `docs/collaboration-rules-2026-10-31.md` - it is history,
   kept for the record, and this file supersedes it.
2. **Read `HANDOFF.md`.** It says what the last agent finished, what it left
   unfinished, which files are deliberately dirty, and which migration number it
   has reserved. It is short by design: it is the cheapest way to not re-derive
   what the last session already knew.
3. **If `.agent-lock` exists and is not yours, STOP.** Tell the owner which agent
   holds the folder and when it took it. Edit nothing. Two agents in one folder do
   not produce a git conflict - they silently overwrite each other, and nothing
   reports it.
4. **Take the lock**: write your name, the UTC time and the task in one line into
   `.agent-lock`. It is gitignored; never commit it.
5. **If the working tree is dirty and `HANDOFF.md` does not explain those exact
   files**: do not touch them, do not commit them, do not revert them. Name them
   to the owner and ask. Unfamiliar code is never a reason to remove it.
6. **Read the current code you are about to change**, and the behaviour connected
   to it - targeted, not whole files. `server.js` is 14,600 lines: use
   `grep -n` to find the route and `sed -n '<from>,<to>p'` to read it. Reading a
   14,000-line file to change twenty lines of it is the kind of spend this
   protocol exists to stop. Never rewrite a file from memory.

## B. While you work

7. **Say which module the task belongs to, and which CLAUDE.md architecture rules
   apply**, before starting.
8. **Only the owner's requested scope.** No extra features, redesigns, refactors,
   cleanup, package upgrades or unrelated fixes. If a requirement is unclear,
   write "unclear" and ask - do not guess.
9. **If the request conflicts with an architecture rule, STOP** and say which rule
   and why. Proceed only if the owner says "override", and then record the
   exception in the module's `docs/` file.
10. **Never change the setup** without the owner's explicit instruction: the
    GitHub repo or branch, hosting, the DigitalOcean app or component, the domain,
    DNS, the database, environment variables, deployment configuration. Never
    create a new server, repository or deployment. Never experiment on production
    data - synthetic fixtures only.
11. **Secrets, a real company's data, real staff names and real salary figures
    never go into a tracked file, a log, or a reply.** It is easier not to write
    it than to take it out of the history.

### The shared files, and the two things that actually collide

Say out loud before you touch one of these, and **commit and push it in the same
session** rather than leaving it dirty for the other agent to collide with:

| File | Why it collides |
|---|---|
| `server.js` | 14,600 lines, every one of the 452 routes. Both agents end up here. Prefer a new module file that exports a router |
| `public/app.css` `:root` | one change reaches every module |
| `nav.js` | the rail and the bell, on every page |
| `compute.js` | the meter and the budget every module is paced by |
| `whoIs()` / `PAGE_NEED` / `RIGHT_OF_PATH` | who may open what, app-wide |

**Migration numbers are worse than a conflict - they are a database problem.**
`migrations/` holds 001 to 005. A migration that has run is never edited, so two
different `006` files are not something git can fix afterwards. **Before you
create a numbered migration, write the number you are taking into `HANDOFF.md`
in the same change**, so the other agent cannot take it.

## C. Checks - run the ones that match what you touched

`npm run check:all` runs every check below except the HR file importer, which
needs a folder of the company's own spreadsheets that is not in this repository.
Run `check:all` when a change reaches more than one module; otherwise run the
matching rows, which is cheaper and says more:

| Touched | Run |
|---|---|
| any page under `public/` | `npm run check` |
| `banking.js`, `banking-*.js`, banking pages | `npm run check:banking` (8 scripts) |
| `messages.js` | `node tools/messages-check.mjs` |
| M&P, CPR covers, payment reports | `node tools/mnp-payments-check.mjs`, `node tools/mnp-store-check.mjs` |
| PostEx, `/receipts`, pickup detail | `node tools/postex-audit-check.mjs` |
| `hr.js`, `hrpay.js`, `hrrules.js` | `npm run check:hr` |
| `hrimport.js` | `npm run check:hr-files -- <folder outside this repo>` |

**For a money feature, write the check script with known correct figures first,
then make the code pass it, and show the output.** A figure of nought is never
reported as a fact until a check says it is one.

## D. Before you push

12. **`git fetch origin` again.** If the other agent has pushed, integrate safely:
    rebase your own commits on top. Never `reset --hard`, never `git clean`, never
    force-push, never accept one whole-file version blindly. Re-run the checks
    after integrating.
13. **Stage and commit only your task's files.** Leave anyone else's dirty files
    exactly as they are.
14. **Rewrite `HANDOFF.md` in the same commit** - who you are, the date, what you
    finished, what is unfinished and why, files left dirty on purpose, migration
    number reserved. Keep it under 30 lines. If it conflicts, keep the newer
    state and **merge both agents' leftover notes** - never drop the other's
    lines.
15. **Push to `main`** (`Project7246/digithub-fusion-legal`).
16. **Verify the deployment.** `https://ca.availity.pk/api/version` must show a
    *different* version than before your push - DigitalOcean supersedes one build
    with another when two pushes land together, so an unchanged version means
    your commit may not be live. Then check the screens you changed. If
    verification is unavailable or incomplete, say exactly what you could not
    verify. Never assume success.
17. **Delete `.agent-lock`.**

## E. If you stop early - limit reached, blocked, or told to stop

18. Either commit and push, or, if committing is not safe, **write exactly what is
    half-done into `HANDOFF.md`** and say so in your reply. **A dirty working tree
    with no written record is a breach of this protocol** - it is what left
    `/receipts` with dead date buttons on the live site for a day, with nothing
    anywhere saying the fix existed. Delete `.agent-lock` either way.

## F. Spending the allowance well

Both agents are metered, and so is the database. These are rules, not advice:

- **Read the module, not the manual.** CLAUDE.md plus one `docs/` file. The split
  on 4 Nov 2026 took the always-loaded notes from about 50,000 tokens to about
  4,000; do not undo that by reading every `docs/` file "for context".
- **One shell call where one will do.** Chain the pre-flight with `;`. Independent
  reads go in one call, not five.
- **Grep before you read.** `grep -n` then `sed -n '<from>,<to>p'`. Whole-file
  reads are for files under a few hundred lines.
- **Do not re-read what you have just written.** The editor errors if an edit
  fails; a successful edit needs no confirming read.
- **No subagents for ordinary work.** Each one starts cold and re-reads
  everything - it is the most expensive way to answer a question you could
  answer yourself.
- **Write the decision down once, in the right `docs/` file.** The next session
  then costs a short read instead of a long re-derivation. `HANDOFF.md` is the
  same economy for unfinished work.
- **Never add an always-on poller or timer** that is not measured by `compute.js`
  and paced by its budget - see `docs/compute-budget.md`. That is a standing
  charge on Neon's 100 hours, and the meter will blame it on something else.

## G. Reporting

Report in **Roman Urdu**; code, file names, paths and commands in English. Five
things, briefly:

1. kya badla
2. kaun si files badlin
3. kaun se checks chalay aur un ka nateeja
4. owner ko khud kya check karna hai
5. verified deployment status - `/api/version` se, aur jo verify na ho saka wo saaf likho

---

## Working from more than one computer

The repository is the only thing that moves between machines, and **GitHub is the
mechanism** - that is what a remote is for.

- **Deployment is already machine-independent.** DigitalOcean deploys when `main`
  receives a push. It does not matter which computer pushed, and no computer needs
  to be on for the app to run.
- On a second computer: `git clone https://github.com/Project7246/digithub-fusion-legal.git`,
  then `npm install`. Work, commit, push. Before starting, `git pull`; before
  pushing, `git fetch` and rebase.
- **Do not put this folder in Google Drive, OneDrive or Dropbox.** A sync client
  copies files one at a time on its own schedule, while `.git` is thousands of
  small objects plus a packfile that must agree with each other at every instant.
  A half-synced `.git` is a corrupt repository (`fatal: bad object`, a stuck
  `index.lock`, `file (1).js` duplicates beside the real ones), and `node_modules`
  is another 3,320 files for the sync client to churn through. Worse, a sync
  client resolves two edits by keeping both as separate files - it cannot merge,
  which is the one thing git is for.
- **What may live in Drive**: the owner's own files that are deliberately not in
  this repository - the company's spreadsheets (`hr-files/`, `*.xlsx`, `*.csv`),
  brand PDFs, screenshots. Those are gitignored precisely so they can live
  somewhere else.
- **Each machine keeps its own untracked setup**: `.env` (only needed to run the
  app locally - editing and pushing needs no database), and `.claude/`, which is
  Claude's own configuration and is gitignored on purpose.
- **Never two agents on one folder at the same time** - `.agent-lock` is per
  folder and per machine, so two machines are safe from each other by git, but two
  agents in one folder are not safe at all.
