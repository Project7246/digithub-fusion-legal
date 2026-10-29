# Digithub Fusion - project notes for Claude

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

**Which company graduates is the one that was open when Connect was pressed**,
carried from `/auth/connect` in an `oauth_from` cookie - never "the one
workspace this person owns", which is what it used to be. The two questions
have the same answer right up until somebody runs more than one company, and
then they differ silently and catastrophically: standing in one client's
company and connecting another client's books swallowed the workspace nobody
was looking at, and its Shopify shop, orders, couriers and people all came up
under books they had nothing to do with. Nothing open (connecting from the
portal) means nothing to join: the realm gets a company of its own.

**One Shopify shop belongs to one set of books.** Both doors - the typed token
and the OAuth callback - refuse a domain already connected to another company
here (`shopElsewhere()`) and name that company. Connected twice, both companies
pull the same orders and both write them into their own QuickBooks.

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
  (the worker). **`{url}` cannot be typed into DigitalOcean**, which reads
  braces in a value as a variable of its own and refuses the line with
  `Unexpected "}" at 43` - an error that reads as Fusion rejecting the
  address. So an address ending in `.php` takes the query shape by itself,
  an address already ending in `?u=` is completed, and
  `COURIER_RELAY_PARAM` names the parameter anywhere else. The adapters' own base URLs never change, so nothing above
  `wire.js` knows it is happening.
  **The reach check walks the relay as well**, because the four steps it
  walks are the route Fusion does *not* take once a relay is set - so a
  working relay showed as a red `tcp` and sent somebody off to fix a key that
  was fine. A red `tcp` beside a green `relay` is the right answer here. It
  tells the relay's own four refusals apart from the courier's
  (`RELAY_KEY`, `RELAY_NOKEY`, `RELAY_HOST`, `RELAY_BLIND`), so "the two keys
  do not match" is never reported as "Trax cannot be reached". The relay's
  key is typed into the PHP file on the server and into DigitalOcean, and
  into git in neither.
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

#### A Trax account fills itself from its webhooks, and nothing else

Their first account came in with nothing behind it, and **Pull orders**
answered *"0 orders came back"* over a date range - true, useless, and it
reads as a broken key. Sonic has no call that takes a span of days.

Two things were then built to get a past in: upload the tracking numbers from
their portal, and ask the courier about our own Shopify order numbers. **Both
are gone.** The owner's objection to the first was that uploading a file every
month is not a system, and to the second that a day's orders are split between
several couriers, so asking one of them about all of them is mostly asking
about parcels that went to somebody else. Both objections were right, and a
screen nobody should use is worse than no screen.

What is left is the thing that needs nobody: **the four Subscriptions**. From
the day they are switched on, Trax sends every booking, status, charge and
payment by itself - which is what PostEx does, and all that was ever asked for.

And reading the Sonic document properly (*API Documentation-SONIC 2.0*, 22
endpoints) turned up the one call that matters for the past:

| Endpoint | What it gives |
|---|---|
| `GET /invoice?id=<id>&type=1\|2` | **every shipment in one payment**, with weight charges, fuel surcharge, GST and invoice amount. `type=2` is a payment id, which is what the payment webhook carries |
| `GET /shipment/track/order_id` | a parcel found by our own order number |
| `GET /payments?tracking_number[]=` | several parcels' payments in one call |

So "Trax cannot be asked for a list" is wrong as written: it cannot be asked
for one **by date**, but it can be asked for one **by payment** - the same
shape as a PostEx CPR. `traxlive.js` is `cprlive.js` written again for Sonic:

- **A payment webhook opens the whole payment.** `absorbPayment()` reads
  `/invoice`, settles every parcel in it with its charges and tax, writes the
  payment down as a `courier_cprs` row so the finance screens need not know
  which courier paid, and **looks up every parcel in it this app has never
  heard of**. A payment made this week pays for parcels booked long before
  Fusion saw the account, so the past arrives by itself, a batch at a time,
  without a screen or a file.

**What this still cannot answer**, and it is worth being plain about: a parcel
the courier never booked does not exist from their side, so "they lost it" and
"it was never handed over" look identical. The only record that would tell them
apart is our own - which orders went to which courier on which day. That record
is made where the day is split, and the load sheet is deliberately left for
later, so the question stays open until then.

#### And the other half of the past is behind their portal

The payment route above only ever reaches a parcel that was **delivered and
paid for**, which was never the hard half. The question actually asked was
*"kitny parcels book hoy, courier ny pick ni kiy, or kitny pick kiy likn
delivered ni ho"* - and a payment is made for none of those.

`traxportal.js` is the answer, and it stands beside `trax.js` the way
`postexportal.js` stands beside `postex.js`:

| | |
|---|---|
| `trax.js` | one API key, an `Authorization` header, and no call anywhere that takes a span of days |
| `traxportal.js` | the portal's own sign-in at `sonic.pk`, where a span of days is the whole point |

The portal's **Reports → Summary** screen is one DataTables feed:

```
GET /cod/reports/summary/list
    ?search_user=<shipper id>&search_date_from=…&search_date_to=…&start=&length=
```

Read off the portal while signed in (29 Oct 2026): on one account it answered
**57,753 shipments since 1 January 2025**, 500 to a call in about three
seconds. Every row carries `booking_date`, **`rider_picked_status_date` -
empty when nobody ever came for it**, the three delivery attempts,
`current_status` in Trax's own words, `return_reason`, `payment_status`,
`collection_amount`, `weight_charges`, and `order_id`, which is **our own
Shopify order number** as it went onto the booking.

- **The sign-in is a cookie, which is why this file does not use `call()`.**
  `wire.js` reads a body and throws the headers away. The portal sets
  `XSRF-TOKEN` and `traxlogistics_session`, answers a sign-in with a 302, and
  Laravel will not take the form without the `_token` printed on the page it
  was drawn on - so the login page is read first, every time, and the cookie
  jar is kept by hand.
- **The relay had to learn two things**, and both are in `tools/courier-relay.php`
  and `tools/courier-relay.js`: hand **`Set-Cookie`** back (every line - the
  default `header()` would keep only the last), and **stop following
  redirects**. A relay that followed the sign-in's 302 handed back a login page
  with no cookie on it, which reads as a wrong password. **The PHP file on
  Hostinger has to be uploaded again** for this.
- **A session that goes stale signs in again by itself.** A twenty-month import
  outlives a two-hour Laravel session, and "the portal sent us back to the
  login page" must never be written down as "Trax has no parcels in March".
- **It is the portal's front end, not a documented API.** If Trax change their
  screens these calls change with it. PostEx is in exactly the same position
  and has held.

**Where it is used**: `backfill.js` asks the adapter, not the courier's name -
`a.portal.lists` means a span of days can be had, and an account with
`portal_email` set takes that door instead of `fetchOrders`. The **Bring the
past in** button on `/couriers` is the screen, month by month, with Stop, and
it picks a running import back up if the page is opened again.

**The money is deliberately only half carried over.** The Summary report says
*whether* a parcel was paid for and never *which payment* paid it, so
`markPaid()` in `couriers.js` sets `settled` and touches nothing else - a
report that did not mention a parcel must not wipe the CPR number the payment
webhook wrote. And the per-parcel payment chase is **skipped entirely** after a
portal import: fifty thousand delivered parcels would be fifty thousand calls
through the relay, and `/invoice` answers the same question a whole batch at a
time.

