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
| Local folder | `C:\Users\Project Availity\Desktop\digithub-fusion` (the work moved here from the `ASUS-1` profile; paths below that still say `ASUS-1` are on the old machine) |
| Git author here | `Project7246` / `project.availity@gmail.com` (set in this repo's local git config) |
| Git push login | Windows Credential Manager holds the old app's `availityltd` token for `github.com`, which this repo is denied (403). Fixed by `credential.https://github.com.useHttpPath=true` in this repo's **local** config, so the credential is looked up per repo path and the old app keeps its own. Do not set this globally |
| Git on this machine | Installed by `winget install --id Git.Git -e` at `C:\Program Files\Git\cmd\git.exe`. A session opened before that install has the old PATH, so `git` is not a word it knows - call the full path until Claude Code is reopened. The GitHub credential is already in Credential Manager here: `git fetch` works without a browser |
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
- How full the database is, and what the month has cost, are both on
  Settings > Database (ADMIN_EMAILS only, `/api/storage`).

### The month's compute hours, and who spends them

Neon charges for the **time its compute is awake**, not for the queries run, and it
sleeps about five minutes after the last one. So the bill is not how much is stored
or how many rows are read - it is **how often anything wakes the database up**. Two
queries four minutes apart cost one spell of nine minutes; the same two an hour
apart cost two spells of five.

`compute.js` is the meter and the budget. It wraps `pool.query` and `pool.connect`
once, in `initCompute()` - first in the boot chain, right after `initDb`, because a
query made before it is a query it never counted - notes the time of every query,
and closes a spell when the gap passes the sleep window. The month's total lives in
**`compute_meter`**, which, like `app_keys` and `once_done`, holds nobody's work and
so carries **no `realm_id`**. `bg_seconds` on that row is the part the background
sweep paid for: a query does not say who sent it, so the sweep is the only thing
that can measure itself.

What it changed:

- **The keeper no longer sweeps on a fixed clock.** Every thirty minutes is 48
  wake-ups a day at about six minutes each - some 180 hours a month against an
  allowance of 100, so it would have run out around the 20th of every month. The
  sweep now asks `nextGapMinutes()` what the month can still afford and schedules
  itself with a `setTimeout`, because a `setInterval` cannot change as the month
  goes on.
- **A live webhook buys most of it back.** An account whose hook called within the
  last 24 hours is skipped between the slow rounds (`KEEPER_HOOKED_MINUTES`, six
  hours): the courier is already telling us the thing the sweep went looking for.
  The sweep stays for the money side and for whatever no hook mentioned.
- **A webhook about a parcel we have never seen now writes the row** -
  `applyStatus()` in `hooks.js` returns `added` - instead of logging "not here yet"
  and waiting for a sweep that is deliberately hours away. The next sweep fills in
  the rest.
- **At `COMPUTE_STOP_AT` (95%) the background sweep holds off until the 1st**, and
  the page says so. Webhooks still arrive, one query each, and **Pull orders still
  works when a person asks**: a person waiting is worth compute, a sweep nobody
  asked for is not.
- **Polling an open tab is the other big spender.** A look every five minutes is a
  database that never sleeps. The bell in `nav.js` is now ten minutes and stops
  entirely in a tab nobody has touched for half an hour; `/courier-dash` watches the
  keeper every five minutes rather than every minute when nothing is running; the
  wall-display poll on `/shopify-log` pauses while its tab is hidden. **A new
  always-on poller is a standing charge on the month** - tie it to a running job, or
  make it pause on `document.hidden`.

| Setting | What it is |
|---|---|
| `NEON_CU_HOURS` | the month's allowance the budget is measured against (100) |
| `COMPUTE_SHARE` | how much of it the background sweep may take (0.5) |
| `COMPUTE_STOP_AT` | where the sweep holds off entirely (0.95) |
| `KEEPER_MINUTES` | the floor on the gap between sweeps (30) |
| `KEEPER_MAX_MINUTES` | the ceiling on it (360) |
| `KEEPER_HOOKED_MINUTES` | how rarely an account with a live webhook is swept (360) |
| `NEON_IDLE_MINUTES` | how long Neon stays awake after the last query (5) |

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
- **The administrator of a company** is whoever made it - the person who signed up
  (`claimCompany()` in `/auth/signup`), or whoever connected books that had no
  owner yet (`/auth/callback`). `companies.owner_sub` is the one record of it.
  They hand out that company's user IDs, set what each may touch, and can see and
  change nobody outside it. `requireAdmin()` and `runsCompany()` are what let them
  in; `mayConnect()` is what lets somebody connect books at all.
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

## Signing up is an account, not a company

Fusion is sold as a service, so **who works in which company is Fusion's to say**.
`/auth/signup` makes the account and nothing else: `createSelfAccount()` writes the
row with `allowed = FALSE`, `role = 'viewer'` and `decided_at` NULL, and no company
is made. The person lands on `/choose`, which names who to ask -
ADMIN_EMAILS' first address and `SUPPORT_PHONE` (default `03361155000`), both sent
on `/auth/status` as `support`. In the same breath `tellAdmins()` puts a notice on
the super admin's bell and an email in their inbox, linking to `/people`.

It used to hand you a company of your own at sign-up. That was right when anybody
could be their own customer; it is wrong now, because a client's company is set up
for them by the consultant who sold it.

## A company is made at sign-up, and QuickBooks joins it later

The account **is** a company. `/auth/signup` asks only name, email and password (password on step one, code alone on step two); the company is made with the person's name as a placeholder - the real company name is set in Settings > Your profile (`POST /api/company/name`, administrator only), where "Create user IDs" also leads - and `createWorkspace()` (`db.js`) writes a `companies` row with an id
of ours - `fx-` plus sixteen hex characters, which `isWorkspace()` recognises and
Intuit's all-digit realm can never look like. `owner_sub` is the person who typed
it. So from the first screen they have somewhere for couriers, Shopify orders and
staff to live, and `requireAdmin()` opens, which is what lets them hand out user
IDs **without QuickBooks existing at all**. That was the blocker: `refresh_token`
used to be `NOT NULL` and a company meant a set of books, so nothing could be done
until Intuit had been visited. `initDb()` drops that NOT NULL.

What a module may do is `role` + `rights`, as before - `custom` means "these
modules, and full work inside them". Read-only is a different role (`viewer`).
Giving somebody couriers means they book, sync and settle couriers.

When the owner does connect QuickBooks, the company they already have **takes the
realm number as its own id** - `graduateWorkspace()` in `db.js`, run from
`/auth/callback`. Every table that scopes rows by company is found from
`information_schema` (`realm_id`, plus `users.home_realm`) and carried over in one
transaction, then the `companies` row itself. The alternative was two companies
per person, each holding half their work, and a chooser asking which half they
wanted today. Because the id ends up being the realm, the ~31 places that build
`/v3/company/<realmId>/...` never had to learn anything.

- `/auth/status` carries both: **`connected`** = there is a company open, which is
  true from sign-up, and **`qb`** = these books are joined to QuickBooks. Anything
  that asks Intuit something gates on `qb` (see `finance.html`), never `connected`.
- `getAccessToken()` (`qb.js`) says so in words when a company has no token yet,
  rather than failing as if the run went wrong.
- `listCompanies()` returns workspaces too, each with `connected`.
- Connecting does **not** change who is signed in. `/auth/callback` used to read
  the person out of Intuit and sign them in as that, from when QuickBooks was the
  door - so somebody who had signed up with their own address and pressed Connect
  was moved onto a new, empty, access-less account while their real one sat there
  with their company in it. It now attaches the books to whoever is signed in.
- There is **no** staff-ID notice bar on `/` any more (removed on request): signing up
  should look like a normal app. Manage users stays in the rail.

## Sending email

One account, in `notify.js`, and everything that leaves the app goes through it:
sign-up codes, password resets and the notices to an admin who is not in the app.
`sendMail(to, subject, lines, opts)` - `lines` is the plain-text letter and is
never optional, `opts.html` is the dressed one. A sign-up code is read by
somebody who has never seen Fusion before, and a bare line asking for six digits
is the exact shape of a scam, so `codeEmail()` in `server.js` gives it the mark
and the colours. Tables and inline styles, because that is what mail readers
still understand.

| Setting | What it is | Hostinger |
|---|---|---|
| `SMTP_HOST` | the mail server | `smtp.hostinger.com` |
| `SMTP_PORT` | 465 is SSL, 587 is STARTTLS | `465` |
| `SMTP_USER` | the mailbox it signs in as | a real mailbox on `availity.pk` |
| `SMTP_PASS` | that mailbox's password | - |
| `SMTP_FROM` | what the letter says it is from; falls back to `SMTP_USER` | - |

Set in DigitalOcean, never in git. Until they are set **nobody can sign up at
all**, because the code has nowhere to go - so the app says which three are
missing (503) rather than letting somebody wait for an email that is not coming.
A mail server that is set up but refuses the letter is a different answer (502,
"try again in a minute"), because telling somebody to wait when the owner has
not finished setting up leaves them pressing a button that can never work.

Fusion's own admin - `ADMIN_EMAILS`, not a company's administrator, because SMTP
is the whole server's setting - gets an **Email** tab in Settings. It appears
only if `/api/mail/status` answers, so the page never offers what the server
would refuse. `/api/mail/check` asks the mail server whether it would take a
letter without sending one, which is what tells a wrong password (refused there)
from a wrong port (never connects). `/api/mail/test` sends a real one, and only
ever to the address of the person asking: an endpoint that mails wherever it is
told is a way to send mail in this company's name.

## Couriers: three of them, one shape

PostEx, **Trax** and **M&P**. Daewoo is not being worked on and is off the list
entirely - it sat in the rail as "soon" for months, which reads as something broken
rather than something not started. It comes back as a file beside `trax.js` on the
day it is wanted.

One courier is one file, and that file is the whole of the courier's dialect -
nothing above it ever sees a PostEx or a Trax field name. `adapters.js` is the only
list of them. The list used to be written out in `server.js`, `keeper.js` and
`courierlive.js`, so adding a courier meant remembering three lines, and forgetting
one meant the page offered a courier the sweep then ignored.

| File | What it is |
|---|---|
| `postex.js`, `trax.js`, `mnp.js` | one courier each |
| `adapters.js` | the list, `adapterFor()`, `courierKinds()`, `groupFor()`, `readFor()` |
| `statuses.js` | the thirteen buckets, the word rules, `num()` and `day()` |
| `wire.js` | the call, the wrapper-finder, and the shape hunt below |

An adapter hands over `key`, `name`, `fields`, `hook`, `groupOf` and `testToken`,
and then whatever else it can do: `fetchOrders`, `fetchPayment`, `trackOne`,
`fetchCprs`. Callers check before using one - a courier that cannot be asked about
a single parcel simply has no `trackOne`.

- **`fields` is what a courier needs typed in**, and the add screen draws itself
  from it: PostEx asks for one token, M&P for a login, a password and a shipper
  code. The **first field is always the account's token**; the rest are kept
  encrypted (`secrets.js`) in `courier_accounts.creds` and handed back to the
  adapter as `extra`. A column per courier is how a table ends up with nine empty
  ones.
- **`groupOf` is per courier.** PostEx's "Out For Return" is Trax's "Return in
  Transit" is M&P's "RETURN IN PROCESS". A status nobody listed still lands
  somewhere sensible through `byWords()` in `statuses.js`, where the return words
  beat the word "delivered" - "RTO Delivered" is a return that finished.
- **The webhook reads by courier too** (`groupFor`, `readFor`, in the
  `/hooks/courier/:courier/:key` route). It used to run every courier through
  PostEx's reader, which would have filed every Trax status under "other".
- **All three are written against their own documents now.** Nothing in
  `trax.js` or `mnp.js` is guessed at any more, and `wire.js`'s `hunt()` - which
  tried a list of possible shapes until one answered - is no longer used by
  either of them. `TRAX_BASE`, `MNP_BASE` and `MNP_TRACK_BASE` move a base URL
  without a deploy.

### Where each courier answers from, and why that broke Trax

The app is hosted in DigitalOcean's **Bangalore** region, and not every courier
answers from a network Bangalore can see.

| Host | Network | Reachable from the app |
|---|---|---|
| `api.postex.pk` | Cloudflare | yes |
| `mnpcourier.com` | Cloudflare | yes |
| `tracking.mulphilog.com.pk` | Azure | yes |
| **`sonic.pk`** (Trax) | **PTCL, inside Pakistan** | **no - the call times out** |

So the first Trax key gave `✗ That did not work: Trax said nothing: fetch
failed`, which reads like a bug here and is not one: the same key, from a
laptop in Karachi, answers in under a second. Nothing in the key, the endpoint
or the adapter can fix a route.

Two things came out of it:

- **`reach.js` and `GET /api/courier/reach?courier=<key>`**, behind the
  *Can this server reach it?* button on `/couriers`. It walks the four steps a
  call takes - DNS, TCP, TLS, a plain GET - from the server, and names which one
  broke. A `tcp` step that times out while DNS resolved is the route; an
  `ECONNREFUSED` is their server saying no; a failure at `http` is ours to fix
  in the adapter. **Ask this before touching a key.** Node says only "fetch
  failed" and hides the code two levels down in `cause`, so `codeOf()` and
  `plainly()` in `wire.js` dig it out - `ETIMEDOUT`,
  `UND_ERR_CONNECT_TIMEOUT`, `ENOTFOUND` - and every courier error now carries
  it.
- **A relay, for a host that cannot be reached any other way.** Two of them,
  the same job: `tools/courier-relay.js` is a Cloudflare Worker and
  `tools/courier-relay.php` is a file to drop on the Hostinger site, for when
  a new account is not wanted. Both forward to the `sonic.pk` hosts and
  nothing else, both need their key in `X-Relay-Key`, and both drop that key
  before passing the call on. Set `COURIER_RELAY` and `COURIER_RELAY_KEY` in
  DigitalOcean and `wire.js` sends **only** the hosts in `COURIER_RELAY_HOSTS`
  (default: the sonic.pk ones) that way; PostEx and M&P keep going straight
  out. An address containing `{url}` means the target goes in as an encoded
  query parameter (the PHP one); without it, the target is appended as a path
  (the worker). The adapters' own base URLs never change, so nothing above
  `wire.js` knows it is happening.
  The other way out is to host the app in a region that can reach Pakistan -
  App Platform cannot be moved after it is made, so that means a new app.

  **Confirmed on 22 Oct 2026**: the reach check from the live server said
  `dns 3ms` then `tcp ETIMEDOUT` for sonic.pk (119.160.105.77), while M&P and
  PostEx - both behind Cloudflare - connected and pulled normally. trax.pk is
  on the same PTCL range (119.160.105.78), so there is no second address to
  try.

### Trax is told, M&P is asked

The two couriers work in opposite ways, and both ways are theirs, not ours.

**Trax** goes through Sonic, the platform behind it (*API Documentation-SONIC*,
version 2.0). The key is at sonic.pk -> company name, top right -> Profile ->
API key, and it is handed over as a plain `Authorization` header - not a Bearer
token. Their `status: 0` in the body **means it worked**; it is their own code,
not an HTTP one.

- **Sonic has no call that lists a day's shipments.** Twenty-seven endpoints and
  every one is about a tracking number you already hold, or about booking a new
  one. So `trax.js` sets **`lists: false`**, and the keeper, `/api/courier/sync`,
  `courierlive.js` and `backfill.js` all check it: instead of asking for days
  they call `refreshKnown()` with the parcels still moving
  (`movingTrackings()` in `couriers.js`). Nothing shows an empty week and
  pretends that is the answer.
- **Its four webhooks are where Trax orders come from**: Shipment Status,
  Payment Status, Initial Charges and Final Charges. Between them they carry the
  status, the COD, the charges, the GST and the settlement - so `hooks.js` grew
  `applyCharges()` and `applyPayment()` beside `applyStatus()`, and the route
  reads `kind` off the courier's own reader to know which it is holding.
- **Sonic's webhook screen takes a URL and nothing else** - there is no field
  for a header. So for an adapter with `hook.headerless`, the second secret
  rides in the address (`hookUrl()` puts `?k=` on the end) and `secretFrom()`
  takes it from the header or the query. Two locks still, in one pasteable line.
- **Their rules**: 5 attempts, **3 seconds** each, and after 5 failures the
  subscription switches off and has to be turned on again by hand. Three seconds
  is less than a sleeping Neon compute takes to answer its first query, so
  `/hooks/courier/:courier/:key` now **answers 200 before it does anything** and
  applies the call afterwards (`applyCourierHook()`). A wrong key gets the same
  200 and a line in the server log - a 401 was tidier and also told whoever was
  guessing that they had found a live address.

**M&P** is the COD API at `https://mnpcourier.com/mycodapi/api` (*M&P COD API
Manual*, 2025022404). The sign-in is a username and a password **in the call
itself** - query on a GET, JSON body on a POST - and their own document spells
the pair three ways across the endpoints (`username`, `UserName`, `Username`),
so every call sends all three.

- **M&P have no webhooks.** None in the manual, none in the portal. So M&P is
  the one courier that must be polled, and it is kept cheap: one
  `Reports/QSR_Report` call **per month** (their report is monthly - a span of
  days is fetched a month at a time and cut to the span here), plus
  `Tracking/Bulk_Consignment_Tracking_New`, which takes **200 consignments a
  call** and carries PaymentID, PaymentDate and AmountPaid, so settlement needs
  no second ask.
- **The account number and location id are looked up, not typed.**
  `UserManagement/GetAccounts` needs only the sign-in, so it is the test call;
  `GetSubAccounts` gives the location id the reports want. Whatever `testToken`
  learns is merged into the account's `creds` when it is saved.
- One consignment can also be read from their public tracking screen
  (`tracking.mulphilog.com.pk/api/CNTracking`, `id` always 4), which needs no
  sign-in at all.

**A date is not a moment.** `day()` in `statuses.js` reads a courier's date by
hand and never through `toISOString()`: M&P send `02 Nov 2024`, and parsing that
as local midnight and converting to UTC moved it back into the 1st. And the two
couriers disagree about slashes - Sonic writes 5 April as `05/04/2022`, M&P's
tracking writes 14 June as `06/14/2025` - so `day(v, 'mdy')` exists and `mnp.js`
uses it for `TransactionTime` alone. Where either number is past 12 the numbers
decide and the hint is ignored.
- **An account is added from the rail**: every courier in the courier tree carries
  `+ add an account`, which opens `/couriers?add=<key>` with that courier already
  picked.

## The courier dashboard answers the money question first

The page used to say where every parcel got to and leave the only question
anybody actually asks - **how much is the courier still holding of ours** - to
be worked out by eye. It is now the first thing on it, and it is a chain, not a
figure, so it can be argued with:

```
  COD on delivered parcels        what the courier collected at the door
  less their charges and tax      what they keep for carrying it
  = the courier owes
  less what they have paid out    settled, or carrying a receipt number
  = STILL TO RECEIVE              the figure to chase them for
```

- It is **all-time, not the dates on screen**. Money owed on a parcel delivered
  last month is still owed today, and a date filter is no reason to leave it
  off. The chosen range gets its own line underneath, and the Money tab shows
  both chains side by side.
- **Every line opens.** `ordersBy()` took `due` (1 = delivered and unpaid,
  0 = paid) and `late` (delivered over a fortnight ago and still unpaid), so
  each figure can be opened into the parcels it is made of. A number nobody can
  open is a number nobody believes.
- `moneyOwed()` in `dashdata.js` is the whole of it: `owedQuery()` twice - with
  dates and without - plus `receiptsOwed()`, which is the other half of the
  story: of the money they have paid, how much is in QuickBooks. A receipt with
  no payment against it is money in the bank the books do not know about, and
  that is a different job from chasing a courier.
- **`settled IS TRUE` or a receipt number** both count as paid: PostEx says so
  on its payment call, Trax on its payment webhook, M&P by handing back a
  PaymentID, and all three land in the same two columns.
- **Each courier company has its own row** (`byCourier` in `dashdata.js`) -
  PostEx against M&P by name, not two PostEx accounts to be added up by eye.
  Clicking one scopes the whole page to it.

## CPRs and receipts were the same thing

A cash payment receipt **is** the receipt, and `/cprs` and `/receipts` were two
screens for it - so a merchant asking "what has PostEx paid me" had to know
which to open. `/cprs` now redirects to `/receipts` (301; the address is in
people's history), `public/cprs.html` is gone, and the rail has one line,
**Receipts (CPR)**.

The merged page has two halves, and the top one is new:

- **Every receipt we hold**, built from the parcels rather than from any
  courier's portal - so it covers all three. PostEx's CPR number, M&P's
  PaymentID and Trax's payment id all end up as `courier_orders.cpr_number`,
  and `recentCprs()` groups by it, joining `courier_cprs` where a row exists
  for what was done with it in QuickBooks. Clicking a receipt opens its parcels
  underneath it.
- **The PostEx portal work** below it, unchanged: sign in, match a receipt,
  write the payment into QuickBooks. When there is no PostEx account that half
  now explains itself quietly instead of filling the page with "No PostEx
  account yet" - the list above is the answer for the other couriers.

## Logistics has a day as well as a set of accounts

The rail used to hold the courier accounts and nothing else - who we have
keys for, where each parcel got to, what has been paid. That is the ledger
side. Three lines under **The day** are the other side, and they are in the
Logistics rail only: the same line in two rails is two places to look for one
page.

| Page | What it is |
|---|---|
| `/load-sheet` | the day's orders split between the couriers, before anything is booked |
| `/delivery-reports` | what happened to them afterwards, per courier |
| `/service-areas` | where each courier will go at all |

### Service areas: the courier's own list, not ours

`/courier-dash`'s Cities tab is the cities **we** have sent to. This is the
list the courier publishes, which is a different question - "will Trax go to
Chaman at all" is asked before a parcel exists, and the dashboard cannot
answer it.

Each adapter grew `fetchAreas(token, extra)` returning one shape -
`{ id, name, hub, zone, pickup, delivery, services }`:

- **Trax** `/cities`, the richest of the three: hub, zone, a pickup flag and
  the delivery services allowed into each city, all from the Sonic document.
- **M&P** keep **two** lists and they are not the same list -
  `Branches/Get_Cities` is where they will collect from,
  `Branches/Get_Cities_All` is where they will deliver to. Both are read and
  merged into one row with two flags, because two lists side by side only get
  compared by eye. If one refuses, the other is still shown.
- **PostEx** `get-operational-city`. This is the one path in the three
  adapters **not** taken from a document in hand, so it is written to fail
  quietly - the page says PostEx handed over no list and the other couriers
  still answer. If PostEx move it, that is the line to change.

The page asks every courier at once and answers "who goes there" comparatively,
which is the question: one goes, one does not, and that is which one the
parcel is booked with. `GET /api/courier/areas?account=N` keeps each answer
**in memory** for an hour - a city list changes a few times a year, and
re-reading it on every page open would be a slow page and a charge on the
month for nothing. It touches no table, which is the point.

### Delivery reports: four queries, thirteen buckets, per courier

`deliveryReport()` in `dashdata.js` is the whole of it and is deliberately
**four queries in one `Promise.all`** - a report page that fires a dozen is a
database that never sleeps, and the month's compute pays for that.

1. every status, under its bucket, under its courier
2. the three legs of the journey, as averages and as a spread
3. the cities, per courier
4. the days, where a parcel booked on Monday and delivered on Friday is
   counted on both

Seven tabs come out of it: where they got to, every status, how long it took,
trouble, cities, day by day, and parcel by parcel. Every figure opens into its
parcels through `/api/courier/rows`.

- **Three legs, not one average.** Booked → picked up is ours to fix: how long
  a parcel sits waiting for the courier to come. Picked up → delivered is
  theirs. Booked → delivered is what the customer feels. One number hides
  which of the two is slipping. Counted only where both ends are known,
  because a parcel with no pickup date is a missing date, not a same-day
  pickup.
- **Cancelled, returned, missing, damaged, expired and held** have a tab of
  their own, with the courier's own words for each underneath - that is what a
  claim is argued with.
- **"Every status" is the courier's wording, exactly as it arrived**, beside
  the bucket Fusion filed it under. If a word is in the wrong bucket, that
  table is what proves it, and `statuses.js` is where it is fixed.

### Parcels yes, money no

Asked for by name: a user id that sees where every parcel got to and nothing
about what it is worth.

- **The eye** on `/delivery-reports` hides the money for anybody, remembered
  per browser. That is for showing a screen to somebody standing beside you.
- **`users.hide_money`** is the real one: a tick beside the role on `/users`,
  and `POST /api/admin/users/money` behind the same fence as `/access`. When
  it is on, `/api/courier/report` **strips the figures before they leave the
  server** and the eye is not drawn - a switch the browser could flick back is
  not a switch.

It is **not** in `RIGHT_GROUPS` on purpose. Those are things somebody may
*do*, they only bite on the `custom` role, and a `full` role is given every
right by name - so a "may see money" right would have been handed to everybody
automatically and a "hide money" right would have been handed to everybody
automatically too. A column of its own, off until somebody turns it on, is the
only version that leaves yesterday's users seeing what they saw yesterday.

### The load sheet is the dispatch router, in a frame

`/load-sheet` is a Fusion page holding `/dispatch-app.html` in an iframe, and
that is a decision rather than a shortcut. The router is a whole application -
its own sidebar, its own views, its own rules for splitting a day between
courier companies by city, by each company's share, by what went wrong there
last time, with duplicate-customer merging, COD overrides, history and
per-account sheet templates for PostEx, Trax and Daewoo's own column orders.
Its stylesheet names `.main`, `.card`, `.btn` and `.head`, every one of which
`app.css` also names. Dropping it into a Fusion page meant renaming a few
hundred selectors and hoping. The frame is same-origin, so it signs in as
whoever is signed in and reads their orders without being handed anything.

What changed inside it: the palette is Fusion's (slate, teal, grey - declared
once at `:root` in the names the tool already used), and there is a second
source beside the file drop. **"Aaj ke Shopify orders laayein"** reads
yesterday's and today's unbilled orders from `/api/shopify/orders` and writes
them back out **in Shopify's own export shape** - one row per line item, the
customer filled in on the first row of each order - and hands that to the same
`handleFile()` the dropped file goes through. One parser, one set of rules, and
the day's orders need no file at all. `/api/shopify/orders` grew `phone` and
`shipTo` for it, built from the `bill_to` block the invoice already prints.

### /pickups was never a page

`public/pickups.html` held thirty-six lines of **server** code - an express
route written to the wrong path. `express.static` served it to the browser as
the text of a page, so the Pickups line in the rail showed a screenful of
JavaScript, and the CSV download it defines did not exist anywhere. The route
is now in `server.js` as `/api/courier/pickup-file` and `/pickups` is a real
page: each handover day, what it was worth, how much of it has settled since,
and the parcels underneath. It is the load sheet **after** the fact;
`/load-sheet` is the one handed to the rider before the day starts.

### A receipt belongs to one courier

`/receipts` showed every courier's receipts in one table, so opening PostEx -
RB listed an M&P receipt beside PostEx's. The page now picks a courier company
first - a tab each, by name, and a matching shelf under **Receipts (CPR)** in
the rail - and the list, the figures and the PostEx portal half all answer to
it. Arriving with `?account=N` locks it to that one account. On an M&P or Trax
tab the PostEx sign-in is not drawn at all: there is nothing there to sign in
to. The shelf stops at the courier and does not go down to the account,
because a courier pays per receipt, not per account.

**`.bar` was two different things.** `app.css` keeps a 7px progress bar under
that name, with `overflow:hidden`, and `receipts.html` used the same word for
its row of controls - so every control on that page was clipped to seven
pixels. That is the row of half boxes under the tabs. It is `.cbar` now, and
renamed rather than overridden, because the next page to borrow `.bar` would
have hit it again. The new pages all use `.cbar`.

## A page whose script does not parse looks exactly like a slow server

`/shopify-log` and `/shopify-undo` each shipped with **a real newline inside a
JavaScript literal** - a `\n` that lost its backslash somewhere between an
editor and a shell. One was `/[",<newline>]/` in a CSV helper, the other a
`confirm()` string broken over two lines.

Every page here keeps its whole script in **one block**, so one bad character
takes the page with it. Nothing crashes, nothing reaches the server log, and
the page still draws - the HTML is fine. What is on screen is the markup's own
placeholder text, frozen: "Waiting…" in the live log, "Loading…" under the
tabs, an empty strip where the figures go. It reads as a slow database and it
is not one. Those two pages had been dead since the day they were written.

- **`npm run check`** (`tools/check-pages.js`) parses every inline script and
  every file in `public/`, names the file and line, and exits 1. Run it before
  pushing anything that touched a page.
- **Writing these files from a shell heredoc is what does it.** The shell eats
  a backslash and the result is valid-looking text. Write pages with the
  editor, or with a Python script held in a file - never a heredoc with
  escapes in it.

### And the page must say when a read fails

The same screen had three loaders ending in `.catch(function(){})`. A failed
read left the placeholder exactly as it was, so "the request died" and
"nothing has happened yet" looked identical. Every loader says what went wrong
now, `get()` gives up after twenty-five seconds rather than spinning for ever,
and there is one call whose whole job is to tell the two halves apart:

**`GET /api/shopify/progress` touches no database.** It answers out of memory.
If it comes back while `/api/shopify/report` does not, everything is queued
behind the database, and the page says so - rather than leaving somebody
looking at a spinner wondering whether the server is up.

`tally()` in `shopify.js` was seven `await`s in a row - seven round trips to
Neon for one page, slow enough on a cold compute to look like a hang. They are
one `Promise.all` now.

## Auto sync says what it is doing, not that it is on

"Auto sync on" is a switch. It is not an answer to *what is being synced*, and
the Connector made that worse: it said **"running; nothing is waiting"** over
542 orders that were ready to go, because that sentence was printed whenever
no next turn was booked and nothing had failed. The queue was never in it.

The writer now keeps `state.doing` - the batch total, how many of it are done
and **the order it is on** - updated as each one is written. It is in memory,
so reading it is free, and both screens show it:

- the Connector has a bar under the five counts while a pass is running
- the live log on `/shopify-log` has the same bar above the lines already
  written, asked every four seconds, which costs the database nothing

And the Connector's line now accounts for the queue: *"542 ready to go — 20 at
a time, about 28 minutes to get through them"*. **Twenty an order a minute
(`SHOPIFY_BATCH`, `SHOPIFY_SWEEP_SECONDS`) is why five hundred do not all move
at once**, and nothing on the screen used to say that. Its count poll also
stops while the tab is in the background, like every other poll here.

## The connector is a system, not a pile of restrictions

Said by the owner, and it is the right criticism: *"itni choti choti
instructions mein app ko bound kiya hua hai... ap is ko ek general connector
ki tarah banao... main chahti hoon is ka ek poora system ho, app ko lage ye
system hai, restriction nahi."*

Every rule in this file arrived as a correction - do not write a #, do not
void, do not create a product, delivery must be a line, free delivery at 0,
discount yes, memo no. Each was right on its own and together they read as a
list of things not to do, which is a hard thing to hold in one head and an
easy thing to contradict.

**The Connector screen is the statement of the system.** Five numbered rules
in plain English, each either configurable there or stated with its reason -
what is picked from Shopify, when, and in the shape QuickBooks needs. That
page, not this file and not a conversation, is where the rules live and where
they are read. A new rule belongs on it; a rule that cannot be put on it in
one sentence is probably not a rule but a special case, and special cases are
what made the item matching dangerous in the first place.

The rules, as the screen states them:

1. an order in Shopify becomes an invoice in QuickBooks, numbered by the
   order number, on the customer's terms
2. one customer for the shop; the buyer's own name and address go in the
   billing block, and nothing goes in the memo
3. products match on **the SKU and nothing else**, and nothing is ever made,
   renamed or given a SKU in QuickBooks
4. delivery is a line on **every** order, free ones at 0; the discount goes
   in the discount box, in rupees
5. cancelled and void orders are left out

## A refusal is only news while it is still true

"QuickBooks said no" listed every refusal there had ever been, so an order
turned down at four in the morning and written at noon stayed on it for ever,
under a heading that says something is wrong. Ten orders sat there, every one
of them long since in the books, and a clean list looked dirty.

`events()` took an `open` flag: with it, an event is left out when its order
is now `done`. Company-level errors - books that would not open - have no
order and stay. The tab's own counter counts the same thing, from `tally()`,
or the number and the list would disagree.

The history is not deleted. It is in the table, and **Download this report**
still carries all of it; it is only not shown under a heading that claims it
is a problem.

## Clearing a list is clearing our notes, never the books

**Products made** held fourteen lines about products this app created in
QuickBooks back when it did that - every one of which the owner then undid by
hand. The notes were a record of something that no longer exists.

So that list has **Clear this list**, which deletes those rows from
`shopify_events` and nothing else. It asks twice, says in as many words that
nothing in QuickBooks changes, and is offered only where the notes can be
wrong in that way (`CLEARABLE` in `shopify-log.html`). `POST
/api/shopify/events/clear` names the one list to clear and takes nothing else.

## A deleted item is not there

An item merged away or switched off in QuickBooks is finished with. It must
not be offered in a list, must not be named in a reason, and must never reach
an invoice - QuickBooks would refuse it, and before that it is simply not an
answer to anything.

`itemShelf()` tells the two apart once, so nothing below it has to:

| | what is in it |
|---|---|
| `ids`, `skus`, `live` | **active items only** - what may be matched, offered and put on an invoice |
| `everyName` | id to name over **every** item, active or not |

`everyName` exists for one job: reading an old invoice back and saying what is
on it. An invoice written last month may well point at an item deleted since,
and **Check the invoices** has to be able to name it.

This also closed a quiet hole: a hand mapping pointing at an item deleted
afterwards used to pass `books.items[...]` and go on an invoice.

The "the item carrying this SKU is inactive in QuickBooks" message is gone with
it. It named a product the owner had already merged and deleted on purpose,
which is noise - the plain answer, *this SKU is on no item in QuickBooks*, is
the true one.

The "off" tag beside a twin on Product health stays: that page's job is to show
what was merged, and a label saying so is not an offer to use it.

## What an old order cannot be told

An order placed in August carries the lines **as they were in August**. A SKU
put on the product in Shopify today does not reach back into it and never
will - so "no SKU in Shopify" on a three-month-old order is a true statement
about a thing that can no longer be fixed at the source. The only place it
can be answered is in Fusion.

**Needs you** now asks for that answer, grouped by the thing that is actually
blocking rather than by order: this product, that SKU, how many orders are
waiting on it and what they are worth, with the company's own QuickBooks item
list to answer from - searchable by SKU or by name, because the two sides call
things different things. Twenty-three orders waiting on Radiance Sun Veil
Sunblock are **one decision**, and asking for it twenty-three times would be
the same decision typed out twenty-three times.

The answer is saved as a mapping, which `itemFor()` consults first. **Nothing
in QuickBooks is touched by it** - it is a note on our side saying "when
Shopify says this, the books mean that". **Leave out** is the other answer,
for a line that should not be billed at all.

`stuckItems()` works the groups out from the orders' own lines against today's
item shelf, not from the stored reason, so an answer already given or a SKU
since added simply is not in the list.

## Fewer tabs on the report

**Price and cost** and **Paid, refunded, cancelled** are gone. Neither was a
thing anybody did anything about from there - a price moving in Shopify is not
a decision for the books, and a refund is dealt with in QuickBooks. A tab
nobody acts on makes the ones that matter harder to find. **Items made** is
**Products made**, which is the word the rest of the app uses.

## The worst thing this app has done, and how to find it

A Shopify line carrying SKU **SP-21** went onto the QuickBooks item whose own
SKU is **SP-21-50** - a different product at a different price - on real
invoices, repeatedly, with nothing said anywhere. The owner found it by
opening QuickBooks.

The path, in `itemFor()` before 21 Oct 2026:

1. the SKU matched no item, so it tried to **create** one named after the
   Shopify product
2. QuickBooks refused with *duplicate name*
3. it looked that name up and used whatever came back —

```js
} else if (found.Sku) {
  books.skus.set(String(found.Sku).toLowerCase(), found.Name);
}
return { name: found.Name };     // a different SKU's item, matched by name
```

The `else if` is the whole of it: the code noticed the item already carried a
**different** SKU, declined to overwrite it, and then used the item anyway.
"Anti Acne Cleanser 50ml" and "Anti Acne Cleanser 50" were close enough for
QuickBooks to call it a duplicate name, and that was the entire check.

**It cannot happen again.** Matching is the SKU and nothing else, nothing is
created, nothing is renamed, no SKU is written onto anything - see the two
sections below. A name is not an identity, and this is what that costs when
it is treated as one.

### Check the invoices

`checkWritten()` in `shopifysync.js`, behind **Check the invoices** on
`/shopify-log`, reads every invoice Fusion has written back out of QuickBooks
and shows each line that disagrees with what its SKU says today: the invoice,
the order, the SKU, what it should be, and what went on instead. The list
downloads as a file.

It **writes nothing**. What to do about an invoice already in the books is the
merchant's to decide, in their own books - that is the rule that was broken in
the first place.

Invoices are read by **date range**, not one call each, so a few hundred
orders are a few calls rather than a few hundred.

## Catch up first, in date order, then go live

The owner's rule, and it is the right one: **start at the date I chose, work
forward, and when you reach today carry on live.** One direction, one order.

What was happening instead was two writers at once. The sweep worked forward
from 19 August while the webhook wrote each new order the moment it arrived,
so the books filled from both ends - today's invoices in, August's untouched -
and for a while both were in QuickBooks against the same company at the same
moment, each with its own open books and its own customer lookup, neither
aware of the other.

So `nudgeOrder()` now asks one question before writing: **is anything older
than this still waiting?** If it is, the order stays in the queue, the sweep
is told to come round at once, and it will reach this one in its turn. The
moment nothing older is waiting, a webhook writes live again - which is the
whole point of a webhook, kept for when it is the right thing to do.

`olderWaiting()` counts **`waiting` only**, and that distinction is the whole
safety of it: a **held** order is waiting on a person, not on its turn, and
the sweep never picks one up by itself. Counting those would mean one order
stuck on a missing SKU in August stops every order after it, for ever.

The screens say which it is doing. While there is a queue the live line reads
**Catching up · working through 2026-08-21 · 7 of 20 in this batch · #9323540**,
and it goes back to **Writing now** once it is live. A date, rather than a
feeling.

## The queue was read for every company at once

539 orders ready to go, 25 written, and the ones that *were* going in were
all **today's**. That shape is the whole diagnosis: new orders go in from the
webhook, which writes them itself and never touches the queue, while the
backlog never moved at all.

`dueOrders()` took the oldest N waiting orders **across every company in
Fusion**, and `sweep()` then threw away the ones whose company had sync
switched off:

```js
const rows = await dueOrders(BATCH);        // oldest 20, any company
for (const [realmId, list] of byRealm) {
  const s = await settingsOf(realmId);
  if (!s.on) continue;                      // ...and there goes the batch
```

One company with older orders and its switch off fills the whole batch, every
pass, for ever. The sweep looks, does nothing, sees it has done nothing -
`const busy = did.done || did.held || ...` - and books the **idle** gap, ten
minutes. Then does it again. Meanwhile another company sits on five hundred
ready-to-go orders and never gets a turn.

Both halves belong in the query, not after it:

- **only companies whose sync is on**, as an inner join against
  `app_settings` where `key = 'shopify'` and `value->>'on'` is true. A company
  with no settings row at all is off, because `DEFAULTS.on` is false, so the
  join is the whole test.
- **a batch each, not a batch between them.** `ROW_NUMBER() OVER (PARTITION BY
  realm_id ...)` means one company's backlog cannot starve another's, however
  old it is.

### A backlog is worked through, not slept through

Twenty a pass with a minute between passes is, for five hundred orders, half
an hour of mostly sleeping - and somebody watching it reasonably asks why the
file upload is quicker. When a company's slice comes back full there is more
behind it (`did.more`), so the next pass goes almost at once
(`SHOPIFY_BACKLOG_SECONDS`, 4). The resting cadence comes back the moment the
queue is shorter than a batch.

| Setting | What it is |
|---|---|
| `SHOPIFY_BATCH` | orders per company per pass (20) |
| `SHOPIFY_BACKLOG_SECONDS` | gap between passes while clearing a backlog (4) |
| `SHOPIFY_SWEEP_SECONDS` | the resting gap when something is still moving (60) |
| `SHOPIFY_IDLE_SECONDS` | the gap when nothing is waiting (600) |

Invoices are still written **one at a time**. QuickBooks throttles, and two
passes posting at once is how one order gets two invoices - the writing is not
where the half hour went.

**And the same held reason is not written down twice.** An order held again
for the same reason a second later by the next webhook used to add a second
identical log line, so the log was pages of the same five orders repeating and
everything that actually happened was buried under them.

## "Try all of them again now" reads them back from Shopify first

The button is pressed straight after somebody has fixed the thing the orders
were stuck on, and half the time that fix is **in Shopify** - a SKU put on a
product a minute ago. The order sitting here still carried its lines as they
arrived, SKU-less, so freeing it only put it through the same wall again and
the button looked broken.

It now reads each stuck order back from Shopify (`fetchOne` + `saveOne`, the
same pair the webhooks use) before freeing anything, capped at
`SHOPIFY_REREAD_CAP` (60) - a handful of orders, one read each, nothing
written to Shopify. The answer says how many were read again and how many had
actually changed, so "I added the SKU and it still says no SKU" can be told
from "I added it to the wrong product".

An order Shopify will not hand back does not stop the rest; the first few are
named in the answer.

## Delivery is a line even when it is free

`if (ship > 0)` meant an order with free delivery had **no delivery line at
all** and the invoice did not mention it. Free delivery was promised and
given: it belongs on the invoice at 0, the same as it does on the Shopify
order, so the two read the same line for line.

- Delivery to charge and nothing in QuickBooks to put it on still **stops** the
  order - an invoice that quietly leaves money off is worse than one not yet
  written.
- Nought has nothing to lose, so a missing item there is simply no line.
- **"Nothing left to bill" is asked before delivery is added**, or an order
  whose every product was set aside would go in as an invoice carrying nothing
  but a free-delivery line at nought.

**The one line of text Fusion writes for itself** is the description on a
delivery line that came to nothing: `FREE_DELIVERY` in `shopifysync.js`, which
reads **Free Shipping**. It is asked for on purpose - the QuickBooks item is
called "Default Shipping Product" whether the buyer paid for delivery or not,
so a free delivery and a charged one read the same at a glance. A delivery
that *was* charged keeps QuickBooks' own description, and every other line on
every invoice still carries QuickBooks' own words. The constant is exported
and used by all three writers - the sweep, the by-hand build and
`toInvoice()` - so they cannot drift apart.

The discount is a `DiscountLineDetail` on the invoice, in rupees, and has been
all along; what stopped it was QuickBooks' own **Discount** box being off
(`SalesFormsPrefs.AllowDiscount`), which `salesPrefs()` reads every pass. The
order is held in words rather than letting QuickBooks refuse it. The memo
stays empty on purpose: the order number is the invoice number and the address
is in the billing block, so a memo only repeats what is already there.

## Two paths asked QuickBooks the same question two different ways

The product pages have read items correctly for as long as they have existed -
`readItems()` in `products.js`, the one that reads six thousand items for the
big company and matches every SKU without being handed a file:

```sql
SELECT * FROM Item WHERE Active IN (true, false) STARTPOSITION 1 MAXRESULTS 1000
```

The connector wrote its own:

```sql
SELECT Id, Name, Sku, Description, Active FROM Item STARTPOSITION 1 MAXRESULTS 1000
```

**The Sku never came back from that one.** So the connector believed no
product in the books had a SKU, while the product pages, in the same app,
against the same company, listed every SKU correctly. That is the whole of it,
and the answer to "it reads six thousand SKUs there and cannot read a hundred
here".

They ask it the same way now. **A second path asking QuickBooks the same
question in its own words is how one of them is wrong for weeks and nobody
can see why.** `Active IN (true, false)` comes with it: QuickBooks hands back
only the live ones unless both are asked for, and an item somebody switched
off has to be seen here so the order can be told *that* rather than that its
SKU does not exist. An active item always wins the SKU; an inactive one is
only ever used to explain itself, because QuickBooks will not put a
switched-off item on an invoice.

`previewItem()` says the same sentence as `writeOne()` for that case too - the
orders page and the writer must never be two different answers.

## The words on an invoice line are QuickBooks'

Every line Fusion writes carries **QuickBooks' own description** for that item,
or nothing at all where the item says nothing - the way QuickBooks leaves it
when somebody picks that item by hand. Shopify's product title and Shopify's
shipping-method name are never written into the books.

This was wrong until 21 Oct 2026, and the invoices written before it show it:

| On the invoice | What QuickBooks holds |
|---|---|
| `Anti Acne Cleanser - 100ml` | `Anti Acne Cleanser` |
| `Nationwide Reliable Shipping Rs199, FREE Shipping above Rs1999 orders.` | `Default Shipping Product` |

Both of those came from Shopify. Nothing re-writes them: an invoice already in
the books is the merchant's, and **Put it back** (`/shopify-undo`) is where
they choose to delete and have them written again.

What reaches QuickBooks on an invoice, and nothing else: the item (matched on
SKU), QuickBooks' own description, the quantity, **Shopify's price** - what
the buyer was actually charged is a fact of that sale - the order number as
the document number, the buyer's own name and address in the billing block,
and the discount. The memo is deliberately empty.

## Fusion never changes anything in QuickBooks' product list

Said by the owner, in as many words: **whatever is in QuickBooks stays as it
is**. Every product is there and every SKU is on it. Match on the SKU, put the
line on the invoice, change nothing - the same deal the file upload has always
had.

So nothing here makes an item, renames one, or writes a SKU onto one. The
`makeItems` setting is gone, its tick is off the How it runs tab, and
`createItem`/`setItemSku` are no longer imported. `itemsPossible()` answers no,
always, and says why. A SKU that matches nothing stops that one order, names
the SKU under **Needs you**, and goes through by itself the moment somebody
puts that SKU on the right item in QuickBooks.

The damage the old switch did is in the log and in the books: items created
under Shopify's names beside the real ones (`SP-22`, `SP-3` as *product
names*), and the same four products having a SKU written onto them every pass,
night after night - because of the bug below.

