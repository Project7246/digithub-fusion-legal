# Moving Fusion: domain, region and database - November 2026

**Current status, 6 Nov 2026:** address, app region and database cutover are
complete. The sections describing 5 Nov configuration below are historical;
do not repeat their setup steps. The final evidence and verification limits
are recorded in section 8.

This is the runbook for three changes the owner has decided on:

1. the address becomes **`e.availity.pk`** instead of `ca.availity.pk`
2. the server moves from **Bangalore (BLR1)** to **Singapore (SGP1)**
3. the database moves from **Neon Ohio** to **a new Neon project in Singapore**

Everything in the "What is actually there" section below was **read off the
live consoles on 5 November 2026**, not remembered and not guessed. Where
something was not checked, it says so.

---

## 0. The prompt to hand to ChatGPT

**Give it the standing rules first.** `START-HERE.md` at the repository root
holds the owner's session-start prompt - AGENTS.md is binding, `git pull`
first, never paste an older copy of a file over the current code, only the
requested scope, Roman Urdu. Paste that, **then** the block below.

An agent given only the migration prompt will do the migration and undo a
week of code on the way past, because nothing told it not to.

Then copy this whole block:

> I am moving a Node/Express app called Fusion. It is on DigitalOcean App
> Platform, deploys automatically from GitHub, and uses a Neon Postgres
> database that is **not** part of the DigitalOcean app. I want to do three
> things: change the address from `ca.availity.pk` to `e.availity.pk`, move
> the app from Bangalore to Singapore, and move the Neon database to
> Singapore.
>
> The file `docs/migration-2026-11.md` in the repository is the runbook. It
> lists what is actually configured, the exact order, and five things that
> break if they are done wrong. **Read it and follow it. Do not improvise an
> order, and do not invent values.**
>
> The rules I need you to keep:
> - **Never generate a new `SESSION_SECRET`.** Every courier portal password
>   in the database is encrypted with it. A new one silently destroys all of
>   them and the couriers start reporting wrong passwords.
> - Do not change any application code. No domain is hard-coded anywhere; the
>   address comes from the `BASE_URL` environment variable alone.
> - Tell me before each step that changes something live, and tell me how to
>   check it worked and how to undo it.
> - If something you need is not in the runbook, ask me - do not assume.

---

## 1. What is actually there

### DigitalOcean

| | |
|---|---|
| App | `hammerhead-app`, id `1b8f5409-47ef-4ef8-a15b-127a21438178`, project `first-project` |
| Region | **Bangalore · Datacenter 1 · BLR1** |
| Components | **one Web Service** (`digithub-fusion-legal`). **There is no DigitalOcean database attached** |
| Deploy | from GitHub `Project7246/digithub-fusion-legal`, branch `main`, auto-deploy on push |
| Domains on the app | `hammerhead-app-z86ki.ondigitalocean.app` (Active) · **`ca.availity.pk` (PRIMARY, Active)** |
| HTTP redirect rules | none |

**The region can be changed in the control panel.** App → **Networking** →
**Edit network** opens "Edit datacenter and VPC network", which has a
*Choose a datacenter region* dropdown and a *Save network settings* button.
**Singapore · Datacenter 1 · SGP1** is in that list, under "Asia". This was
opened and read on 5 Nov 2026, and cancelled without saving.

### DNS

```
availity.pk      NS    nebula.dns-parking.com, aurora.dns-parking.com   (Hostinger)
ca.availity.pk   CNAME hammerhead-app-z86ki.ondigitalocean.app
e.availity.pk    does not exist
```

**PKNIC is only the registrar. Nothing needs doing there**, because the
nameservers already point at Hostinger. All DNS work is in hPanel:
**Domains → DNS → availity.pk → DNS records**, which has an *Add Record*
form. The zone also holds the mail records (`_domainkey`, MX, TXT) and the
main site - **do not touch those.**

### Neon

