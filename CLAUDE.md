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
| Google | `google` | `g:<google sub>` | Themselves, one click (**not built yet** - needs a Google OAuth client) |
| Company user ID (`hmna-01`) | `member` | `id:<login id>` | The administrator of a company, on `/users`. No email, tied to `home_realm` for life |
| QuickBooks | `qb` | Intuit's sub | As before |

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

## Open items
- Replace the copied old files with the new design once the user describes it.
- Decide DigitalOcean settings: turn **Edge caching** and **Email obfuscation** Off (app shows
  live data).
- Check the Neon dashboard for the real storage limit.