## "SKU not on any item in QuickBooks" when the SKU was in QuickBooks

A whole batch was held, each order naming a SKU - SP-1, SP-2, SP-11, SP-15,
SP-16, SP-21-100, SP-24 - and every one of them was sitting in the books. The
products export proved it.

Three things made that possible, and all three are now shut.

- **The read asked for columns and QuickBooks did not send one of them.**
  `SELECT Id, Name, Sku, Description, Active FROM Item` came back **without
  the Sku**, every time. So every pass believed not one product in the books
  had a SKU - which is why the log reads *"QuickBooks already had Anti Acne
  Cleanser without a SKU - put SP-21-100 on it"* over and over for the same
  four products, night after night, and why the pass after that behaviour was
  removed held every order for a SKU that was plainly there. It is
  **`SELECT * FROM Item`** now. A company's item list is small and it is read
  once a pass; there was nothing to save by naming columns.
- **`Sku` is not something QuickBooks will filter on.** The first attempt at a
  fix asked `WHERE Sku = '…'` for the one missing SKU, QuickBooks refused it,
  and the refusal reached the screen as *"QuickBooks would not say whether
  this SKU is there"* - a true sentence and a useless one. The whole list is
  read again instead, once per pass, which cannot be refused.
- **`qbQuery` turned a refusal into an empty answer.** QuickBooks answers some
  refusals with a **200 and a `Fault` in the body**, and the line
  `return json.QueryResponse || {}` handed that back as a result with nothing
  in it. So a read that was refused and a company with no products looked
  identical. `qbQuery` throws on a Fault now. No `QueryResponse` and no Fault
  is still an empty result, because that is a real answer - an invoice number
  nobody has used.
