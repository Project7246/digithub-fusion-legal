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

## Open items
- Replace the copied old files with the new design once the user describes it.
- Decide DigitalOcean settings: turn **Edge caching** and **Email obfuscation** Off (app shows
  live data).
- Check the Neon dashboard for the real storage limit.

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