**Still to do**: `/cod/finance/payments/list` is the portal's CPR list -
Payment ID, delivered and returned counts, charges, GST, WHT, Total Payable,
Reference No., Status, and the parcels under each - and nothing reads it yet.
That is what would make `/receipts` whole for Trax.

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

## Two tabs, and the line between them is parcels or money

Asked for in as many words: *"courier ke dashboard par do tab hon - ek tab
mein logistics ka hisab ho, kitne parcels aaye kitne gaye... payments ya
finance ka nahi. Dusre tab mein finance ka hisab ho... finance ka structure
hota hai usi base par banao."*

There were four - Overview, Orders, Money, Cities - and every one of them
carried both questions. The stage table had a **Worth** column, the day chart
put the day's takings in its tooltip, the city table ended in **Collected**
and **Charges**, and the Money tab counted parcels. So "where are my parcels"
and "what am I owed" were each half-answered four times over.

| tab | what is on it |
|---|---|
| **Parcels** | where every parcel got to, and nothing else. **No money anywhere on it** - not a column, not a tile, not a tooltip |
| **Finance** | what the parcels are worth, what has been paid, what is still receivable |

The split is enforced by absence, not by a label: there is no `full()` or
`money()` call left in anything that builds `T.parcels`. That is the test to
run before adding anything to that tab.

### The Finance tab opens with a statement

Because that is what was asked for, and because the money chain alone does
not answer "how many delivered parcels are still unpaid". It reads top down:

```
  Booked and handed to the courier        N parcels   Rs X
    Delivered - collected at the door     N parcels   Rs X
      paid out to you by the courier      N parcels   Rs X
      still owed to you                   N parcels   Rs X
    Returned - nothing to collect         N parcels   Rs X
    Still moving - not due yet            N parcels     -
    Lost or damaged - to claim for        N parcels   Rs X
```

Parcel counts belong on this tab because **money is counted per parcel**:
"how many delivered parcels are still unpaid" is a finance question. Where a
parcel physically is, is not.

Every line opens into its parcels through the handlers that were already
there (`data-group`, `data-due`), so nothing new had to be wired. The two
payment lines are all-time while the rest is the chosen dates, and the note
under the table says so rather than leaving it to be noticed.

The money chain is still underneath it, and still the arithmetic:
COD less charges is what the courier owes, less what it has paid is what is
still to receive.

### The same table twice, with different columns

**Each courier company** and **Accounts side by side** appear on both tabs,
and that is deliberate rather than lazy. On Parcels they carry parcels,
delivered, returned, moving, rate. On Finance they carry parcels, collected,
charges, to receive. One table trying to be both is what made the old
Overview unreadable. The city table split the same way: the parcel columns
stay under **Every city** on Parcels, and **By city** on Finance carries
worth, charges and net, biggest first.

### The arrow on a tile scrolls, it no longer switches tabs

With four tabs a tile's arrow carried you to the tab holding the full table.
With two, the tile and its table are on the same tab, so every one of those
buttons would have done nothing. `more()` emits `data-jump` now and scrolls
to the section - `cd-days`, `cd-status`, `cd-cities`, `cd-recent`,
`cd-picked`, `cd-notin`, `cd-receipts`.

A tab name saved by the old page (`overview`, `orders`, `payments`,
`cities`) is not one of the two, so it falls through to Parcels rather than
opening nothing. `/receipts` names the same two in its way-back strip.

## How a screen is written here

Three rules, all given as corrections, all about the same thing: a screen is
read by a manager in ten seconds, not studied.

- **No explaining underneath.** *"jo ap har cheez ni nichy detail likh rhy hoty
  ho... is trha page full lgta h jsy kisi ny koi thesis likha ho... asa ni krna
  bhai simple bna, ta k koi manager is ko dekhay us ka sara result smjh mn
  ajy."* So no paragraph under a table saying what the table means, and no
  glossary. A heading, the dates in the heading's right-hand corner, and the
  figures. If a column needs a sentence to be understood, the column is wrong
  or its name is.
- **One table a screen.** *"finance k tab ko itna complicated na bnao... us k
  sb tab b tu ban skhty hn."* Finance is six sub-tabs - Statement, Ageing, By
  carrier, CPRs, Not collected, Cities - and the pill bar at the top of the
  tab switches between them, remembered per browser. A long scroll holding
  seven tables is the thing to avoid, not the number of tables.
- **The words are the books', and the couriers'.** *"money owned to you ye tu
  yar kisi ko b smjh ni ana, payment receivable, ya is trha sy ho asan."* So:
  COD collected, Less: courier charges and GST, Gross receivable, Less: paid
  against CPR, Net receivable. Deductions in brackets, a rule above a subtotal
  and a double rule under the closing figure. **What a courier pays against is
  a CPR, not a "remittance"** - that is the word on their paperwork and the
  word she uses, and it was corrected once already.

Ageing (0-7, 8-14, 15-30, 31-60, over 60, and delivery date not given) comes
from `agePair()` in `dashdata.js` and ties to the net receivable exactly,
because a column of figures that does not add up is a column nobody trusts.

**Every figure opens into its parcels, and it must open into the right ones.**
`ordersBy()` ignored `due` and `late` for months, so clicking a money line
showed every parcel in the range rather than the handful the figure was made
of. The money filters are now `moneyWhere()` in `dashdata.js`, shared by the
drawer and the download; the statement's all-time figures open with the date
filter dropped (`params(extra, noDates)`), or the drawer would contradict the
number it was opened from.

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
side. Three lines under **Daily operations** are the other side, and they are
in the Logistics rail only: the same line in two rails is two places to look
for one page. That heading read **The day** until 29 Oct 2026, which looked
like a note somebody had left in rather than a part of the app.

| Page | What it is |
|---|---|
| `/load-sheet` | the day's orders split between the couriers, before anything is booked |
| `/delivery-reports` | what happened to them afterwards, per courier |
| `/service-areas` | where each courier will go at all |

### The front page answers, and the rail carries figures

Chosen on 29 Oct 2026 from three drawn-out options, and the two complaints
that produced it were plain: the rail was a list of names, and the Overview
was a grid of icons with two greyed-out "soon" tiles. Neither answered
anything.

- **`/logistics` opens with figures**: moving (and how many of them nobody has
  collected), delivered in seven days against what was booked, returns, and
  what is still to receive. Then each courier company in one table, and
  **Waiting on you** - a parcel never collected, money delivered a fortnight
  ago and still unpaid, an account that is not answering, a webhook gone
  quiet. The tiles are still there, at the foot, as the way into the pages.
- **The rail's lines carry their own figure.** An item in `nav.js` says
  `count:'moving'` and nothing more; `railCounts()` knows what each name is,
  read off one summary. A line with no figure yet shows **nothing**, never a
  nought - a nought is a statement about the parcels.
- **One read per tab.** `logisticsSummary()` in `dashdata.js` is four queries
  in one `Promise.all`, and `/api/logistics/summary` is the only caller. The
  front page passes its answer to `railCounts()`, which keeps it in
  `sessionStorage`; every other page in the section paints from that and asks
  again only after ten minutes. Every page draws this rail, so a read on each
  page open would be a database kept awake by somebody walking around the app.
- **Nothing here works a figure out its own way.** "Received" is `GOT_SQL`,
  the same sentence the statement and the ageing use, so the front page and
  the courier dashboard cannot disagree about what is owed.

**Tracking and Pickups are off this rail** (asked for in those words).
`/courier-dash` is still in the Operations rail and `/pickups` is still
reached from the load sheet. What this rail grows instead is **Rates**.

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
3. products match on **the SKU and nothing else**. Nothing is renamed and no
   SKU is written onto an item that exists; a product new in Shopify becomes a
   request you approve, and nothing is created until you press Sync now