- **An empty item shelf was believed.** `itemShelf()` would come back with
  nothing and `writeOne` would hold every order in the batch against a SKU
  that was there all along - a merchant sent looking for a problem that does
  not exist, which is worse than no answer at all. A shelf with **no items on
  it is a read that failed**: even untouched books carry Services and Hours.
  It throws, `openBooks` fails, and the orders go back in the queue untouched
  with the reason on the pulse.
- **The shelf is a photograph.** It is read once at the start of a pass, so a
  SKU put on an item five minutes ago is not in it. Before holding an order,
  `itemFor()` reads the list once more (`freshShelf()`, memoised per pass) and
  tries the SKU against that. It is only ever reached on the failure path, so
  it costs one query where there would otherwise have been a wrong answer. And
  when that read cannot be made at all, the order is **failed, not held** -
  "QuickBooks would not answer" is not "your SKU is missing", and must not be
  written down as if it were.
- **Products back, no SKUs on any of them, is also a failed read.** Matching
  is on the SKU and nothing else, so that state holds every order and names
  SKUs that are sitting in the books. It throws instead, once, in words.

**And the one line that would have ended this in a minute.** How it runs now
says what the last read of QuickBooks actually contained:

> Last read at 15:21: QuickBooks handed back 30 products, 0 of them carrying a
> SKU.