| | |
|---|---|
| Organisation | `org-long-glitter-08979099` |
| Live project | **DigitHub Fusion**, `billowing-poetry-08559264` |
| Branch | `production` (`br-wispy-sound-b4yb0j31`), created 7 Oct 2026 |
| **Region** | **AWS US East 2 (Ohio)** |
| Plan | Free - per project: 1 GB storage, **100 compute hours**, 10 branches, autoscaling to 2 CU |
| Storage | 139.84 MB |
| Compute | 26.7 of the 100 hours used between 1 and 5 November |
| IP restrictions | none set |

There is a **second, empty project of the same name**, last active a month
ago. Nothing points at it. It can be deleted, and deleting it is not part of
this migration.

**Neon cannot move a project between regions.** Moving means creating a new
project in Singapore (`AWS ap-southeast-1`) and copying the data into it.

### Environment variables the app reads

Required (the app will not work without them):

```
DATABASE_URL   QB_CLIENT_ID   QB_CLIENT_SECRET   SESSION_SECRET   BASE_URL
```

Set today and needed (confirmed on `/api/setup-check`):

```
ADMIN_EMAILS   GOOGLE_SA_EMAIL   GOOGLE_SA_KEY
SMTP_HOST   SMTP_USER   SMTP_PASS   SMTP_FROM
COURIER_RELAY   COURIER_RELAY_KEY
```

`PORTAL_KEY` is **not** set - which matters, see the next section.

Optional dials that exist in the code and may or may not be set. They all
have sensible defaults, so an empty one is not a fault:

```
COURIER_RELAY_HOSTS  COURIER_RELAY_PARAM  COURIER_TIMEOUT_SECONDS
TRAX_PORTAL_SIGNIN_SECONDS  TRAX_PAYMENTS_PAGE  TRAX_PAYMENTS_PER_RUN
TRAX_PAYMENT_REREAD_MINUTES  TRAX_PORTAL_TIMEOUT_SECONDS  TRAX_PORTAL_PAGE
MNP_PAYMENTS_PER_RUN  MNP_PAYMENT_REREAD_MINUTES
COURIER_ACCOUNT_GAP_SECONDS  CPR_CHASE_SECONDS  CPR_CHASE_STEP
SHOPIFY_CLIENT_ID  SHOPIFY_CLIENT_SECRET  SHOPIFY_SCOPES
NEON_CU_HOURS  NEON_IDLE_MINUTES  DB_LIMIT_MB  COMPUTE_STOP_AT
```

---

## 2. The five things that break if they are done wrong

### 1. `SESSION_SECRET` must not change. This is the dangerous one.

Courier portal passwords - PostEx, Trax, M&P - are stored **encrypted**
(`secrets.js`, AES-256-GCM). The key is `PORTAL_KEY` if it is set, and
**`PORTAL_KEY` is not set**, so the key is **`SESSION_SECRET`**.

If `SESSION_SECRET` changes, every saved portal password becomes
unreadable. Nothing crashes and no error says what happened - the couriers
simply start answering "that email and password were not accepted", and
somebody spends a day blaming the courier. The passwords would then have to
be typed in again, one account at a time, on the Couriers page.

**So: carry `SESSION_SECRET` across exactly as it is.** If a new app is ever
created instead of moving the existing one, copy the value - do not let
anything generate a fresh one.

(Changing it also signs everybody out, because it signs the `uid` cookie.
That part is only an inconvenience.)

### 2. The QuickBooks redirect URI must be added *before* `BASE_URL` changes

The app sends Intuit `${BASE_URL}/auth/callback`. Intuit matches it
character for character. Add `https://e.availity.pk/auth/callback` in the
Intuit developer console **first**, and leave the old one in place during
the changeover. Otherwise QuickBooks sign-in stops the moment `BASE_URL`
moves.

### 3. Shopify's redirect URL needs the same treatment

The install callback is `${BASE_URL}/auth/shopify/callback`. Add the new one
to the Shopify app's allowed redirection URLs.

### 4. Everyone will be signed out. This is expected, not a fault.