4. delivery is a line on **every** order, free ones at 0; the discount goes
   in the discount box, in rupees
5. cancelled and void orders are left out

## Every card on that page opens

"6 left out" sat on a card with nothing behind it - no tab, no list, and
nothing happened when it was clicked. A figure nobody can open is a figure
nobody believes, and that one is about orders that will **never** be invoiced
unless somebody changes their mind about them. Every card is a door now, and
**Left out** is a tab of its own: the order, the day, what it was worth and
why it was set aside - cancelled in Shopify, or nothing left on it to bill.

**And the two numbers on the screen now agree.** The card said 570 and the
tab said 586, because one counted **orders in QuickBooks** (`state = 'done'`)
and the other counted **log lines** - an order written and then found again
later writes two. Two numbers for one thing, disagreeing, on one screen, is
how a page loses somebody's trust. Both count orders now, and the tab says in
its own words that the list below is every line written about them.

## The invoice number is Shopify's name, character for character

It used to be built: strip the order name to its digits, then put the
`prefix` setting back on the front. With the prefix set to `#` that came out
right for a shop whose orders are called `#9323516`, and wrong for every shop
whose numbers carry letters - `PC-1001` became `1001` and then `#1001`.

`docNumberOf()` in `shopify.js` is the whole rule now, and it is two lines:

| Shopify says | QuickBooks is told |
|---|---|
| `1001` | `1001` |
| `#8766878` | `#8766878` |
| `wt65689` | `wt65689` |

Nothing added, nothing taken off, nothing tidied. The point of the number is
that one search finds the same thing on both sides, and the only way to be
sure of that is to change nothing.

**The `prefix` setting is gone, not defaulted empty.** Left in, it would have
put a `#` in front of a shop that numbers plainly at 1001, for no reason
anybody asked for - and a box that can put a character in front of an invoice
number is a box that will one day be filled in. It is off the Connector
screen, off the by-hand page, out of `DEFAULTS` and out of `toInvoice`.

## Needs you is pending until she says it is not

Asked for in as many words: *"jo invoices Needs you mein pending hain, woh
pending us time tak rahein jab tak main sort out na kar loon - jaise ke SKU
match karna, ya jo bhi masla ho."*

So an order in state `waiting` or `held` **keeps everything, for ever,
however old it is**. That is the rule, not a side effect of the retention
days: a held order is a question waiting on a person - this SKU is on no
item, turn the discount box on - and the order's **lines are the question**.
Throw them away and Needs you loses the thing it is asking about.

`trimShopifyLines` only ever touches `state IN ('done', 'off')` - in
QuickBooks, or set aside on purpose - and nothing may be added to that list
that is not finished with. Nothing else expires a held order either: there is
no give-up after N tries, `saveOrder` never writes `state`, and the only
things that free a held order are a person pressing **Try all of them again
now** or saving the mapping that answers it (`releaseHeld` after
`POST /api/shopify/mappings`). If it is still not answered it is held again.

### Pressing Sync emptied Needs you

`POST /api/shopify/sync` is "read these days out of Shopify and run a pass
now". It called **`wakeAll`**, which releases every held order and wipes its
`held_why` - so one press of Sync emptied the whole of Needs you. The orders
went to the back of a five-hundred-order queue and came back held hours
later, once the sweep reached them again. Nothing was lost and nothing said
why; the list that is the point of that page simply went blank.

There are two different jobs and now two functions:

| | what it touches | who calls it |
|---|---|---|
| `wakeAll` | **held and waiting** - clears `held_why` too | the **Try all of them again now** button, and nothing else. A person saying "I have fixed it, try everything" |
| `wakeWaiting` | **waiting only** - clears `next_try` and `tries` | anything where waking the queue is a side effect, `/api/shopify/sync` being the one that caught us out |

A held order is not waiting on time, so time passing is no reason to touch
it. **Waking the queue is not an answer to a question.** Anything new that
wants to get the queue moving calls `wakeWaiting`.

### An order with no lines is read back from Shopify, not filed away

The one way a pending order could have gone quiet, and it was real.
Housekeeping clears the lines of an order that is **in the books**; `unsync`
- **Put it back**, after its invoice was deleted in QuickBooks - then puts
that same order back in the queue as `waiting`. The row is intact and the
lines are gone, so `writeOneNow` found nothing to bill and set it **off** as
*"nothing to bill on it"*: an invoice deleted on purpose so it could be
written again, moved to the one list that says nobody need look at it.

`relines()` reads the order back from Shopify before anything is decided, and
the two outcomes are told apart - which is the whole point of it:

| | |
|---|---|
| Shopify answered, still no lines | set aside, and the reason says we asked Shopify |
| could not look at all | **failed** - back in the queue to try again |

"We could not look" is not "there is nothing on it", and must never be
written down as if it were.

## Ten days while the system settles

`SHOPIFY_LINES_DAYS` and `SHOPIFY_EVENT_DAYS` are **10**, asked for on
23 Oct 2026: *"ek din wala data abhi filhaal 10 din ki range par le jayen jab
tak system theek na ban jaye."*

The one-day argument below is still right about a **finished** order, and it
is still the destination. It is only right once the writing can be trusted,
and until then:

- **Check the invoices** can look back over a fortnight's work rather than
  yesterday's, because it reads the lines kept here and nothing else.
- **Put it back** can write an order again ten days after its invoice was
  deleted.
- *"Why was this one held on Tuesday"* is a question that gets asked on
  Friday, and the log has to still have the answer.

Both are dials, not decisions - the env vars move them without a deploy, and
they come back down to 1 when the owner says the system is right. The log
page says the number out loud, so it is not a surprise.

## One day, and the row that must not go

The owner's argument, and it is right: this connector exists to move an order
from Shopify into QuickBooks, and once it is there **both copies are
somewhere better than here** - the invoice is in the books, the order is
still in Shopify, and that is where anybody would go to look at it. A second
copy of the lines sitting here for ten days is a copy nobody reads.

That is where both land once the connector is trusted. For now they are
10 - see above.

**What does not go is the order's own row.** It is what stops an order being
invoiced twice. Shopify goes on sending webhooks about an order for weeks -
updated, paid, fulfilled - and each one asks "has this been written?". That
row is the answer and the only copy of it: **Shopify does not know our
invoice number, and QuickBooks does not know Shopify's order id.** Nothing
else holds both.

Without it the connector would have to ask QuickBooks by invoice number on
every webhook - which works right up until the number's shape changes, and
then writes a second invoice for an order already in the books. A couple of
hundred bytes an order against a couple of kilobytes of lines: the row is
three per cent of the size and all of the safety.

The one thing given up is reach: **Check the invoices** can only check an
order whose Shopify lines are still here, so from now on that is the last
day's worth. It says so, and names what it could not check.

## A log is for watching, not for keeping

`SHOPIFY_EVENT_DAYS` is **1**. It was 21.

The log is watched while it happens and read the morning after; nobody opens
it to look at the 14th of last month. The thing that actually has to last is
on the order row - `qb_doc_number`, `synced_at` - and that is never trimmed.
Three weeks of five hundred orders a day was most of what this database held,
for no reading anybody does. The page says the day out loud, so it is not a
surprise when yesterday is not there.

## Where "Check the invoices" reads from

Worth being exact about, because the two halves come from different places:

| | from |
|---|---|
| what is **actually** on the invoice line | **QuickBooks**, read live, not from anything kept here |
| what it **should** have been | the order's Shopify lines in Fusion's table, against the QuickBooks product list as it is today |