`shelfSeen()` keeps it in memory and `/api/shopify/progress` carries it, so the
screen can show it without asking the database or QuickBooks again. Nothing on
that page could answer "does Fusion actually see my SKUs" until it was there.

**One held order, one reason per reason.** The message put every missing name
under the *first* reason's heading, so an order with one line missing a SKU in
Shopify and another whose SKU is not in the books read as
`no SKU in Shopify: A, B, SP-21-100 (Anti Acne Cleanser)` - naming a SKU under
the words "no SKU". Each reason gets its own clause now.

**And a failure always says something.** The log had rows reading only
`FAIL #9324023` with an empty message. Where QuickBooks refuses and gives no
reason, that is what gets written, with the status and the tid.

## One order is written once at a time

Shopify sends several webhooks for one order within seconds - created,
updated, paid, fulfilled - and every one of them calls `nudgeOrder`, while the
sweep may have picked the same order up a moment earlier. Nothing stopped them
running over each other, and the log showed it plainly:

```
03:44:26 AM  WAIT  #9324024   (three times, same second)
03:03:16 PM  OK    #9324031  written as invoice #9324031
03:03:17 PM  FAIL  #9324031
03:44:08 PM  OK    #9324032  written as invoice #9324032
03:44:08 PM  OK    #9324032  already in QuickBooks, left alone
```