Cookies are host-only - no cookie domain is set - so nothing travels from
`ca.availity.pk` to `e.availity.pk`. People sign in again. Web push
notifications are per-origin too, so those have to be switched on again.

### 5. The courier relay stays. Singapore does not remove the need for it.

`sonic.pk` (Trax) only answers from inside Pakistan, which is why
`COURIER_RELAY` exists. **Singapore is still outside Pakistan**, so the
relay is still needed - do not remove it or its env vars.

The relay itself does **not** need changing: `tools/courier-relay.php` on
the website authenticates with a shared key and an allow-list of
`sonic.pk` hosts, and **checks no IP addresses**, so the app's new address
does not affect it. (Its `CURLOPT_TIMEOUT` was raised to 40 on 5 Nov 2026;
make sure the copy on the website is the current one.)

---

## 3. What does **not** need doing

- **PKNIC**: nothing. It is the registrar; the nameservers already point at
  Hostinger.
- **The application code**: nothing. `ca.availity.pk` is not written
  anywhere in the repository - the address comes from `BASE_URL` alone.
  This was checked by searching the whole repository.
- **A DigitalOcean database**: there isn't one. DigitalOcean's own warning
  about a database being left behind in the old region applies to *their*
  managed databases and does not apply here.
- **Courier IP allow-lists**: Neon has none set, and the relay checks none.
  Whether PostEx, Trax or M&P have whitelisted the current server address at
  their end **was not checked** - ask them, because the app's outbound
  address changes with the region.

---

## 4. The order, and why

Do them **one at a time**, confirming each, so that if something breaks it
is obvious which change broke it.

### Step A - add the new address. Safe, nothing breaks.

1. **Hostinger** → Domains → DNS → `availity.pk` → DNS records → Add Record:
   - Type `CNAME`, Name `e`, Content `hammerhead-app-z86ki.ondigitalocean.app`, TTL as offered
2. **DigitalOcean** → the app → Networking → **Add domain** → `e.availity.pk`
   - leave `ca.availity.pk` as PRIMARY for now
3. Wait for the certificate to go Active.

**Check:** `https://e.availity.pk` opens the app. `ca.availity.pk` still
works. Nothing has changed for anybody yet.

**Undo:** delete the record and the domain.

### Step B - switch the address over. Everyone is signed out here.

1. **Intuit developer console**: add `https://e.availity.pk/auth/callback`
   (keep the old one).
2. **Shopify app**: add `https://e.availity.pk/auth/shopify/callback`.
3. **DigitalOcean** → the app → Settings → the component → Environment
   Variables → `BASE_URL = https://e.availity.pk` → **Save**.
   Values typed and not saved are silently lost.
4. Let it redeploy.
5. Optionally make `e.availity.pk` the PRIMARY domain. **Keep
   `ca.availity.pk` on the app** for a while - old emails and bookmarks
   point at it.

**Check:** `https://e.availity.pk/api/setup-check` prints
`baseUrl: https://e.availity.pk` and
`redirectUri: https://e.availity.pk/auth/callback`, and all five `needed`
values are `true`. Then sign in, and connect QuickBooks once to prove the
redirect.

**Undo:** set `BASE_URL` back and redeploy.

### Step C - move the server to Singapore.

1. **DigitalOcean** → the app → **Networking** → **Edit network**
2. *Choose a datacenter region* → **Singapore · Datacenter 1 · SGP1**
3. **Save network settings** → it redeploys by itself.

The app is down for a few minutes. Environment variables are **kept**,
because this is the same app, not a new one.

**Check:** `https://e.availity.pk/api/version` shows a new version, the
Networking tab says Singapore, and - the important one -
`https://e.availity.pk/api/courier/reach?courier=trax` still answers that
the route is sound. That proves the relay still works from the new address.

**Undo:** the same dialog, back to Bangalore.

### Step D - move the database to Singapore.

This is the one with real data in it. **Do it when nobody is working**,
because anything written between the copy and the switch is lost.