So an order whose Shopify lines have since been cleared (`SHOPIFY_LINES_DAYS`,
10 days after it is written) **cannot be checked**. It is counted and named
separately rather than passed as if it were fine - a check that quietly skips
what it cannot see is worse than no check.

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

## A new product is a question, and she is the only one who answers it

Asked for on 23 Oct 2026, and it is the last piece of the connector: *"Shopify
mein naya product bana hai aur uske variant bhi bana diye hain, ab ye product
QB mein sync karna hai... phir Sync now par click karte hain, wo product QB
mein add ho jaye. Matlab ye hai jis ko main allow kar gayi wohi product QB
mein enter hota jayega."*

So there are now **two doors into the product list, and only one of them
opens**. The distinction is the whole of the safety:

| | |
|---|---|
| the writer | **makes nothing, ever.** `itemFor()` matches on the SKU and nothing else. A SKU on no item holds its order and names it. No sweep, no webhook and no order creates a product or writes a SKU onto one |
| **New products** | a person presses Sync now on one named row, having seen exactly what will be typed. That row, and nothing else |

That is what keeps the SP-21/SP-21-50 disaster shut while still answering what
she asked for. The dangerous thing was never *creating* an item - it was
creating one and then **silently using a different item when QuickBooks said
the name was taken**. So a request whose name is already in QuickBooks is
**refused and named**, with the other item's SKU printed, and she renames it
or says no.

### The row has two sides

`shopify_new_items` (realm-scoped, like everything else) keeps both:

- **`shop_*`** - what Shopify says. Refreshed every time Shopify calls, so a
  price corrected five minutes later is the price on the card.
- **`qb_*`** - what will be typed into QuickBooks. Filled in from the Shopify
  side the first time, and after that it is hers. **A Shopify update never
  writes over her edit**, because the edit is the version she is about to
  approve.

`state` is `new` (waiting on her) / `done` (in QuickBooks, or already was) /
`off` (she said no), and **only a person moves it**. Shopify saving the product
again does not re-open a decision.

### One tab, called Products

**New products** and **Products made** were two tabs about one thing, and the
owner said so the first time she saw them. They are one tab now: the cards
waiting on her, and underneath, **Added to QuickBooks**. The headline card is
**Products waiting**.

### `books.items`, not `books.ids`

The Products tab said **Could not read the list: Cannot read properties of
undefined** over a tab whose own counter said **36**. `openBooks()` returns the
name-to-id map as `items` (`shelf.ids` goes in under that name) and every other
reader in `shopifysync.js` says `items`; two new lines said `books.ids`, which
is `undefined`, so the read threw on the first row that had a name.

The count was right because it comes from `tally()`, a different query. **One
number on the screen being right is what made a broken list look like an empty
one** - and an empty list, on this tab, reads as "Shopify has told us nothing",
which was the opposite of true.

The loop in `reviewNewItems` is wrapped per row now as well. One row that
cannot be worked out shows as itself, with its reason, rather than taking the
other thirty-five with it.

### An `item` event means a product was created, and nothing else

The first product she made went like this: Shopify called, the log wrote
`ITEM  Test order by Rani  new on Shopify at 2000`, that line appeared under
**Products made**, she opened QuickBooks, and there was no such product. She
was right, and the screen was lying.

`nudgeProduct` was writing kind `item` for a product merely **noticed** in
Shopify, and `item` is the kind the made-list is built from. So a notice read
as a creation.

The first fix dropped the line entirely, and that was wrong too: the owner
wanted it - *"upar log mein us waqt bilkul sahi aaya tha... Shopify mein new
product hai lekin QB mein nahi bana, aisa hona chahiye tha, uske liye meri
permission chahiye."* A new product arriving **is** news, and the point of the
line is that it is waiting on her.

So it is **kind `newprod`**, which shows in the live log as `NEW` and is never
in the made-list, and the sentence says in words that nothing has been created:
*"new in Shopify at 2000, cost 1200 - nothing made in QuickBooks, it is waiting
for you on Products"*. `item` now means one thing only: a product was created
in QuickBooks, by her, on purpose.

The one historical line of that kind is still there, and **Clear this list**
takes it off; it changes nothing in QuickBooks either way, which the tab says.

### Look in Shopify, for everything the webhook never mentioned

The other half of the same evening: the product was saved **before this screen
existed**, so the webhook that announced it had nowhere to put it, and
pressing **Read again** found nothing. A webhook only ever covers what happens
next, and a shop connected this morning has years of products behind it.

`pullProducts()` reads the shop's own product list and offers every variant,
behind **Look in Shopify**. Nothing is written to Shopify and nothing to
QuickBooks; `reviewNewItems` takes out whatever is already in the books on the
next read, so pressing it on a shop with two thousand products does not
produce two thousand questions.

**Twenty products a page, forty variants each, and both numbers matter.**
Shopify prices a GraphQL query before running it and refuses one over 1000
points, charging a nested connection at the parent's `first` times its own -
so `products(first:100)` with `variants(first:100)` is ten thousand points and
would have been refused every single time. 20 + 20x40 is 820. A page that is
refused anyway breaks the loop and hands back the count so far with the reason
beside it: five hundred products read and the sixth page refused is five
hundred products on the list, not nothing.

### The webhook offers, it does not enter

`nudgeProduct` already ran on `products/create` and `products/update`. It now
calls `offerNewItem` for a variant it has never seen before - which includes a
variant added to a product that already existed, because that is just as new.
Nothing reaches QuickBooks and nothing is written in the log; all it does is
put a row on a list, within seconds of the product being saved. That is the
"foran webhook ke through show ho jaye" half, and it is as immediate as an
order. **Look in Shopify** is the other way in, for everything that happened
before the webhook could.

**The flood this would otherwise cause is settled by itself.** The first
webhook after a shop is connected offers every variant, and a shop has years of
products. `reviewNewItems()` reads QuickBooks once when the tab is opened and
marks `done` every row whose SKU is already on an item there, naming the item it
matched. What is left on the list is what is actually new. Saying no to two
hundred products by hand was not an acceptable first experience.

### Both descriptions, the same words

Asked for: *"sales aur purchase description ek jaise hi"*. QuickBooks keeps two
- `Description` shows on an invoice, `PurchaseDesc` shows on a bill - and
`createItem` now writes the same text into both. A product with the sales one
filled in and the purchase one empty reads as a blank line on a purchase order.

And *"sales aur cost of sale bhi same"*: `IncomeAccountRef` and
`ExpenseAccountRef` are the accounts every other product in those books already
uses, worked out by `standingAccounts()` from the company's own chart rather
than demanded. `ExpenseAccountRef` is now set for **every** kind, not only
Inventory. They are overridable under **How it runs**, and the card prints which
ones it will use before anything is pressed.

### Quantity off wins, and the type bends to it

Two instructions that cannot both be obeyed: *"type Inventory hi rahegi jo bhi
Shopify mein select hoti"* and *"quantity aur date par tick na laga ho"*.

**QuickBooks has no Inventory item that it does not count.** Type `Inventory`
requires `AssetAccountRef`, `InvStartDate`, `TrackQtyOnHand` and `QtyOnHand`;
there is no way to send one without an opening quantity and a date.

So the tick wins, because the tick is the one she said she wants to decide
(*"ye hamari marzi hai ke wohi add karein ya nahi"*), and `kindFor()` bends the
type:

| tick | goes in as |
|---|---|
| off (the default) | **Non-inventory** - same name, same descriptions, same price, same accounts. QuickBooks simply does not count units |
| on | **Inventory**, with the quantity and the as-of date from the card |

The card says which it will be **before** she presses anything, rather than
letting QuickBooks refuse it: "ValidationFault 2030" is not something anybody
should have to read. The type still starts from Shopify - a variant Shopify
tracks arrives as Inventory, one it does not as Non-inventory - which is why
`ONE_PRODUCT` now reads `inventoryItem { tracked }`.

### The as-of date, and a date that is not a moment

QuickBooks refused the first Inventory product with *"Specify a date between
1/1/1900 and 12/31/2100"* over a card showing **11/11/2025**, which is plainly
a date between those two.

`qb_start` was a **DATE** column, and a DATE is the wrong type for it. What
that box holds is a calendar date somebody typed on a form - the 11th of
November, which is the 11th of November everywhere. Postgres hands a DATE back
to node as a **Date object at local midnight**, and from there it went wrong
twice over:

| | |
|---|---|
| into QuickBooks | `String(d).slice(0, 10)` is **`"Tue Nov 11"`**. QuickBooks answered exactly what it should have |
| out to the browser | `JSON.stringify` gives `"2025-11-10T19:00:00.000Z"` in Pakistan, so the card redrew **a day earlier** every time it was read back |

This is the same lesson `day()` in `statuses.js` already carries, taught by the
couriers: **a date is not a moment.** The column is **TEXT** now (migrated in
`initShopify` by `data_type`, so it runs once), and it holds the characters
that were typed. Nothing converts it on the way in or on the way out.

- **`dayText(v)`** is the only gate: ten characters matching `YYYY-MM-DD`, with
  the year inside 1900-2100, or `null`. Not sliced, not parsed, not guessed.
  A year QuickBooks would refuse is caught here with a reason on the card
  rather than there with a validation fault.
- **`todayText()`** replaces `new Date().toISOString().slice(0, 10)`, which is
  **yesterday for five hours every night in Pakistan**. Yesterday is not a
  thing to put on books.
- `createItem` sends `InvStartDate` only when it matches the shape, and
  otherwise sends nothing and lets QuickBooks use its own day.

### An item with no SKU is refused

Matching is the SKU and nothing else, so an item made without one could never
be put on an invoice. Rather than make something useless, the request is
refused in those words - and the SKU is editable on the card, so she can type
it there instead of going back to Shopify.

### Adding the product is the whole of the fix

`makeNewItems` ends with `releaseHeld`. Every order held because that SKU was
on no item goes straight back in the queue, so **"add the product" is the only
thing that has to be done** - nothing on Needs you has to be pressed
afterwards. The Needs you tab says so, and points at the tab.

### Where it lives, and what it costs

`GET /api/shopify/new-items` reads QuickBooks once per tab open (the same
pattern `stuck-items` already uses) - it is a tab somebody opens, not a poll.
Nothing ticks itself: the tick boxes start **empty**, so "Sync all ticked"
cannot add anything by a careless click. `POST .../make` is the one door, and
it takes named ids.

Housekeeping keeps a row still waiting **for ever** - it is a question on a
screen, the same rule held orders get - and clears an answered one after thirty
days (`trimNewItems`).

## Fusion never creates a product by itself

Said by the owner, in as many words: **whatever is in QuickBooks stays as it
is**. Every product is there and every SKU is on it. Match on the SKU, put the
line on the invoice, change nothing - the same deal the file upload has always
had.

So **nothing on the writing path** makes an item, renames one, or writes a SKU
onto one. The `makeItems` setting is gone and its tick is off the How it runs
tab. `itemsPossible()` answers `can: false` for anything automatic and
`byHand: true` for the one door above, and says which is which.

`setItemSku` stays unimported here: putting a SKU onto an item that already
exists is still never done. `createItem` is imported again, and is reached from
exactly one place - `makeNewItems`, behind a button on a named row. A SKU that matches nothing stops that one order, names
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

## HR: the process they already run, moved

Asked for by **Sir Saim** on 28 Oct 2026, with the company's own September
files in hand - the biometric log, the salary working with its formulas, the
ledger, the management report, the slips and a time sheet. The rule given with
them is the one to keep: *"sara kam hu ga standard per but hamri jo reports hy
wo hum is format mein kry gy - system chahy jo bhe hu lkn calculation or
presentation hum ny isi trha rakhni hy"*. **The system is new; the arithmetic
and the paperwork are theirs, to the column.**

The process, in the order it is actually done, and the screen that is now each
step:

| Step | Where |
|---|---|
| keep the staff records, hand out an employee id | `/employees` |
| download the biometric report and read it in | `/attendance` → Bring the report in |
| check the leave emails, approve or refuse | `/attendance` → Leave |
| work the figures out under the report | `/payroll` → Working |
| the bonuses and fines the management decides | `/payroll` → Bonuses and fines |
| the combined report the management is sent | `/payroll` → Report |
| a slip each, and a time sheet each | `/payroll` → Slips, Time sheets |
| the ledger, and the final entry in QuickBooks | `/payroll` → Ledger, To QuickBooks |
| what an employee sees of their own | `/my-hr` |

| File | What it is |
|---|---|
| `hr.js` | the people, their days, their leave, the policy, and reading the biometric report |
| `hrrules.js` | **one rule per entry** - its name, what it is, how it is worked out, and the same sum with numbers in it. The How it runs screen is drawn from this list |
| `hrpay.js` | the month: the pools, the ledger, the report, the slips, the time sheets, the journal |
| `hrimport.js` | reading their own staff master, joining form and ledger in |
| `tools/hr-check.mjs` | `npm run check:hr` - every formula against their own September figures |
| `tools/hr-files-check.mjs` | `npm run check:hr-files -- <folder>` - the importers over the real files |

Nothing in either file touches a finance or a courier table. The one place the
two modules meet is the journal entry at the end, written through
`postJournalEntry()` in `qb.js` like every other call to Intuit - so a change
here cannot change an invoice, which is the standing rule
([[modules-independent-one-erp]] in the notes, and the section at the top of
this file).

### The ledger is the only copy of the month's money

`hr_pay_lines` is one row per employee per head, which is the shape their own
workbook ends in - and the report, the slips and the QuickBooks entry are each
a different **reading** of those rows, never a second total of their own. That
is how two numbers for one thing are kept from disagreeing on one screen.

A line's `source` says who put it there, and it is the whole of the safety:

- **`auto`** is what Fusion worked out. Working the month out again rewrites it.
- **`hand`** is a figure somebody typed. **Working the month out again leaves it
  exactly as it is** - the performance bonus is a management decision and the
  travelling allowance is agreed with the person, and neither is something a
  formula should be guessing at. The working table shows a typed figure in teal.

Beside it: `hr_standing` is an amount set once on a person and written into
every month after (the logistics floor's food allowance, twenty people, every
month), prorated by the days they were actually here where it is set to be;
`hr_month_facts` holds what the month knows that the person's record does not -
the days they were on the payroll, an extra day somebody was granted, a basic
that changed mid-month.

### One rule, one named function, one worked example

Asked for once the first version was working, and it is the instruction that
shapes the whole module: *"system ko itna complex na bnao, simple bnao, taky koi
layman bhe dkh kr smjh jay ky ye function kis chez ka hy"* - and with it the
thing that matters more: *"formula sheet calculation mein mistake hu skti hy q ky
man made hy... ab tm isko restructure kr rhy hu to achy sy kro, jo
recommendation hy wasy kro, standard ky mutabiq"*.