Two passes both looked for an existing invoice, both found none, and both
posted one. `writeOne()` now holds an in-process lock on
`realm:order_gid` and **turns the second caller away** rather than queueing
it: whatever it was going to do, the one already inside is doing, and the
sweep comes round again regardless. It returns `'busy'`, which is counted and
written down as nothing, because it is not an event.

## What the database is allowed to keep

47 MB in a fortnight, on a plan with about 1 GB, with three different reasons
behind it. `housekeeping.js` is the answer to all three: it runs on every start
and once a day after, and `POST /api/storage/clean` (ADMIN_EMAILS) is the same
thing on demand, from Settings > Database.

- **Rows nobody can reach.** `removeAccount()` deleted the courier account row
  and left every order it had pulled behind it, `account_id` pointing at
  nothing - invisible on every screen and deletable from none. That is what
  happened when a PostEx account was attached to the wrong company and taken
  off again. `removeAccount()` now takes the orders, receipts and hook log with
  it in one transaction and says how many went; `orphans()` finds whatever the
  old behaviour left.
- **The courier's own JSON.** `courier_orders.raw` kept the whole answer - a
  couple of kilobytes an order for a field read once. Three days now
  (`COURIER_RAW_DAYS`).
- **Shopify.** The only thing worth keeping for ever is the small row that says
  an order became an invoice, because that is what stops it being invoiced
  twice. The line items are what the invoice is built from, so they stay while
  an order is `waiting` or `held` - however old - and for ten days after it is
  written, for undo (`SHOPIFY_LINES_DAYS`); then `lines` and `bill_to` go. The
  log keeps three weeks (`SHOPIFY_EVENT_DAYS`) and 800 lines, and an event's
  `detail` JSONB is now kept **only for something that went wrong** - the happy
  lines are the many, and the invoice itself is in QuickBooks.

