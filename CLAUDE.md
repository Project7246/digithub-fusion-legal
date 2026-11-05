# Digithub Fusion - project notes for Claude


**Read AGENTS.md before every task.** It is the working protocol for Claude and
for Codex - the pre-flight, the lock, the shared files, the checks, the push and
the handover. This file is what the app is and what the owner has decided.

**`START-HERE.md`** holds the prompt the owner pastes to start a session - the
one that makes an agent read AGENTS.md at all. It lived only in the chat window
until 5 Nov 2026, which is how it came to be left out of a handover. If the way
a session is *started* changes, change that file.

## Where the notes live, and read only the one you need

This file used to hold every decision ever made - 3,443 lines, about 50,000
tokens, loaded in full at the start of every session by both agents. Most of a
task read a thousand lines about modules it would never touch, and the reading
itself was the biggest single spend of the month's allowance.

So on 4 Nov 2026 the per-module notes moved into `docs/`, **word for word, with
nothing dropped, reworded or summarised**. What stayed here is what every task
needs whatever it is working on: the architecture rules, who owns what, where
everything lives, the brand, and the open items.

| Working on | Read, as well as this file |
|---|---|
| Banking - banks, balances, CPR archive, fiscal openings, Sheet feeds, messages | `docs/banking.md` |
| Logistics - PostEx, Trax, M&P, adapters, statuses, dashboards, rates, receipts | `docs/logistics-couriers.md` |
| Finance - Shopify connector, invoices, items, QuickBooks writing | `docs/shopify-connector.md` |
| HR - employees, attendance, leave, payroll, slips, the ledger | `docs/hr-payroll.md` |
| Sign-in, rights, users, companies, the portal, the bin, the demo | `docs/accounts-companies.md` |
| Anything that wakes the database on a timer, or any new poller | `docs/compute-budget.md` |
| Writing or fixing a page under `public/` | `docs/pages-and-screens.md` |
| Moving the server, the domain or the database | `docs/migration-2026-11.md` |

`docs/collaboration-rules-2026-10-31.md` keeps the owner's collaboration rules as
they were first recorded on 31 Oct 2026. AGENTS.md is the live version of them.

Two things follow from the split, and both are rules:

- **A decision about one module is written into that module's `docs/` file**, under
  a dated heading, not into this file. This file grows only when the decision is
  about the whole app - an architecture rule, an owner, a brand, where something
  lives, an open item.
- **Older code comments saying "see CLAUDE.md"** mean the matching `docs/` file
  now. Nothing moved out of this repository and nothing was lost; `git show
  41d5ab2:CLAUDE.md` is the file as it stood before the split.

## ARCHITECTURE RULES (read before every task)

Given on 30 Oct 2026. These stand above everything else in this file. Read
them before starting any task.

### PRODUCT DIRECTION

Fusion is one platform sold to many different companies, with modules that are
switched on or off per company (Finance, Logistics, HR, Banking, POS, Ledger).
Build everything for many companies from the start, even if only one uses it
today.

### RULES

1. **Isolation**: every table that holds a company's data has `realm_id`. Every
   query filters by it. For new tables also add Postgres Row-Level Security so
   a forgotten filter cannot leak data.
2. **Modules**: each new module gets its OWN files and its OWN tables. Do not
   add new feature code to `server.js`. Create a new file, export a router, and
   only register it in `server.js`. Modules talk to each other only through
   small, named functions, never by reading another module's tables.
3. **Migrations**: do not rely on `CREATE TABLE IF NOT EXISTS` for new work.
   Create numbered migration files (e.g. `migrations/012_name.sql`), run once,
   never edited after they have run.
4. **Money**: store as integer paisa or `NUMERIC`, never float. In any ledger,
   a posted entry is never edited or deleted, only reversed. Every entry has
   debits equal to credits.
5. **Audit**: every change to money, payroll, banking or rights writes a row
   (who, what, old value, new value, when).
6. **Tests first**: before building a money feature, write the check script
   (like `tools/hr-check.mjs`) with known correct figures, then make the code
   pass it. Show the results.
7. **Secrets**: no secret value in code, in logs, or in replies. Tokens and
   credentials are stored encrypted. Name variables only.
8. **Safe changes**: do not touch Finance code when working on HR, and the
   reverse. If a task needs it, stop and say so first.
9. **Real data**: never run experiments on production data. Use test data and
   say clearly which database a script will touch before it runs.