So the sheet is **where the rules came from, not what they are**. `hrrules.js`
is one list, `RULES`, and each entry is one rule carrying:

| | |
|---|---|
| `head` | the name on the slip |
| `what` | what it is, in a sentence a manager reads once |
| `how` | how it is worked out, in words - no cell references |
| `note` | the one thing about it that is easy to get wrong, where there is one |
| `figure(sheet)` | the amount |
| `sum(sheet)` | **the same sum with the numbers in it** |
| `cell` | the cell on their sheet it came from, for checking against |

Two things follow from that shape, and both were the point:

- **The How it runs screen is drawn from the list.** `/api/hr/policy` returns
  `explainAll(exampleSheet(policy))` and the page renders it card by card. The
  screen cannot say one thing while the code does another, because there is only
  one place either of them is written.
- **Every figure on a person's panel shows its own arithmetic.** The working row
  carries `why` - each rule's sum in that person's numbers - so *"why is my
  absent fine 2,750"* is answered on the screen rather than in somebody's head.
  A payroll is argued with every month, and a figure nobody can see behind is a
  figure nobody will accept.

`worksheet()` is what a rule is handed, and every name in it is the plain word
for the thing: `dayRate`, `lateMinutes`, `absentDays`, `overtimePaid`. A rule
reads as a sentence - `sheet.dayRate * sheet.workDays` - with nothing a reader
has to look up. `AUTO_HEADS` is taken from `RULES`, never written out twice.

**The three late-fine rules are named in words, not in code words.** `days`,
`minutes` and `minutes2x` meant nothing to anybody reading them for the first
time, so `LATE_RULES` carries "A whole day, after every third late arrival",
"By the minute" and "By the minute, doubled past the first hour", and that is
what the policy dropdown offers. All three are real policy rather than an
accident: the office loses a whole day after the third late arrival, while a
packer twenty minutes late is twenty minutes of parcels nobody packed.

### Where the sheet is wrong, and why it was wrong

Two accidents, both the same accident, and both now fixed rather than copied.

**A rule gives a positive amount and the head's kind decides the sign**, in one
place. Their sheet writes a minus inside some of its fine formulas and not
others (`AA991` has one, `AD991` gets it from dividing by -30), which is how a
fine ends up taken off on one row and added on the next. There is nowhere left
for that to happen: `figureAll()` returns magnitudes and `hrpay.js` signs them
once.

**In the ledger, the credit side decides the sign - not the head.** This is the
bigger one. Their report reads every salary column as `SUMIF` on the *debit
head* and ignores the credit side completely, so:

| A row saying | Their report does | What it means |
|---|---|---|
| `Parcel Fine | Payable | 500` | adds 500 to the fine | a fine being **given back** |
| `Advance | Receivable | 5,000` | makes the advance 5,000 **bigger** | an advance being **recovered** |

Sixty-five rows in their ledger are of the first kind. `sideOf()` in
`hrimport.js` is the whole of the fix, and it is three lines because a ledger
only has three sides:

```
  Payable     the company owes it to them        adds
  Receivable  they owe it to the company         takes off
  Paid        it was handed over in the month    adds, and counts as paid
```

One rule, no exceptions per head - which is also why nothing downstream has to
know which heads are fines. On their September data this moves the month's net
by 1,533 against their printed report, and **every one of the five people the
check ties to that report still ties exactly**: the figures agree where the
sheet was right and are corrected where it was not. That is the whole intent of
*"karna ab Fusion sy hy"* - the same work, done properly.

`npm run check:hr` now exercises each rule against a figure off their own
September working sheet - the office's overtime, the floor's doubled minutes,
three late days costing one, two absences, a half day - plus the three things
that are easy to get wrong by hand: one absence takes the whole attendance
bonus, a part month earns none of it, and no rule anywhere returns a negative.

### The formulas, and the cells they came from

Every one came off their Salary Working sheet, and the cell is named beside it
so the two can be checked against each other. `npm run check:hr` ties the three
pools to the rupee against their September figures (11,181 / 7,959 / 9,373.63).
The policy holds every number, and `/payroll` → **How it runs** is generated
from the rules themselves - see the section above. A rule that cannot be put on
that page in one sentence is a special case, not a rule.

| Head | The rule | Their cell |
|---|---|---|
| Basic Salary | `(basic / 30) * days on the payroll` | `P991` |
| Overtime | `ROUNDUP((basic/30)/480 * OT minutes)`, and **only** for the departments named | `Q991` |
| Attendance Bonus | one day's basic, but **nought** if there was any absence, any leave, or a part month | `R991` |
| Parcel / Order Bonus | the pool, per person, for whoever is ticked | `T991 = $W$1059 / $I$1062` |
| Late Fine | three rules, per department - see below | `AA991` |
| Parcel Fine | half the month's fines, shared | `AB991 = -$N$1062` |
| Absent Fine | `-ROUNDUP(basic/30 * absences)` | `AC991` |
| Half Day Fine | half a day's basic for each half day nobody approved | `AD991` |

- **The month is the 26th to the 25th**, written on their own sheet, and
  `cycleOf()` is the only thing that knows it. Every per-day rate divides by
  **30** whatever the calendar says - which is what makes two months
  comparable, and why a 31-day cycle is written as 30 working days.
- **Late begins after the grace, not at the duty time**: 09:10, not 09:00. A
  day only *counts* as late over `lateCountOver` minutes, and every third late
  day costs a whole day of basic.
- **Overtime is the half hour after the duty ends and not a minute more** -
  17:15 to 17:45, capped there, which is why `MIN(K, TIME(17,45,0))` is in
  their formula and `Math.min(outMin, otTo)` is in ours.
- **The late fine is three different rules and they are the departments' own.**
  `days` cuts whole days after every third late day; `minutes` charges the
  minutes at the minute rate; `minutes2x` charges the first hour once and
  everything after it twice, which is the logistics floor's rule. Per
  department in the policy, overridable per person, because one person on that
  floor is on the plain minute rate.
- **The report rolls the half-day fine into the absent fine**, because that is
  how their own report prints it, and the two have to tie. The working sheet
  keeps them apart, because that is where she checks them.
- **The advance and the credit purchase are stated and not deducted.** What is
  deducted is the loan deduction and the employee adjustment that recover them.
  One of their September slips shows an advance of fifty thousand against a ten
  thousand deduction, and the total deduction is the ten.
- **The food allowance is earned and then subtracted again**, because it is
  handed over in cash as the month goes. `Paid during the month` is that plus
  any salary taken in advance, and `payable = net − paid` - which is how
  a logistics slip with a food allowance on it nets down by exactly that much.

### An approved day costs nothing and an absence costs a day

That sentence is the whole module. It is why leave is a table of its own rather
than a tick on a day, and why only three people may answer one.

- `decideLeave()` writes the answer onto the days it covers at once, with the
  source set to **`hand`** - so **the next biometric import leaves those days
  alone**. The report says Absent, the email says it was approved, and the
  person's answer wins. `applyApprovedLeave()` puts every approval back on top
  after an import, because an approval made last week has to survive this
  week's file.
- **Who may approve is `policy.approvers`**, named logins, not names in a
  source file - a person leaves and a constant does not. Fusion's own admin
  always may; with nobody named yet, the company's administrator does.
- An employee asking on `/my-hr` puts a notice on each approver's bell and an
  email in their inbox, because a leave nobody has seen is an absence by Friday.

### What the biometric report says, and what it does not