Deleting rows in Postgres frees the room for re-use but does not give it back to
the disk, so a database that was 47 MB stays 47 MB and simply stops growing. The
nightly sweep does a plain `VACUUM (ANALYZE)`; **Clean up now** does `VACUUM
FULL`, which does give it back and locks each table for a moment - which is why
it is only ever done when somebody asks for it.

## Open items
- Replace the copied old files with the new design once the user describes it.
- Decide DigitalOcean settings: turn **Edge caching** and **Email obfuscation** Off (app shows
  live data).
- Check the Neon dashboard for the real storage limit.
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

## One Fusion, many client companies

Fusion is run by consultants: one company is one client. `/companies` is the
portal that stands over the lot of them and is the first screen whoever runs
Fusion sees after signing in (`/auth/in` sends there when the person is in
ADMIN_EMAILS, or holds more than one company). It lists each company with its
id, whether QuickBooks is joined, and how many people are in it; **Open** is
`/auth/switch`, which is what makes every later query belong to that company.

- **ADMIN_EMAILS holds every client at once** - the way an accounting firm's
  QuickBooks sign-in opens on its clients' books rather than inside one of them.
  `companiesFor()` returns every company for them and only what was given or
  made for everybody else. The demo's workspace (no owner, no books,
  `isDemoCompany()`) is in nobody's list but `demo:viewer`'s.