1. **Neon** → New project → region **AWS ap-southeast-1 (Singapore)**.
   Match the Postgres version of the existing project.
2. Copy the data. 139.84 MB, so it is quick:

   ```
   pg_dump "<old DATABASE_URL>" -Fc --no-owner --no-privileges -f fusion.dump
   pg_restore -d "<new DATABASE_URL>" --no-owner --no-privileges fusion.dump
   ```

   Restore into the **empty** new database, before the app has ever
   connected to it. (The app creates its own tables on boot if they are
   missing, and a half-created schema makes the restore noisy.)
3. **DigitalOcean** → Environment Variables → `DATABASE_URL` = the new
   Neon connection string → **Save** → redeploy.

**Check, in this order:**
- `/api/setup-check` → `DATABASE_URL: true`
- the app opens and shows the companies, the couriers and the receipts
- **open a courier account's page and pull something** - this is what proves
  `SESSION_SECRET` came across and the encrypted portal passwords still
  decrypt. If it says the courier refused the password, stop: the key is
  wrong, not the password.
- Settings → Database (admin only) shows the new size

**Undo:** put the old `DATABASE_URL` back and redeploy. The old project is
untouched - **do not delete it for at least a week.**

---

## 5. What this is expected to achieve

The database is in Ohio and the app is in Asia, so **every query crosses
half the planet** - about a fifth of a second there and back. Neon bills for
the time its compute is awake rather than for the queries run, so a slow
round trip keeps it awake longer. 26.7 of 100 compute hours went in the
first five days of November.

**Moving the app alone does nothing for this** - Singapore is no closer to
Ohio than Bangalore is. It is **Step D that matters**: with both in
Singapore the round trip goes from roughly 200 ms to a couple of
milliseconds.

---

## 6. The code is fresh - do not revert anything

The receipts side of Logistics was rewritten on **5 November 2026**, the same
day as this runbook. Whoever does the migration should know the repository
has just changed, and should not "tidy" any of it:

- a receipt is now built from the courier's own payment cover **and** from
  the parcels, joined as equals - a payment with no parcels here is still a
  receipt (`recentCprs` in `dashdata.js`)
- Trax receipts come from their Finance payment screen, M&P's from their
  payment instrument report, each shown in that courier's own columns
- `/api/courier/receipts` asks the courier, one account at a time, and a
  read that failed is named on the page
- new checks: `npm run check:trax`, `npm run check:mnp-receipts`;
  `npm run check:all` is **19 checks** and all pass

`HANDOFF.md` is the short version of that work and
`docs/logistics-couriers.md` the long one. **None of it has anything to do
with the migration**, and none of it needs changing for the migration -
which is the point: no address and no region appears in the code at all.

## 7. When it is all done

Update `CLAUDE.md` - it is the file that records where everything lives:

- the Server row: region Singapore (SGP1)
- the Database row: the new Neon project id and region
- the Domain row: `e.availity.pk`, and the `CNAME e` record
- the line that says the QuickBooks sign-in only works at `ca.availity.pk`

### 6 Nov 2026 - final copy after the interrupted session

The owner enabled DigitalOcean maintenance mode during guided recovery. That
blocks user traffic; do not assume it stops the in-process keeper. Current
exports showed 47 tables in each project, but `courier_orders` had 76,934 rows
in Ohio versus 76,830 in Singapore, and `shopify_events` had 427 versus 428.
The old copy must not be promoted unchanged.

`tools/fusion-migration.ps1` is a manually launched migration helper, not app
startup code. The previously downloaded PostgreSQL 18.6 tools now execute.
The helper accepts the two connection strings with hidden prompts, checks
their regions/version/table count, and asks for `MIGRATE` before changes.
It backs up Singapore outside the repository, sets Ohio's database default
to read-only, terminates existing database client sessions, and verifies the
setting on a fresh connection. Current application code has no explicit
read-write transaction override. Keep maintenance on and prevent other
manual writers from overriding read-only during this operation.

