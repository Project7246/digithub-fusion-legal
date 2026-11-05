Fusion repo, at C:\Users\Project Availity\Desktop\digithub-fusion
GitHub: Project7246/digithub-fusion-legal, branch main
Deployed: DigitalOcean app hammerhead-app / component digithub-fusion-legal
Live: https://ca.availity.pk

## Before you touch anything

1. Run `git pull` first.
2. Read these files, in this order, by these exact paths:
   - `AGENTS.md`              - the binding protocol for every agent on this repo
   - `START-HERE.md`          - the owner's standing rules for a session
   - `CLAUDE.md`              - what the app is, where everything lives, the architecture rules
   - `HANDOFF.md`             - what the last agent finished and what is unfinished
   - `docs/migration-2026-11.md` - the task below, in full
   Do NOT read the other `docs/` files unless the task reaches that module.
   Reading more than the task needs costs the owner's allowance.
3. Run the pre-flight command in AGENTS.md section A and show me what it
   returned, before changing anything.

## You worked on this repo before. It has moved on without you.

The work went: you, then Claude, now you again. **Claude made 33 commits on
5 November 2026.** The repository is newer than anything you remember, and
newer than any ZIP, any older chat and any file you may still be holding.

Current HEAD is `07d9513`. The last commit before that day's work was
`901444a`. Everything between those two is real, tested and deployed.

Files Claude changed on 5 Nov - treat all of them as current and correct:

```
backfill.js      courierlive.js   couriers.js      dashdata.js
mnp.js           mnplive.js       mnpportal.js     trax.js
traxlive.js      traxportal.js    wire.js          server.js
public/receipts.html              public/courier-dash.html
tools/check-all.mjs               tools/courier-relay.php
tools/trax-receipts-check.mjs     tools/mnp-receipts-check.mjs
tools/mnp-settled-check.mjs       package.json
CLAUDE.md        HANDOFF.md       START-HERE.md
docs/logistics-couriers.md        docs/migration-2026-11.md
```

What that work did, so you do not "fix" it back:

- a courier receipt is now built from the courier's own payment cover **and**
  from the parcels, joined as equals - a payment with no parcels here is
  still a receipt
- Trax receipts come from their Finance payment screen, M&P's from their
  payment instrument report, each shown in that courier's own columns
- `/api/courier/receipts` asks the courier, one account at a time, and a
  read that failed is named on the page
- `npm run check:all` is **19 checks** and all of them pass

**Rules about this:**
- Never paste an older copy of a file over the current code.
- Unfamiliar code is never a reason to remove it. If something looks wrong
  to you, say so and ask - do not change it.
- `AGENTS.md` and the current code outrank this prompt, any older
  conversation, any handover and any ZIP copy.

## The task

Move the app, as set out in `docs/migration-2026-11.md`:

1. the address becomes `e.availity.pk` instead of `ca.availity.pk`
2. the server moves from Bangalore (BLR1) to Singapore (SGP1)
3. the Neon database moves from Ohio to a new Neon project in Singapore

That file is the runbook. It lists what is actually configured - read off
the live consoles on 5 Nov 2026 - the exact order, how to verify each step
and how to undo it. **Follow its order. Do not improvise one, and do not
invent values.**

## The rules for this task

- **Never generate a new `SESSION_SECRET`.** Every courier portal password
  in the database is encrypted with it (`PORTAL_KEY` is not set, so
  `SESSION_SECRET` is the key). A new one destroys all of them silently -
  nothing errors, the couriers simply start reporting wrong passwords.
- **Change no application code for this migration.** No address is
  hard-coded anywhere; the app's address comes from the `BASE_URL`
  environment variable alone. If you think code must change, stop and ask.
- **PKNIC needs nothing.** The nameservers already point at Hostinger; all
  DNS work is in hPanel.
- Before each step that changes something live, tell me what it will do,
  how to check it worked, and how to undo it. Wait for me.
- Only my requested scope. If something you need is not in the runbook, ask
  me - do not assume.
- Report in Roman Urdu, as AGENTS.md section G says. Code, file names, paths
  and commands stay in English.