- **Only ADMIN_EMAILS starts a company from nothing** - `POST
  /api/portal/companies/new`, which is `createWorkspace()` with a name. A client
  gets theirs at sign-up instead and gets no second one from here.
- `POST /api/portal/companies/rename` renames one by id; `runsCompany()` decides.
- **Switch company** is in the profile menu for anybody holding more than one.

### Two screens for people, and the difference matters

| Screen | Whose | Scope |
|---|---|---|
| `/users` | the administrator of the company now open (super admin included) | **only** the people of that company. Being inside MR is being inside MR, so no company picker appears and `/api/admin/users` cuts its list and its company shelf to that one realm |
| `/people` | ADMIN_EMAILS alone (`requireBoss()`, and the page itself is refused to anybody else) | **every** account there is, with a company picker, because this is the screen above every company |

`/people` is the only place somebody is given a company they are not already in
(`POST /api/portal/people/access` - companies, role and rights in one answer,
because they are one decision), and the only place a user id is made for more than
one company at once (`POST /api/portal/people/new`): one company chosen sets
`home_realm` and is that desk for life, the way a client's staff id works; several
leaves `home_realm` NULL and gives them the company switcher, which is what a
consultant's own team member needs. `/people/password` and `/people/off` are the
same two jobs `/users` does, at portal level.

