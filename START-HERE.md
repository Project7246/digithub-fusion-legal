# Start here - the prompt to give any agent, every time

This file exists because these rules were living only in the owner's chat
window. They were written once, used for weeks, and then left out of a
handover - which is how an agent ends up re-deriving the protocol, or
ignoring it. **They belong in the repository, where they cannot be lost.**

Copy the right block below into a new ChatGPT or Claude session **before**
asking for anything. The words are the owner's; only the notes marked
*(added 5 Nov 2026)* are not.

---

## 1. Every ordinary session

> Fusion repo. Read AGENTS.md at the repo root and follow it as binding - the
> pre-flight, the .agent-lock, the shared files, migration numbers, the checks,
> the push and HANDOFF.md. Then read CLAUDE.md and only the docs/ file for the
> module this task touches. Run git pull first; never paste older copies of a
> file over the current code. Report in Roman Urdu.

---

## 2. A new computer, or an agent that has never seen this repo

> Fusion, at C:\Users\Project Availity\Desktop\digithub-fusion
> (GitHub Project7246/digithub-fusion-legal, branch main, deployed on DigitalOcean
> app hammerhead-app / component digithub-fusion-legal, live at https://e.availity.pk).
>
> Claude and you share this folder and this repository. Before you touch anything:
>
> 1. Read AGENTS.md in full. It is the binding protocol for both of us - the
>    pre-flight, the .agent-lock, the shared files, migration numbers, the checks,
>    the push and the handover. Follow every section of it on this and every task.
> 2. Read CLAUDE.md, then ONLY the docs/ file for the module this task touches
>    (the index is in CLAUDE.md). Do not read the other docs/ files - the reading
>    itself costs the owner's allowance.
> 3. Read HANDOFF.md, then run the pre-flight command in AGENTS.md section A and
>    show me what it returned before you change anything.
>
> AGENTS.md and the current code outrank this chat, any older conversation, any
> handover and any ZIP copy. Preserve Claude's and the owner's existing work:
> unfamiliar code is never a reason to remove it. Only my requested scope - ask
> instead of guessing. Report in Roman Urdu as AGENTS.md section G says.

*(updated 6 Nov 2026)* The address switched to `https://e.availity.pk` on 6 Nov
2026 (migration Step B, `docs/migration-2026-11.md`) - `BASE_URL`, the
redirect URIs and the DigitalOcean domain all moved, and `ca.availity.pk` was
removed outright (not kept, not redirected). The block above is already
current. Only the **region** (still Bangalore/BLR1) and the **database**
(still Neon Ohio) remain - Steps C and D of that same file, not started.
Update this file again when those move too.

---

## 3. The move: domain, region and database

**`PROMPT.md` at the repository root is the whole thing in one block.** Open
it, select all, paste. It already carries the standing rules, the files to
read with their exact paths, what changed on 5 Nov 2026 so the agent does
not undo it, and the migration task itself.

That is deliberate: handing an agent two or three blocks and hoping it joins
them is how a rule gets dropped. One file, one paste.

The order inside it matters. The standing rules say how to work in this
repository at all - the lock, the checks, not pasting old files over new
ones, Roman Urdu. The migration part only says what to move and what breaks.
An agent given the second without the first will do the migration and
quietly undo a week of code on the way past.

---

## 4. Why these two are not the same thing

- **AGENTS.md** is the protocol: what an agent must do while it works.
- **This file** is the prompt that makes an agent read AGENTS.md in the
  first place. Without it, nothing points at the protocol.

So this file is short on purpose and does not repeat AGENTS.md. If the rules
themselves change, change AGENTS.md; change this file only when the way a
session is *started* changes.
