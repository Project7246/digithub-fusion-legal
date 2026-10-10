# Digithub Fusion - project notes for Claude

## How to talk to the user
- Reply in **Roman Urdu**. Code, file names, paths, commands stay in English.
- Do not guess when a request is vague ("yaha" etc): ask which page first.
- After every piece of work: commit and push to `main` without asking (DigitalOcean auto-deploys).
- Never put secrets (DATABASE_URL, tokens, keys) in git, in chat, or in this file.

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
| Local folder | `C:\Users\ASUS-1\Desktop\digithub-fusion` |
| Git author here | `Project7246` / `project.availity@gmail.com` (set in this repo's local git config) |
| Git push login | Windows Credential Manager holds the old app's `availityltd` token for `github.com`, which this repo is denied (403). Fixed by `credential.https://github.com.useHttpPath=true` in this repo's **local** config, so the credential is looked up per repo path and the old app keeps its own. Do not set this globally |
| Server | DigitalOcean App Platform, app `hammerhead-app`, component `digithub-fusion-legal`, Basic 512 MB, $5/month, region Bangalore (BLR1), Auto-deploy on push is ON |
| Database | **Neon** (not DigitalOcean). Project `autumn-tooth-08816249`, branch `production`. Connected only through the env var `DATABASE_URL` set in DigitalOcean (component Settings > Environment Variables). Locally it would go in an untracked `.env` |
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
- Neon free plan is about **1 GB storage per project** (user thought 5 GB - verify on the
  Neon dashboard). Compute is limited to ~100 CU-hours/month and the database auto-suspends
  after 5 minutes idle (first request after that is slow).
- Store as little as possible: **never store the uploaded files themselves** (PDF/Excel) in
  the database - only small rows (name, date, status, result).
- Put a retention limit on logs, caches and job history (delete old rows).
- Add a small page that shows how full the database is.

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
- Claude cannot open DigitalOcean, Neon, Hostinger or GitHub websites. For anything done in
  a browser (env vars, DNS, logs) ask the user for a screenshot, or for the Runtime Logs
  text. Screenshots saved as PDF in `C:\Users\ASUS-1\Downloads\FireShot\` can be read.
- First `git push` from this folder opens a browser login: user must sign in as **Project7246**.
- When DigitalOcean env vars change, user must Save and redeploy.
- If Google or QuickBooks login is added: add `https://ca.availity.pk/...` as a redirect
  URL in their developer consoles.

## Who may open the app

Three doors, one room. Whichever was used, what ends up in `users` is the same
shape, and what somebody may do is still the `role` + `rights` on that row - read
by `whoIs()` in `server.js` and enforced by `PAGE_NEED` for pages and
`RIGHT_OF_PATH` for POSTs. `accounts.js` is only the lock; it decides nothing.

| Door | `door` | `sub` | Set up by |
|---|---|---|---|
| Email + password | `password` | `pw:<email>` | Themselves: code to the address (`/auth/code`), then `/auth/signup` |
| Company user ID (`hmna-01`) | `member` | `id:<login id>` | The administrator of a company, on `/users`. No email, tied to `home_realm` for life |

**Those two, and no others.** QuickBooks is not a way in - `/auth/signin` only
redirects to the sign-in screen now - and Google was decided against. A new
customer has no Intuit account, and should not need one to look at couriers or
at people. `/auth/connect` is a different thing: connecting a set of books, which
is what makes somebody that company's administrator. Rows with `door = 'qb'` are
people who signed in before the change.

Three tiers, and the middle one is new:

- **ADMIN_EMAILS** runs Fusion itself. Named on the server, never in the database,
  so reaching the database is not a way to become one. Sees every company.
- **The administrator of a company** is whoever connected it (`companies.owner_sub`,
  claimed once in `/auth/callback`). They hand out that company's user IDs, set
  what each may touch, and can see and change nobody outside it. `requireAdmin()`
  and `runsCompany()` are what let them in; `mayConnect()` is what lets somebody
  connect books at all.
- **Everybody else** has what their company's administrator ticked.

Anything scoped per company must stay scoped: `/api/admin/users`,
`/api/admin/users/access` and `/api/admin/users/companies` each cut their list to
the company being run unless the asker is in ADMIN_EMAILS. A new admin route must
do the same, or one customer's people appear on another's screen.

Passwords are scrypt (built into Node - do not add bcrypt or argon2). Nothing is
stored that can be turned back into a password, so a lost one is replaced, never
read: the administrator sets a new one and the sign-up screen shows it once.

Rules the doors follow, which are easy to break by accident:
- No door ever says whether an address or a user ID exists. "That did not match"
  is the only answer to a bad sign-in; a forgotten password always says a code is
  on its way. A door that confirms addresses is a list of who to attack.
- A wrong password and a password tried on an account that has none take the same
  work to refuse (`checkPassword` grinds a dummy hash), so one cannot be told from
  the other by how long it took.
- A sign-in lasts a year and is rewritten on every page opened (`setSession`), so
  somebody who works here daily is never signed out mid-run. Signing out is the
  only thing that ends it.
- Verification codes need SMTP. Without `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` the
  email doors cannot work and say so plainly (503), rather than leaving somebody
  waiting for a code that is not coming.

## How the app is laid out

`/` is a launcher, not a page of the books: every section's tiles on one screen,
each shelf headed by the section it belongs to. Going **into** a section opens
that section's own rail on the left, the way the first app's rail worked.

| Section | Front page | Holds | QuickBooks? |
|---|---|---|---|
| Finance | `/finance` (the old dashboard) | Everything the first app did | Yes |
| Logistics | `/logistics` | Couriers, tracking, pickups, CPRs, receipts | Yes |
| Operations | `/operations` | Couriers, tracking, CPRs - the same module, second desk | Yes |
| HR | `/hr` | Nothing built yet | No |

**One list, in `public/nav.js`: `SECTIONS`.** The rail and the tiles are two
readings of it, so a module added once appears in both and can never appear in
only one. A line is
`{ href, label, icon, need, tile, as, front, tree }`:

- `icon` is the rail's 24px stroke icon (`ICONS` in nav.js); `tile` is the 48px
  colour icon (`ICONS` in `public/tiles.js`)
- `as` is the shorter name a tile wears when it is being chosen rather than used
- `need` is the job key the server enforces (`PAGE_NEED`, `RIGHT_OF_PATH`), so
  hiding a tile never hides a door that still opens
- `front: true` marks a section's own overview page, which is never a tile
- each section also has `what`, `qb`, `home`, and `soon: [{label, tile}]` for
  modules that are coming

`public/tiles.js` draws them (`FUSION.draw(el, sectionKey|null, find)`),
`public/tiles.css` dresses them. nav.js must load first.

**Every class these new screens introduce starts with `fx`.** `app.css` dresses
the whole app from a flat set of short names, and nine of the obvious ones were
already taken - `.bar` is a 7px progress bar with `overflow:hidden`, and `.tile`,
`.tiles`, `.pill`, `.sheet`, `.dot`, `.right`, `.solid` and `.mini` all exist too.
Reusing `.bar` cost three wrong fixes: the top bar rendered inside a seven pixel
box and only a white sliver showed, while the positioning looked like the
culprit. A new rule overrides only the properties it names; everything else the
old rule set stays. So before adding a class, check `app.css` for it, or prefix
it. `.solid` and `.on` are deliberately shared - the button and the state are
meant to look like the rest of the app.

**QuickBooks is asked for by the section, not at the door.** Somebody signs up
with their own address and sees all four sections; the three that need a company
show a Connect panel instead of their tiles. This is why `OPEN_WITHOUT_COMPANY`
in `server.js` lets the five front pages through the gate when `!settled`, and
why `nav.js` does not send a company-less person to `/choose` on those pages.
Every other page still needs one.

The courier pages sit in two sections. Which rail they wear is whichever section
they were entered from, kept in `sessionStorage['fusion:section']` for the tab.

Inner pages still use the left rail only - the launcher's top bar is not on them.

There is a harness for this: it runs `nav.js` and `tiles.js` against a stub
browser and prints the section each path picks and every section's tile list.
Worth re-running after touching either file, because a throw in nav.js breaks
every page in the app.

## Open items
- Replace the copied old files with the new design once the user describes it.
- Decide DigitalOcean settings: turn **Edge caching** and **Email obfuscation** Off (app shows
  live data).
- Check the Neon dashboard for the real storage limit.