`/auth/status` carries **`admin`** (runs the company now open) and **`boss`**
(ADMIN_EMAILS - runs Fusion). The profile menu reads `boss` for the two portal
links, and `admin && connected` for Manage users: offered from the portal, where
no company is open, it would bounce straight back and look broken.

### Which company you are standing in

`FUSION.companyChip(host, {dark})` in `nav.js` puts the open company's name at the
right-hand end of every screen - nav.js's own top line on an inner page, and the
launcher's bar, which passes `dark: true`. With more than one company (or
ADMIN_EMAILS) it is a dropdown that switches between them; with one it is a plain
label; with none it hides itself. **Its classes are `fxchip`/`fxcobtn`/`fxcomenu`,
not `fxco`** - `fxco` was taken first by a company card on `/companies`, and the
collision centred every card on that page until it was renamed. `.ptools button`
dresses every button in that box as a 30px square, so the chip's and the avatar's
rules are written `.fxchip .fxcobtn` / `.fxme .fxmebtn` to outweigh it.

`isSettled()` lets ADMIN_EMAILS stand in any company without a `user_companies`
row - they are not given companies, they hold them all - and `whoIs()` forces
`allowed` true for them, because the row's flag is a decision about a user and
there is nobody above that address to make it. Without the second, switching
company was refused outright.

### Deleting a company, and the bin

**Nothing is destroyed when a company is deleted.** `POST
/api/portal/companies/delete` (ADMIN_EMAILS only, and the company's name typed
back) calls `binCompany()`, which only sets `companies.deleted_at`. The company
drops out of `listCompanies()`, `getCompany()` and `workspacesOwnedBy()` at once -
so it goes dark for everybody working in it, which is what deleting has to mean -
while every row it owns stays where it is. `POST /api/portal/companies/restore`
puts it back whole.

- **It is offered from Settings, inside the company itself** (`.fxdanger` in
  `settings.html`, behind a `<details>`), not from a button on the companies list
  where a slip of the mouse reaches it.
- **The bin lives on `/companies`** (`GET /api/portal/bin`), shut unless something
  is in it, each entry showing the days it has left.
- `BIN_DAYS` (90) is exported from `db.js` so the page, the route and the sweep
  cannot disagree. `emptyOldBin()` runs on startup and once a day after
  (`setInterval(...).unref()`), and is the only caller of `deleteCompany()`.
- `deleteCompany()` is the real one and is reached from nowhere else. It reads
  which tables carry `realm_id` from `information_schema` - the same reason
  `graduateWorkspace()` does, so a table added next month is not left holding rows
  nobody can reach - deletes the user ids whose `home_realm` is that company (they
  were made for it and cannot be moved), clears `user_companies`, and takes the
  `companies` row last, all in one transaction.
- `getBinnedCompany()` is the only reader that sees a binned row.
- Signing in with exactly one company opens it without asking; `/choose` is now
  only for somebody who holds nothing at all and is waiting to be let in.

**Nothing of one company is readable from another.** Every table that holds a
company's work carries `realm_id` - `courier_accounts`, `courier_orders`,
`courier_cprs`, `cpr_runs`, `upload_jobs`, `upload_logs`, `item_mappings`,
`app_settings`, `cache_blobs`, `product_changes`, `recat_*`, `replace_state`,
`void_runs`, `negative_items` - and `users.home_realm` ties a handed-out user id
to one company for life. A new table that holds a company's work must carry
`realm_id` too, and a new admin route must cut its list to the company being run
(see the three under "Who may open the app"). The two tables without one are
`app_keys` (the server's own push keypair) and `once_done` (migrations run once),
and neither holds anybody's work.

So each client's QuickBooks, courier portals and orders live only in that
client's company, and a change to a module or a report is deployed once and is
there for every company at the same moment.

## Demo link
`/demo` signs a visitor in as the shared read-only user `demo:viewer` at an empty
workspace called "Fusion Demo" (no sign-up needed). Every page opens, every POST is
refused (viewer role). `DEMO=off` in DigitalOcean switches it off. Terms and Privacy
(`/eula`, `/privacy`) are in the Fusion brand and give `support@availity.pk`.