10. **Feature switches**: each module can be enabled or disabled per company.

### HOW TO WORK EVERY TIME

- Before starting any task, say which module it belongs to and which of these
  rules apply.
- If a request conflicts with a rule, **STOP** and say which rule and why. Do
  not quietly work around it. The owner may say "override", and only then may
  it proceed - and a line is added to this file recording the exception.
- If something is unclear, write "unclear" instead of guessing.
- After each task, say in 3 lines: what changed, which files, what the owner
  must check or test themselves.
- Keep this file up to date with every decision the owner makes.

### Where the code does not meet these rules yet

Stated once, plainly, so no task has to rediscover it. These are **not**
exceptions to the rules - they are the distance between the rules and the code
as it stands on 30 Oct 2026, and new work closes it rather than widening it.

| Rule | Today |
|---|---|
| 1 - RLS | Every table carries `realm_id` and every query filters by it, but **no table has Row-Level Security**. New tables get it. |
| 2 - own files, own router | Modules do have their own files (`hr.js`, `banking.js`, `rates.js`, …) but **every route is declared in `server.js`** - 452 of them, 14,400 lines. New modules export a router. |
| 3 - migrations | There is **no `migrations/` directory**. Tables are made with `CREATE TABLE IF NOT EXISTS` and columns with `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, inside each module's `init*()`. New work uses numbered files. |
| 4 - money | Money is `NUMERIC(14,2)` throughout, which is correct. **There is no ledger with reversal-only posting**; `hr_pay_lines` and `bank_moves` are edited in place today. |
| 5 - audit | There is **no audit table**. `bank_links` keeps its own history by never editing a row, and `hr_pay_lines.source` records who put a figure there, but neither is a general audit trail. |
| 10 - feature switches | There is **no per-company module switch**. What a person sees is their rights; what a company has is everything. |

## How to talk to the user
- Reply in **Roman Urdu**. Code, file names, paths, commands stay in English.
- Do not guess when a request is vague ("yaha" etc): ask which page first.
- After every piece of work: commit and push to `main` without asking (DigitalOcean auto-deploys).
- Never put secrets (DATABASE_URL, tokens, keys) in git, in chat, or in this file.

## Whose instruction is this, and which module it may touch

Given on 28 Oct 2026, and it stands for every instruction after it. Each one has
an owner, and the owner is what says which module is being changed:

| Who | Their side |
|---|---|
| **Rani** | **Finance** - QuickBooks books, invoices, the Shopify to QuickBooks connector, the couriers' money (COD, charges, CPRs, receivables), the finance reports |
| **Sir Saim** | **HR, Operations** and every other module |

She may write "ye Rani ki instruction hy" and she may equally forget to, so
**a finance task is assumed to be Rani's whether her name is on it or not**.
An instruction arriving without a name is not a free hand over the whole app.

### Both deploy, neither disturbs the other

Two owners work in parallel, so **changing the HR module must make no
difference whatever to the Finance module** - that was said in those words, as
the example. A change made for one of them cannot break the other's screens
between deploys.

- A module's work goes in **its own files** - its own page, its own `*.js` -
  never as edits inside another module's file.
- **Shared ground is shared on purpose, never by accident**: `:root` in
  `public/app.css`, `nav.js`, `realm_id` company scoping,
  `whoIs()` / `PAGE_NEED` / `RIGHT_OF_PATH`, and `compute.js`'s budget. Touching
  one of those reaches every module, and which ones must be said out loud.
- A new module's rights are **their own group** in `RIGHT_GROUPS`, so a company
  can be given HR without being given the books.
- A new module's tables carry `realm_id`, like everything else here.
- After a change, the other module is checked and named as checked.

### It ends as one ERP

The destination is explicit: every module **linked in one place** - one
sign-in, one company scope, one set of figures. So each module is built as a
part of an ERP from its first line, not bolted on afterwards. That is why the
separation above is about files and rights rather than about data: the data is
meant to meet.

## What this app is
A second app, built the same way as the user's first app (`qb-invoice-uploader`, at
`C:\Users\ASUS-1\Desktop\qb-invoice-uploader`, GitHub `availityltd`, hosted on Render).
It will do the same kind of work (QuickBooks books, uploads, audits) but with **new
features and a new design**. The user will describe the design; build it fresh, the old
app is only a reference. Do NOT edit the old app's folder from here.

The files now in this repo are a **random copy** of the old app's files, uploaded only to
get a first deploy working. They can be deleted or rewritten freely.

## Where everything lives
| Piece | Where |
|---|---|
| Code | GitHub `Project7246/digithub-fusion-legal`, branch `main` |
| Local folder | `C:\Users\Project Availity\Desktop\digithub-fusion` (the work moved here from the `ASUS-1` profile; paths below that still say `ASUS-1` are on the old machine) |
| Git author here | `Project7246` / `project.availity@gmail.com` (set in this repo's local git config) |
| Git push login | Windows Credential Manager holds the old app's `availityltd` token for `github.com`, which this repo is denied (403). Fixed by `credential.https://github.com.useHttpPath=true` in this repo's **local** config, so the credential is looked up per repo path and the old app keeps its own. Do not set this globally |
| Git on this machine | Installed by `winget install --id Git.Git -e` at `C:\Program Files\Git\cmd\git.exe`. A session opened before that install has the old PATH, so `git` is not a word it knows - call the full path until Claude Code is reopened. The GitHub credential is already in Credential Manager here: `git fetch` works without a browser |
| Server | DigitalOcean App Platform, app `hammerhead-app`, component `digithub-fusion-legal`, Basic 512 MB, $5/month, region Bangalore (BLR1), Auto-deploy on push is ON |
| Database | **Neon** (not DigitalOcean). Project **DigitHub Fusion**, `billowing-poetry-08559264`, branch `production` (`br-wispy-sound-b4yb0j31`), **region AWS US East 2 (Ohio)** - read off the Neon console on 5 Nov 2026, where `autumn-tooth-08816249` was written here before and is not the live project. There is a **second, empty** project of the same name, last active a month ago. Connected only through the env var `DATABASE_URL` set in DigitalOcean (component Settings > Environment Variables). Locally it would go in an untracked `.env` |
| Domain | `https://ca.availity.pk`. DNS is on Hostinger: `CNAME ca -> hammerhead-app-z86ki.ondigitalocean.app`. Other records on `availity.pk` (main site, email MX/TXT) must not be touched |
| Starter URL | `https://hammerhead-app-z86ki.ondigitalocean.app` |