Their export keeps its own words **in the clock-in column**: `Public holiday`,
`WFH`, `Leave`, `Absent` sit exactly where `09:02` otherwise would, and
`A. Half Day` against a plain `Half Day` in the Real time column is the
difference between a half day somebody approved and one nobody did. So
`statusFromWords()` reads the words first and the clock only when there is one.

- **A day with neither is `pending` - "Verification pending", their own term.**
  It is *not* an absence until somebody says it is, and the attendance screen
  counts those separately under **Not accounted for** so they get looked at.
- **A day the machine never printed has no row**, because the export leaves
  Sundays out entirely and inventing a weekend that might have been a working
  day is worse than saying nothing. The time sheet marks a missing weekday
  `N/A` rather than guessing.
- **The sheet is matched on the `No.` column** - which is the employee id,
  15101 and up - then the biometric `AC-No.`, then the name. Anybody the sheet
  names who is not on the staff list is **named back on the screen with their
  day count**, and their days are left out rather than filed under somebody.
- **Nothing of the file is kept.** The rows are read, the days are written, the
  buffer goes - the same rule the invoice uploads have always had.

**And the dates are read as numbers, not as moments.** The import asks SheetJS
for `cellDates: false` on purpose, so a date cell arrives as the spreadsheet's
own serial and `fromSerial()` turns it into ten characters by arithmetic. A
`Date` built here can be the 25th of August on a server in the wrong place.
This is the lesson `day()` in `statuses.js` already carries and `qb_start`
learned the hard way: **a date is not a moment.** A whole number in a *clock*
column is a date in the wrong column and is read as nothing at all, never as
midnight.

### An employee id is never a returned one

`nextEmpCode()` is the highest that has ever existed plus one, across everybody
including the people who have left - "her new employee ki id new generate hu".
And **nothing is ever deleted**: hiring and firing are the same route, somebody
who has left keeps every day they worked and every slip they were paid, because
the month they left in still has to be readable next year.

The joining form is the one the company already uses, and **the things that
were asked not to be optional are not**: home address, guardian's name,
relation, phone and ID card. `MUST_FILL` is that list, and a form is not
verified while one of them is empty.

### The first sign-in is a verification, not a blank form

*"abhi bhe jab new login banay gy hum to us per bhe phli bar login per her
employee ko apna form verify krna hu ga - already fill hu ga, koi changes hu ge
to wo kry ga."* So `/my-hr` opens with everything known already in the boxes and
asks the person to correct what is wrong and press **These are right**.

What an employee may change about themselves is `SELF_FIELDS`, and their pay,
their grade and their department are deliberately not on it: a form somebody
fills in about themselves is their own details, not their terms.

The login is the company's ordinary user id - HR gets no second kind of account
- made from the People screen with `role: 'custom'` and **no rights at all**. A
rail line carries a `need` and `/my-hr` carries none, so what that person sees
is their own record, time sheet, leave and slips, and nothing else until
somebody ticks more on `/users`. That is what was asked for.

### Staff who work away type their own day

`hr_employees.virtual`, ticked on their record - Saim decides who works that way
- and the boxes appear on their own screen. The day is written with
`source = 'self'`, so it is never mistaken for a reading off the machine, and
the attendance screen has a tab showing every day they typed. A day in the
future is refused.

### The month is approved, and only then posted

`hr_pay_runs` is `open` → `approved` → `posted`, and the three who approve are
the same `policy.approvers`. Nothing reaches QuickBooks until the month is
approved, a posted month cannot be worked out again or edited, and the journal
id on the run is the only record of it - which is what stops a second entry.

The entry is **one journal for the month**, not forty-four: debit each salary
head, credit each deduction's account, credit salary payable with what is still
owed. It balances by construction because the deductions are kept negative, and
it is refused rather than sent if it does not. **Paying people is not something
this app can do** - that is a payment against the payable, made in the books by
hand.

`runOf()` reads a month and does **not** create it. It used to upsert, and
because every screen that shows a figure calls `workingOf()`, which asks for the
run, that was a write on every page open - a database kept awake by people
reading, which on Neon is the whole of the bill. A month nobody has touched is
open with nobody's approval on it, and that needs no row to say so.

### Where the ERP joins up

One button, on the bonuses tab: **Bring the figures in from Fusion** reads the
month's parcels out of `courier_orders` and the month's orders and sales out of
`shopify_orders`, and fills the boxes. It is the only place HR reads another
module, it **reads and never writes**, and nothing depends on it - no courier
account and no shop is an empty answer, not a broken screen. Every figure it
fills can be typed over, because the values and the choice of who shares in them
are the management's: *"hum value khud bana kr daal dein gy, or selection... ye
hamari choice apni hoti hai"*.

### Their own books, brought in

Asked for the day after the module was built: *"wo data already tha... employees
ki detail information bhe thi... usko data mein fetch krdo na, taky ye sara mein
module mein dkh sko, test kr sko."* Fair, and the right instinct - a payroll
nobody can see last year in is a payroll nobody will trust.

`hrimport.js`, and the two files are read as they are:

| Screen | Reads | What it writes |
|---|---|---|
| `/employees` → Bring our records in | the staff master sheet, or the joining form responses | `hr_employees` |
| `/payroll` → Ledger → Bring the old ledger in | the ledger sheet | `hr_pay_lines` for every month it holds |

**The reading is pure and the writing is not, and they are separate functions on
purpose.** `readStaff()` and `readLedger()` take a grid and give back what is in
it, touching no database - which is what lets `npm run check:hr-files` run the
real parsers over the company's real files before anybody's data is touched. A
parser nobody can run against the actual file is a parser nobody can trust.

### Nothing of theirs goes in this repository

Said by the tooling before it was said by anybody else, and it was right: a
staff name beside a salary figure has no business in a file that is pushed to
GitHub. So:

- **No real name, no real pay figure, in any tracked file** - not in source, not
  in a comment, not in a test, not in this file. Where an example is needed, it
  is described ("a logistics slip with a food allowance on it") or made up.
- `tools/hr-files-check.mjs` checks the **shape** of their sheets - the columns
  found, the months, the counts, whether every head was recognised, whether every
  date came out as ten characters. The figures that tie it to their own printed
  report live in **`hr-expect.json` beside the data files**, outside this
  repository, and those checks are skipped with a line saying so when it is not
  there.
- The uploaded files themselves are never stored, the same rule the invoice
  uploads have always had.

Two sentences in this file and one test comment had real names and amounts in
them before the rule existed. They are gone, but they are in the history of this
repository, which is the thing to remember: it is easier not to write it than to
take it back.

### The ledger's two columns, and which one means what

Their ledger holds the whole of the money since early last year, and its meaning
is split across two columns, both of which are needed:

| | |
|---|---|
| **Debit Head** | the salary head - Basic Salary, Late Fine, Food Allowance |
| **Credit Head** | the side: **Payable** (owed to them), **Receivable** (owed by them), **Paid** (handed over during the month) |

Their own report reads it as `SUMIF` on the debit head for the salary columns,
`-SUMIF` for the deduction columns, and `SUMIF` on the **credit** head for the
Paid column - so that is exactly how this reads it, and the figures that come out
are the figures on the report they already send.

`npm run check:hr-files` ties five people's total salary, total deduction, net,
paid and payable to their printed September report, to the rupee, and the
month's Paid total with them. The month's **net does not tie, and should not**:
the ledger file is newer than the printed report, and four people account for
all of the difference - two bonuses added after it was printed, one fine halved,
and one person on no line of it at all. The check prints both totals side by side
and asserts neither, because a test that demands a figure from a PDF printed
before the sheet was finished goes red for the wrong reason. What the difference
is, and why, is in `hr-expect.json`'s own note.