It makes a final Ohio dump, restores Singapore with `--clean` in a single
transaction, then compares sorted full-row fingerprints, column definitions
and sequence states. These checks must actually pass before cutover; script
syntax and synthetic connection tests alone do not prove a successful copy.
Private dumps contain real data: do not commit, upload or print their contents.
Connection strings are not command arguments or tracked files; raw PostgreSQL
errors are suppressed because they can contain row values.

If the helper stops after freezing Ohio, leave maintenance enabled and report
the failed phase. To abandon the cutover, use its `-UnfreezeOhio` mode and
verify the application still points to Ohio before disabling maintenance.
After a successful copy, switch only DigitalOcean `DATABASE_URL`; preserve
`SESSION_SECRET` and relay settings, deploy, then perform the runbook checks.
Leave Ohio read-only and retain it for rollback. Switching back after new
Singapore writes requires reconciling those writes first, not blindly restoring
an old connection string. The final executed results are recorded below.

## 8. Final execution and checks - 6 Nov 2026

- Owner enabled maintenance and ran `tools/fusion-migration.ps1` in a separate
  PowerShell with privately entered source/target strings and `MIGRATE` confirmation.
  PostgreSQL 18.6 tools executed successfully, replacing the interrupted FDW copy
  with a fresh native dump/restore. Ohio's database default became read-only and
  existing client sessions were terminated before the final snapshot.
- Owner supplied terminal output: **Rows MATCH (47 entries), Columns MATCH
  (538 entries), Sequences MATCH (28 entries), VERIFIED**. These compare sorted
  hashes of every public table's complete rows, column definitions and exposed
  sequence metadata; the full native restore also carries schema objects.
  This is stronger than the earlier count-only comparison, not an independent
  mathematical proof against hash collisions or an audit of every database object.
- Private pre-restore Singapore and final Ohio dumps are outside the repository:
  `%LOCALAPPDATA%/FusionMigration/20261106-055453`. Never upload their contents.
- Owner replaced only component `DATABASE_URL` with the Singapore string, left it
  encrypted and preserved `SESSION_SECRET`/relay settings. Screenshot shows
  **Deployed configuration changes** live at **11:14:57 PKT**; app is Healthy,
  in **SGP1**, with `e.availity.pk` primary. Owner then disabled maintenance.
- Direct HTTP verification: both e and the existing starter address return
  **200**, version **1793942332224** (`at` 2026-11-06T06:15:24.252Z).
  `/api/setup-check` has e as baseUrl/callback and all five required settings true.
- Owner confirmed sign-in, companies and CPR data work, reported no error on
  the requested courier check and then **Works on every account Test**, including
  Trax and M&P. Test calls use the adapter and persist `markSync`, providing evidence
  of both courier reachability and a working application database write after
  Ohio's read-only freeze. Trax's test uses its cities API through the configured
  route, not a new portal login.
- Settings Database screenshot loads: **105.1 MB / about 1024 MB (10.3%)**.
  Per-table counts on that screen are planner estimates, not migration checks.
  Compute history was copied; approximately 35.4 hours shown there is an app-meter
  baseline, not demonstrated Singapore savings. Monitoring note: `docs/compute-budget.md`.
- Limits: native browser input was unreliable and the web Console added bracketed
  paste escape characters. The non-secret runtime hostname command never completed;
  runtime region is supported by the saved setting, live configuration deployment,
  working reads and courier-test writes, rather than direct hostname output.
  A fresh QuickBooks OAuth reconnect and a separate fresh courier-portal password
  round-trip were not independently observed. Do not equate an old Connected or
  signed-in label with either of those tests. Existing connections were preserved.
- Keep Ohio **read-only through at least 13 Nov 2026**, longer if needed. No deletion
  is scheduled or authorized by this retention note. Singapore now receives writes:
  reconciling them is mandatory before any rollback. No app/runtime code changed.

And in `docs/compute-budget.md`, note what the compute hours did after the
move - that is the number this whole exercise is for.