Deploy: push to `main` -> DigitalOcean builds and deploys by itself (no Render here).
`ca.availity.pk` is live over HTTPS and serves the same build, so it is the address to
use; `BASE_URL` points at it and the QuickBooks sign-in only works there.

Env vars in DigitalOcean are not saved until **Save** is pressed - values typed and left
are silently lost, and the app then runs on its fallbacks (`BASE_URL` becomes
`http://localhost:3000` and the QuickBooks door sends `client_id=undefined`). After any
change, check `/api/setup-check`: it names which settings the running server received,
without sending any value back.

## The brand
The app is called **Fusion** - not Digithub Fusion, and the old name must not come back.
Tagline: "AI-powered OS for e-commerce". The full lockup reads "Together we can" above
"FUSION(TM)".

It follows the user's own brand guideline (`C:\Users\ASUS-1\Downloads\Brand-Guideline---Fusion.pdf`,
worked out into `C:\Users\ASUS-1\Desktop\Fusion Brand Preview.html`, which the user approved):

| Piece | Value |
|---|---|
| Mark | Folded triangle, viewBox `0 0 400 280`: light face `#BBBBBB`, dark side `#7B7B7B`, teal dot at (190,150) r40. In `public/logo.svg` and `public/favicon.svg` |
| Colours | Slate `#222F34`, Teal `#11BAB5`, Grey `#7B7B7B`, Light grey `#BBBBBB`, White. Aqua `#6BF0EA` for the hovered/lit state |
| Type | Montserrat for headings (`--head`), Roboto for text (`--sans`), Roboto Mono for figures (`--mono`) |

Every colour and face comes from the `:root` block at the top of `public/app.css`, so the
whole app changes from there. Teal is spent only on the thing being acted on - a button,
the page you are on, the logo's dot - so it keeps meaning something. QuickBooks green and
Shopify green stay as they are: they stand for those two companies, not for this app.

The sign-in page carries the one animation: e-commerce splits into Finance, Logistics,
Operations and HR, and all four run back into the Fusion lockup. **Only** there - inside
the app the background stays plain, because that is where the books are worked on.