### Three things the real files taught, and all three were bugs

- **A row that is nothing but a name is not a person.** The tail of their staff
  master is a hundred and fifty-five names kept there to fill a dropdown with.
  The first reader took all of them and would have made a hundred and fifty-five
  employees with new ids and nothing in them. A real row carries an employee id,
  or at least one detail besides the name, and the ones left out are named back
  on the screen so it is clear they were seen rather than missed.
- **The two files disagree about slashes.** The biometric machine exports
  `8/26/2026` and the joining form writes `17/02/2025`. Where one number is over
  twelve the numbers decide; where neither is - `05/07/2021` - only a hint can,
  and getting it wrong moved a joining date by two months. So `dayText(v, order)`
  takes one: the staff files are read **day first**, the biometric log **month
  first**, and each reader says which it used.
- **Three ids in the master have no name against them** - reserved, nobody in
  them yet. Those are skipped and said so, rather than quietly becoming three
  blank employees.

### What an import may and may not overwrite

`hr_pay_lines.source` is one of three things, and the order of precedence is the
whole of the safety:

| `source` | what it is | who may overwrite it |
|---|---|---|
| `auto` | the calculation worked it out | the calculation, and an import |
| `import` | it came out of the old ledger | an import, and a person typing |
| `hand` | a person typed it here | only that person |

So working the month out again never disturbs an imported figure, and an import
never disturbs a figure somebody typed. The working table shows a typed figure in
teal and an imported one in italics, because "this is your figure" and "this is
last year's book" are two different things to be looking at.

**A month brought in can be taken back off**, per month, from the Ledger tab -
which is the only way to try the calculation on a month the old sheet already
answered. It removes only what the import wrote.

### Two things the import fills in by itself, and says so

- **Everybody's basic salary**, from the newest month the ledger holds for them,
  for anybody still sitting at nought. It is the one figure the staff master does
  not carry and the one the whole calculation turns on, so leaving it empty would
  have meant every figure worked out after the import came to nothing.
- **Nobody is verified.** An imported record is `form_state = 'pending'`, so
  every one of them confirms their own details the first time they sign in -
  which is what was asked for in the first place.

### Advance and credit purchase are balances, not a month's figure

Found while reading their report's own formulas, and it had been wrong here:

```
  Advance         = every advance up to and including this month
                    less every loan deduction in the months before it
  Credit Purchase = every credit purchase up to and including this month
                    less every employee adjustment in the months before it
```

They answer *what does this person still owe*, which is why a slip can show an
advance of fifty thousand against a ten thousand deduction in the same month.
`balancesOf()` works them out from the ledger on every report and every slip
rather than storing them, because a stored balance goes out of date the moment
anything behind it changes. Neither is in Total Deduction - the recovery is, as
Loan Deduction and Employee Adjustments.

And **`Paid During Month` is a head of its own** now, not a sum worked out at the
last moment. In their ledger it is every row whose credit side says Paid; in a
month this app works out, it is the heads named in `policy.paidDuringMonth` (the
food allowance) plus `Advance Salary Paid` - which is their AI = W + AE, exactly.

### Final and submit, and what a month is after it

Asked for in as many words, and it is the thing that makes this a system rather
than a spreadsheet with a web page on it: *"wo working jab mein final and submit
kro ga to wo meri us month ki report ka part ban kr database mein save hu jay
ge... employee bhe apni kisi bhe month ki salary nikal sky ga slip apny login
sy... hum bhe kisi bhe month ka data dkh sky gy"*.

So a month has exactly two lives, and `hr_pay_runs.state` is which one it is in:

| | what the figures are | what may change them |
|---|---|---|
| **open** | worked out again on every read, from the attendance, the pools and the policy | approving a leave, fixing a clock-in, typing a figure, editing the policy - all of it shows up at once |
| **final** (`approved`, then `posted`) | **the stored lines, and nothing else** | nothing. Reopening is the only way back |

`isFinal()` and `whyShut()` in `hrpay.js` are the whole of it, and every door
asks: `figureMonth`, `setLine`, `setFacts`, `savePool` and the ledger import all
refuse a final month and say which sentence applies. The import names the months
it was not allowed to move rather than skipping them quietly.

**This was wrong until it was asked about.** Only a *posted* month was protected,
so an approved month was still being recalculated on every read - which means a
policy changed in November would have moved October's slips, and an employee
opening last March would have seen March worked out by today's rules. A payroll
that can change behind you is not a payroll. Now the sign-off is what freezes it.

Two guards come with it:

- **A month with nothing in it cannot be signed off.** Freezing happens against
  the stored lines, so signing off a month nobody had worked out would have
  frozen it at nothing at all. `approveMonth()` refuses and says to work the
  month out first.
- **Reopening says what it does** - that the figures start being worked out again
  and every sign-off is cleared - because that is a bigger thing than the word
  "reopen" sounds.

### What has to be uploaded, and what never does

Worth stating plainly, because it is the question that was actually asked:
*"kia mjy her ber sheet upload krni pary ge?"*

| | how often | why |
|---|---|---|
| the old salary ledger | **once** | twenty months of history, and then never again |
| the staff master | **once** | and after that people are added on `/employees` |
| the biometric attendance export | **once a month** | the machine is a separate device and does not answer to anything; somebody has to export it |
| everything else | **never** | |

Everything after that upload is done in Fusion and nowhere else: fixing a
clock-in, marking a leave or an absence, **adding a day the machine never
recorded at all** (a missing day shows in the grid as a dot and opens the same
editor), the whole working, the bonuses and fines, the report, the slips, the
time sheets and the QuickBooks entry.

And **a virtual employee needs no upload at any point** - they type their own
check-in and check-out, it lands in `hr_days` with `source = 'self'`, and the
month's working picks it up beside everybody else's. That is the half of the
attendance that is already fully inside Fusion.

### What an employee can see, and from when

Nothing on `/my-hr` waits on a sheet: it reads `hr_days` and `hr_pay_lines`
straight out of the database. Their own details, their time sheet for any month
they pick, their leave and - once the month is final - their slip. The month
picker is a plain month box, so **any** month that is in the database opens,
this year or two years ago.

The one deliberate wait is the slip: it appears when the month is signed off and
not before. Half a month's figures are not a payslip, and a figure somebody saw
and then saw change is worse than one they waited a day for.

### Every company's HR is its own

Asked about, and it was true from the first line: *"ye app bht sary business ky
liye hy, her company ka record bhe seprate he hu ga"*.

Every HR table carries `realm_id` - `hr_employees`, `hr_days`, `hr_leaves`,
`hr_pay_runs`, `hr_pay_lines`, `hr_month_facts`, `hr_pools`, `hr_standing` - and
the policy lives in `app_settings`, which is keyed on the company too. So one
client's staff, their days, their leave, their months and their rules are
readable only inside that client's company, and `deleteCompany()` and
`graduateWorkspace()` find all of them from `information_schema` rather than a
written-out list, which is why a table added next month is not left behind
holding rows nobody can reach.

### Rights, and the line through them

Two groups in `RIGHT_GROUPS`, under a fourth area (`people`, "Staff and
payroll"), and the line between them is money:

| Right | What it opens |
|---|---|
| `hr` | `/employees`, `/attendance` - the records, the report, the leave |
| `payroll` | `/payroll` - working the month out, approving it, posting it |

`/my-hr` is in neither, on purpose. Changing the policy and making a login are
held to the company's administrator (`requireAdmin`), not handed out as a right.

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