## Rules about space (Neon free plan)
- Neon free plan, read off the billing page on 5 Nov 2026: **1 GB storage, 100 compute
  hours and 10 branches per project**, autoscaling to 2 CU. The database auto-suspends
  after 5 minutes idle (first request after that is slow).
- **The database is in Ohio and the app is in Bangalore.** Every query crosses half the
  planet - about a fifth of a second there and back - and Neon bills for the time its
  compute is awake, not for the queries run. On 1-5 Nov the account used **26.7 of the
  100 hours**, which is ahead of the month. Putting the two in one region is the single
  biggest thing that would bring that down; see the Open items.
- Store as little as possible: **never store the uploaded files themselves** (PDF/Excel) in
  the database - only small rows (name, date, status, result).
- Put a retention limit on logs, caches and job history (delete old rows).
- How full the database is, and what the month has cost, are both on
  Settings > Database (ADMIN_EMAILS only, `/api/storage`).

## Product rules carried over from the old app
- It writes to real QuickBooks books, so build it to a product standard, not "it will do".
- Every long run / search / read from QuickBooks has **Stop**, **Resume** and **Clear log**.
  The Stop button state comes from the server so it shows on every computer.
- Several computers use the app: after a deploy show an "Update installed" notice, and
  every new page must include `nav.js`.
- Every run belongs to a desk (company + user): one id's work must not show to another.
- Courier/CPR-style sections are separate; do not change an existing section while
  building a new one.

## Things the user cannot see / what to ask them
- **Claude can open these in the owner's Chrome** - "chrome mein sab login hota hai",
  said on 5 Nov 2026 - and is expected to, rather than guess or ask for a screenshot:
  the Neon console, the DigitalOcean console, the courier portals. The project id and
  region above were wrong in this file for a month because nobody had looked. Look
  first, then answer. Screenshots saved as PDF in `C:\Users\ASUS-1\Downloads\FireShot\`
  can still be read when the owner sends one.
- Claude still cannot **change** any of those settings - env vars, DNS, regions, redirect
  URIs are the owner's to press Save on. Read them, say exactly what to change, verify
  afterwards.
- First `git push` from this folder opens a browser login: user must sign in as **Project7246**.
- When DigitalOcean env vars change, user must Save and redeploy.
- If Google or QuickBooks login is added: add `https://ca.availity.pk/...` as a redirect
  URL in their developer consoles.

## Open items
- Replace the copied old files with the new design once the user describes it.
- HR: contracts are a field on the person, not documents yet - hiring and firing
  move the `status` and keep everything. A contract to store, and a leave
  allowance per year to count against, are the next two pieces.
- HR: the parcel-fine categories (damaged / missing / wrong) are typed in. They
  come off the CSR issue log, which is not a Fusion table yet - the day it is,
  **Bring the figures in** fills those too.
- HR: nobody has run the SQL yet. Every formula is tested (`npm run check:hr`),
  both importers are tested against the company's own files
  (`npm run check:hr-files`), and the pages all parse - but the tables are made
  on the next boot and the first import is the first time the queries have run.
- Decide DigitalOcean settings: turn **Edge caching** and **Email obfuscation** Off (app shows
  live data).
- **The app and the database are on opposite sides of the world** - app in Bangalore,
  Neon in Ohio. Storage is fine (139.84 MB of 1 GB); **compute is not** (26.7 of 100
  hours in the first five days of November). Moving the two together is the decision
  to take: Neon cannot move a project between regions, so it means a new project in
  the app's region and a dump/restore of 140 MB. Nothing in the code changes - only
  `DATABASE_URL`.
- **A second, empty Neon project** of the same name exists, last active a month ago.
  Nothing points at it. The owner can delete it.
- Trax: book shipments through Sonic's `/shipment/book` and print air waybills
  (`/shipment/air_waybill`), now the rest of its API is in.
- M&P: their `Reports/Payment_Report` is read (`fetchPayouts()`) but nothing is
  built on it yet - it is the makings of an M&P settlement screen.
- Courier receipts (CPR) are still PostEx-only: `cprlive.js` says so plainly for
  the other two.
- The dispatch router is in a frame with its own localStorage, so its courier
  companies, shares and city rules are **per browser, not per company**. The
  day it matters, those move into a `realm_id` table like everything else.
- Trax's and M&P's own booking calls are not wired to the load sheet yet: it
  writes each account's sheet as a file, the way it always has, and somebody
  uploads it to the courier.

