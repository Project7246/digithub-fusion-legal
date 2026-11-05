# Logistics and couriers - decisions and behaviour

Moved out of CLAUDE.md on 4 Nov 2026, word for word, so that a task reads only
the module it touches. Nothing here was changed, reworded or dropped - see the
index in CLAUDE.md. Read this file before working on this module.
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
### M&P do not deduct - they invoice

Settled on 30 Oct 2026 by asking their API and reading the answer, not by
reading the manual again. A parcel with `CODAmount` 6943 came back with
`AmountPaid` **6943** - the whole of it - and what M&P charged for carrying it
is on a line of its own:

```
CNTrackingInvDetail: [{ InvoiceNumber, InvoiceDate, AmountInvoiced, InvoiceType }]
```

That is why their QSR report has **seventeen columns and not one of them is a
charge or a tax**, and why guessing at `servicecharges` and `gst` matched
nothing. Their `fee` is the sum of `AmountInvoiced`, the invoice lines are kept
beside the parcel, and their `tax` is nought honestly: that call gives one
amount and does not split carriage from GST.

**And then their payment report said the opposite, so read both.** The tracking
call reports `AmountPaid` equal to the whole `CODAmount`, which reads as
"nothing was kept". `Reports/Payment_Report` describes the money that actually
moved:

```
PaymentID 20261533146 - RRAmount 6943, InvoiceAmount 13286, NetPayable -6343, IBFT
```

`NetPayable` is `RRAmount` less `InvoiceAmount`, so what reaches the bank **is**
the COD net of their invoices - the same shape as PostEx and Trax, told in two
places instead of one. M&P therefore stay on the default: they deduct.

`deductingCouriers()` in `adapters.js` is the one list every money query builds
its SQL from, and an adapter says `deducts: false` only if a courier genuinely
hands over the whole COD. Nothing does today; the machinery is there because
the question had to be asked.

**Settled on 30 Oct 2026 by counting their rows.** October came back with
3,016 rows and **23 payments** - so a row is one consignment's share of a
payment, and the payment number repeats down them. On the biggest:

```
227 rows - collected 536,898 - invoices 93,824.40 = paid 443,073.60
```

Their own arithmetic holds, row by row and in total. What it does **not** mean
is "what these parcels cost": M&P recover their invoices when it suits them -
nothing on one payment, a month's billing on the next, which is how a payment
comes out negative. So the receipt says **Collected in this payment**,
**Invoices recovered from it** and **Paid to us**, and never "charges". What a
parcel cost is on the parcel, from `AmountInvoiced` on its own invoice line.

This was nearly called a bug on the strength of one receipt showing a charge
larger than its collections. It was the label that was wrong, not the figure -
which is the reason a figure is read back from the live account after a change
and not only in a test.

**Their payment report also names the bank**: `BeneficiaryBankAccount`,
`BankName`, `BeneficiaryName` sit on the block around the rows - which is the
account the Banking module is waiting for.

- **Their charges and their GST were hard nought until 30 Oct 2026**, in both
  mappers. So an M&P receipt showed no tax at all, every M&P parcel looked as
  though it had cost nothing to carry, what M&P still owed was overstated by
  exactly their charges, and the rates screen had nothing to compare them
  with. They are read by name now - `servicecharges`, `gst` and the spellings
  around them - which leaves nought where M&P send no such column, **so the
  field names are the thing to confirm against a real answer**. Until an M&P
  report is seen with figures on it, "M&P charges 0" means "not read", not
  "free".

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

**A section `claims` the pages it opens but does not list.** Taking Tracking
off this rail meant `/courier-dash` was a line in Operations alone - so
opening a Trax account from the Logistics courier tree landed somebody in
Operations, with the rail changed underneath them although they had asked to
go nowhere. `claims` on a section (`/courier-dash`, `/pickups`, `/receipts`)
is read by `holds()` beside the rail's own lines: the page belongs to
whichever section you were standing in, and the courier tree's line is what
lights up, because that is how you got there.

### Rates: what was agreed, against what was charged

Asked for on 29 Oct 2026, and the sentence that shapes it is *"rate kyun ke
company change karti rehti hai"* - so the rate card is typed in here and
**every card carries the day it starts and never an end**. A new rate is a new
card, from its own date; the old one is never edited into it, because that
would quietly re-price a year of parcels and make last month's figures
disagree with last month's screen. A parcel is priced on the card that was in
force **the day it was booked**.

`rates.js` holds both tables and both answers:

| | |
|---|---|
| `courier_rate_cards` | one courier company, optionally one account of it, and `effective_from` |
| `courier_rate_lines` | one line per zone. `'*'` is the rate for everywhere; a city named here beats it for that city alone, which is how these agreements are actually written |

A line is base weight, base charge, each extra kg, COD percent and its
minimum, the return charge, fuel percent and GST percent. An account's own
card beats the company's, a city line beats `'*'`, and the newest card not
later than the booking date beats the older ones - all of it in `CARD_JOIN`,
one lateral join.

Three tabs, and **only the last one needs a card**:

- **What they charged** - from the parcels themselves. Every parcel carries
  the courier's own fee and tax, so cost per parcel, cost per kg, per month
  and per city are answerable from the day an account is connected, for every
  courier, with no typing at all.
- **Agreed rates** - the cards. Each one shows a worked example underneath
  (a 1.5 kg parcel with Rs 2,000 to collect, broken into carriage, COD, fuel
  and GST) so the numbers in the boxes are not taken on trust.
- **Agreed against charged** - per company, per month, and the fifty parcels
  where the gap is biggest. Only parcels a card could price are compared, and
  the count says how many that was of how many.

Two things to know about it:

- **`courier_orders.weight`** was added for this. Every adapter had always
  read the weight and nothing kept it, so there was nothing to price against.
  A courier that says nothing leaves it **NULL**, never nought, and the screen
  counts those parcels rather than pricing them at zero; an update that
  carries no weight does not erase the weight we already had.
- **The arithmetic is written twice** - `expectedFor()` in JavaScript, for the
  worked example, and `EXPECTED_SQL` for the figures, because pricing fifty
  thousand parcels in node would mean reading fifty thousand rows. They are
  kept line for line with each other, and that is the thing to check first if
  the two ever disagree.

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
- **PostEx** `get-operational-city`, and **v2 before v1**. PostEx publish two
  of this call; v1 is the original and is what was asked for until
  29 Oct 2026, which is why the PostEx tab showed nothing at all while Trax
  and M&P answered. v1 is still tried after v2, for an account still served by
  the older integration. This is the one path in the three adapters **not**
  taken from a document in hand, so it fails quietly - the other couriers
  still answer - but it no longer fails **silently**: what PostEx said comes
  back as `trouble` and the page prints it. A list that came back empty is not
  a courier that goes nowhere.

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

## A nought is "not said", never "nothing"

Three bugs in one week, all the same bug, all in the money:

- **M&P's charges and GST** were written as `0` in both mappers with nothing
  behind them. Their report carries no such column at all.
- **Trax's tracking call** returns no money either, so `mapTracked` sets fee
  and tax to nought - and `saveOrders` wrote that straight over the charges a
  webhook or an invoice had already recorded. **Every sweep raised what the
  courier owed us by exactly its charges.**
- **The weight** was read by every adapter for years and kept by none, so the
  rates screen had nothing to price against.

The rule now, and it is the same rule in all three places: **a courier that
says nothing does not erase what it said before.** `saveOrders` only overwrites
`fee`, `tax` and `weight` with a value that is not nought; a nought leaves what
is there alone. Where a figure genuinely is nothing - M&P's tax - it is said in
the comment, so the next person knows which kind of nought they are looking at.

And when a figure cannot be read at all, the screen says so rather than showing
a nought: "M&P charges 0" has to mean "not read" until the adapter is known to
read them.

## Asking a courier what it actually sends

`GET /api/courier/peek?account=N&from=&to=` (Fusion's own, `requireBoss`) calls
the courier's own list calls and hands back **their row untouched** - the keys
on it, the first row, and whatever the block around it carries.

It exists because of the sentence this file now repeats: a figure of nought and
a column that was never sent look identical on every screen. Three things were
settled by one call that a week of reading manuals had not:

- M&P's QSR report has no charge column at all
- M&P's charges are on `CNTrackingInvDetail`, per consignment
- `"There is no QSR Report record against the request parameters"` is what M&P
  say when the **location id is not one of theirs** - it reads as "no data", so
  `peek` lists the sub-accounts the sign-in really holds beside the one saved

Ask it before changing an adapter's field names. Guessing at names is what put
`servicecharges` and `gst` into M&P's mapper, where they matched nothing and
looked like a fix.

### M&P's payments, and the bank they went into

M&P have no webhook of any kind, so their money is asked for:
`Reports/Payment_Report`, a span of days at a time, pulled on every sync
(`mnplive.js`, `absorbPayouts()`). One row per payment, and a block around the
rows naming the account it was sent to:

```
row    serial_no, PaymentID, PaidOn, RRAmount, InvoiceAmount, NetPayable,
       InstrumentMode, InstrumentNumber
block  BeneficiaryName, BankName, BeneficiaryBankAccount, AccountNo, BranchName
```

Each payment becomes a receipt (`courier_cprs`) with its **net**, and the
gross and the charge kept beside it rather than worked back out later -
`gross_amount`, `charge_amount`, and `paid_to_name`, `paid_to_bank`,
`paid_to_account`, `instrument`, `pay_mode` as columns of their own.

**And that is how a bank change announces itself.** The courier says on every
payment which account it sent the money to, so when somebody changes the
account with the courier, the courier's own next payment says so.
`bankDrift()` puts that beside the bank linked here and the Banking screen
shows it in three states - no bank set, the courier paying somewhere else, or
agreement, which is shown as nothing at all. Account numbers are compared with
everything but letters and digits taken out: an IBAN is written with spaces as
often as without, and two spellings of one account is not a change of bank.

**"Follow the change" does not set the bank by itself.** It takes you to that
account's own card with today's date in it. Which of your banks an account
number is, and from what day, is a decision about money - not one to guess at
from an IBAN, and the dated link it writes is what every past deposit is
placed by.

## What a parcel's status is allowed to do

Settled on 30 Oct 2026, after going through all three couriers against a live
account rather than one of them. Eleven faults came out of it, and nine were
about the money. These are the rules they left behind.

### A later answer that says less never wins

`saveOrders` used to write every field it was handed. Two couriers answer
about one parcel from two calls that know different amounts, so **whichever
ran last won** - and the one that knew least usually ran last:

| | knows | writes |
|---|---|---|
| M&P `Reports/QSR_Report` | the booking | `Booked` on every consignment on it, whatever has happened since, and the city as a **code** |
| M&P `Tracking/Bulk_...` | the journey | the real status, the real city, the invoice lines |
| Trax `/shipment/track` | the journey | **no money at all** - fee 0, tax 0 |

3,156 parcels sat at `Booked` with delivery dates on them, and cities that had
just been named went back to codes the moment a dashboard opened.

So, in the `ON CONFLICT` of `saveOrders`:

- a value that came back **empty replaces nothing** - status, city, both dates,
  the order reference;
- **nought is "not said"** for `fee`, `tax` and `weight`;
- and **nothing that has finished is un-finished**: a parcel in `delivered`,
  `returned`, `cancelled`, `lost`, `damaged`, `expired` or `transferred` is not
  put back to `unbooked` or `booked` by a later answer.

### The newest line of a history is the newest by its own clock

M&P's tracking reader took the **last** element of `CNTrackingDetail`. Nothing
in their answer says the history is oldest first, and `Date.parse` makes
nothing of `Oct 13 2026 11:04AM` - so a sort on it put every line equal and
"the last one" went on winning, which was usually `Booked`. `stampOf()` reads
their date and clock by hand, the history is ordered once, and the first time
a parcel reached a stage is what dates that stage.

### A word with "deliver" in it is not a delivery

`byWords` filed **`Delivery En-Route`** as delivered - a parcel on its way to
the buyer, its COD counted as collected and owed to us. `en-route` is one of
the exceptions now, for every courier.

### `other` is where a parcel goes to be forgotten

Anything in it is a parcel nobody can act on, so it is a list to empty, not a
bucket to live in. These were in it and are not any more:

| Courier | Status | Now |
|---|---|---|
| PostEx | In Stock (136) | transit - they hold it |
| PostEx | Under Verification (66) | review |
| Trax | Shipper Advise Requested (51), Reason Validation Required (9) | review |
| Trax | Intercept Requested (6) / Approved (2) | review / returning |
| M&P | ICA, CAN, UL, FCD, FWT, Reached at Destination (50) | transit |
| M&P | NSA-Non Service Area (8) | returning |

### A parcel nobody can place is asked about first

The refresh is capped (`REFRESH_CAP`, 60) and ordered newest first, so on an
account with thirteen hundred parcels moving, two with **no status at all**
were never reached. `movingTrackings()` puts unknown first now.

### Three tools this left behind, all Fusion's own

| | |
|---|---|
| `POST /api/courier/rebucket` | files every parcel again from the courier's own words. Needed whenever a mapping is corrected, because `status_group` is stored, not worked out when read |
| `POST /api/courier/cityfix` | tidies the shape of a city name (`SIALKOT` → `Sialkot`) and asks the courier for the name behind a code. **It never turns a code into a name itself** - only the courier knows whether `GUJ` is Gujranwala or Gujrat |
| `GET /api/courier/peek` | the courier's own row, untouched |

### Where it stands

Every account's `other` is empty but for one M&P parcel their own system has
no status for. Cities are names everywhere - `0 still coded` after 3,462 were
named by the courier and 14,568 tidied. The ageing bands tie to `oldestDue` on
every account, the not-collected figure matches the portal (226 unbooked), and
M&P's 24 October payments are the 23-24 distinct `PaymentID`s behind their
3,016 report rows.

## A Trax receipt is the courier's own payment - 5 Nov 2026

The receipt section for Trax was told to read like PostEx's: the parcels in
it, how many were delivered and how many came back, every tax that was cut
and what kind, the COD, and what is left for us. It did not, and the figures
on it were wrong rather than merely thin. Three faults, checked against their
own Finance > Payments screen while signed in.

### Their per-parcel call does not name the payment they pay against

`/shipment/payments` carries a payment status, the charges and the GST, and an
`id`. That id was taken for Trax's answer to a CPR number and written onto the
parcel as one. It is not.

Payment **1839584** holds **924** shipments on their own screen - 802
delivered, 116 returned, 6 adjusted. **1,709 parcels carried its number here**,
and not one of the 785 extras appears in any of that payment's three lists.
Parcels still in transit, and parcels at *Shipper Advise Requested*, were
sitting inside a receipt with their COD counted as collected.

The older payments were right to the parcel - 74, 1,165 and 1,644, each
exactly their own figure - because those were linked from the payment screen
first, and `needCpr` only ever asks about a parcel that has **no** number yet.
The newer a payment, the more of the guess had reached it.

So:

- **`trax.js fetchPayment` no longer returns a receipt number at all.** It
  says whether the money moved and what it was worth, and their own id is
  kept under `traxPaymentId`, where nothing can mistake it for a receipt.
- **A courier with a payment screen is never asked parcel by parcel.**
  `askAboutMoney` (courierlive.js) now reads `absorbPortalPayments` for any
  adapter whose `portal` has a `payments` call, and does not fall through to
  the per-parcel loop - not even when the account has no sign-in, because
  there is nothing to guess at either way.
- **`savePayments` keeps a receipt number it is handed an empty one for.**
  `cpr_number = COALESCE(NULLIF(v.cpr_number,''), o.cpr_number)` - the same
  rule as "a nought is not said" for the charges, applied to the number.

### Only the payment's own list may take a parcel out of it

`linkCprParcels` only ever added, so nothing could undo a wrong stamp.
`clearCprStrays` is the other half: of the parcels carrying a receipt number,
the ones the courier did not name let it go, and the settlement goes with the
number because the same answer wrote both. **It is only ever given a complete
list** - all three kinds, read in one visit - and an empty list clears
nothing, because an empty list is "not read", never "this payment is empty".

`absorbPortalPayments` reads every kind first and writes afterwards, so a
parcel that belongs to payment A is linked to A before B is allowed to let go
of its strays.

**Adjusted was the third kind and was not being read.** Their
`total_shipments` is delivered + returned + adjusted; two of the three left
the rest of the payment free to be stamped by something else.

### It pays for itself to run on every visit

A payment whose parcels are all here already matches the courier's own count
and is not opened again, so an account in step costs **one** call. One that
can never match - an account whose parcels were never all imported - is held
off by `TRAX_PAYMENT_REREAD_MINUTES` (6 hours) and `TRAX_PAYMENTS_PER_RUN`
(6), so a visit cannot turn into thirty calls through the relay. A backfill
passes `force` and opens all of them.

### The screen: what PostEx's receipt has, Trax's now has

| | |
|---|---|
| **This receipt** | the courier's own status word - **Paid**, **Processed**, APPROVED, CLOSED - the date, and whether QuickBooks has it. It is a column in the receipts list too: which of them the courier has actually settled was the one thing the list did not say |
| **What is in this receipt** | delivered / returned / adjusted, **what the courier says beside what we hold**, and the COD on each. Two counts on purpose: a receipt that says 924 while 1,709 parcels carry its number is wrong, and only printing both can say so |
| **Money** | all five deductions named - charges, GST, withholding tax, COD SST, IBFT - then what they paid. The old screen showed two of the five, so it came to 1,855,200 against the 1,775,545 on their own receipt, and the **79,646 of withholding that made up the difference was nowhere on the page**. It now says in a line whether collected less the five is exactly what they paid |
| **By status** | every status in the receipt, with parcels, COD, charges and tax - built from the parcels, so it works for any courier |

`npm run check:trax` (`tools/trax-receipts-check.mjs`) is the arithmetic, on
synthetic rows: three kinds adding to their own total, counts read out of the
button their screen draws them in, money read through its thousands marks,
the five deductions tying to the figure paid, their rounding to the rupee
tolerated and a real gap reported rather than absorbed.

### A receipt number nobody ever issued

Every real receipt has a cover row: the payment screen writes one, and so
does the payment webhook. What the per-parcel call wrote had none - it was an
id of Trax's own stamped on a parcel, and it drew a receipt of one or five
parcels with no status, no date and no money behind it. Trax - ElRB's list
was mostly those.

`clearCprWithoutCover` lets a parcel go of a number that no payment of
theirs and no webhook of theirs ever carried, and it runs only straight after
the payment screen has answered: a screen that could not be read is silence,
and silence is not evidence.

### Their own five do not always come to their own payable

Checked across the nine payments on 5 Nov 2026: 1838602 is 0.43 out, which
is rounding to the rupee, but **1839584 is 8.93 short and 1837736 is 9.46
over**. Both figures are Trax's, printed on the same row. So the receipt
names the sum and the difference rather than choosing between them - what
arrived is what they paid, and a gap of a rupee or more is said out loud
instead of being absorbed into a line nobody can check.

### "No payments" is an answer; a sign-in that failed is not

`asked()` throws when the sign-in has gone or the feed is not a list, so an
empty payment list is the screen itself saying the account has none - and an
account with no payments has no parcels inside one. Returning early on it
left **Trax - ElRB showing twenty-two receipts no payment of theirs ever
issued**, of 1 to 1,858 parcels each. The orphans are cleared on an empty
answer too.

And where the screen has not answered yet, a Trax receipt with no cover says
so on its own face rather than showing a figure nobody can find at the
courier: the number came from their per-parcel call, the money on it is ours
added up from the parcels, and it comes off the next time that screen
answers.

### What is still not whole

Each payment now sits within a few parcels of Trax's own count - 920 of 924,
2,363 of 2,370 - instead of hundreds over. The shortfall is parcels Trax
name on the payment that this app holds no row for at all, never imported.
The webhook path looks those up (`STRANGER_CAP`); the portal path does not,
and both counts are printed side by side so the gap is visible rather than
guessed at.

### Their kinds are not our buckets

"What is in this receipt" briefly set Trax's delivered / returned / adjusted
against our own `status_group`, which is a different question: a parcel in
the returned half of a payment may be at *Return in Transit* here, so **116
of theirs read as 16 of ours** and the table said the receipt was wrong when
it was not. The kinds and the counts in that table are the courier's own
throughout. Which bucket each parcel is in is the **By status** table
underneath, where that question belongs. The only pair shown side by side is
the count - theirs, and how many of them this app holds a row for.

### A receipt is read in its own courier's columns - 5 Nov 2026

Said plainly by the owner, and it is the rule: **each courier deducts what it
deducts, and its receipt shows those and no others.** PostEx's is right and
is not to be touched - it is the example, not the template to flatten the
others into.

Trax print six columns on a payment and the receipt now carries exactly
those, in their order:

| | |
|---|---|
| Total amount | the COD collected |
| Total charges | what Trax kept for carrying |
| Total GST | on those charges |
| Total WHT | withheld |
| Total COD SST | withheld |
| Total payable | what reached the bank |

**The IBFT charge is not one of their columns.** Their row carries an
`ibft_charges` field that the screen does not draw, and it is worth 100 on
every payment seen. It is no longer shown as a line of its own - inventing a
deduction the courier does not print is the same fault as leaving one out.
It is named in the difference note instead, where it explains most of the
gap between their four deductions and their own payable and can be checked
rather than assumed.

### Every courier has its own payment book now

`/receipts` had two tables for PostEx - the receipts in the dates chosen,
and underneath **PostEx's own receipt book**, month by month, with the
courier's own status on each. The other couriers had only the first, so
nothing on the screen said what October held or which of its payments the
courier had actually settled.

`drawBook()` is that second table for them: month by month, newest first,
each month's payments, parcels, COD and net, and each payment's own status -
**Paid** and **Processed** for Trax, the same two states PostEx call CLOSED
and APPROVED, coloured alike and spelled as the courier spells them. It is
built from the covers their payment screen wrote and from nothing else, so a
receipt number this app invented cannot appear in the courier's own book.

### No bank-fee column for a courier that does not publish one

M&P print an IBFT fee on their payment report, so it is a column of theirs
and it stays in the receipts list. **Trax do not** - six columns, no bank fee
among them - so the list no longer draws one for a Trax row, and the 100 on
their row is named in that receipt's own difference line where it can be
checked.

And the list's **Tax** column is every tax the courier cut, not the first of
them. Trax take a GST on their charges and then withhold twice more, and a
column showing only the GST made the row itself not add up: collected less
charges less GST came to 1,855,300 against the 1,775,545 they paid. The
hover gives the split, the receipt names them line by line.

## One receipt system per courier, not one per account - 5 Nov 2026

Said by the owner after the Trax work, and it is the rule that the rest of
this section follows: **"jo ap ak structure bna rhy ho wo trax k sary
accounts k liy ak jsa hona chahiy"** - PostEx was built once and every PostEx
account came out right; a courier's second account must not need its own fix.

Trax - AA Traders came out exact and Trax - ElRB did not, and the reason was
not Trax at all.

### /receipts asked the courier nothing

`/api/courier/receipts` is the route the page reads for every courier **but**
PostEx, and it started no reading of any kind. The chase lived on
`/api/courier/cprs` and on the courier dashboard - screens a Trax or M&P tab
never calls. So those tabs listed whatever had happened to be written down by
some other path, and AA Traders only came right because its payment screen
was read by hand. ElRB was never asked at all.

- `/api/courier/receipts` now starts the chase for what it is about to show.
- **`chaseCpr` takes a courier as well as an account.** It took an account id
  alone, so a courier tab could not have asked for all of them even if it had
  tried. One account or every account of one courier, the same work either
  way.

### A read that failed belongs on the screen

Every one of these reads is caught and dropped where it is started, because a
page must not wait on a courier. Dropping it **silently** is what let one
account be the courier's own figures and the next be numbers nobody had
checked, with nothing on the screen saying which was which.

`receiptSources()` keeps, per account and in memory, when its receipt screen
was last read, how many payments came back, and the reason if none did. The
receipts page prints it: an account whose screen could not be read is named
with the courier's own words for why, and an account nothing has asked yet
says so too.

## M&P bill, they do not deduct - and the receipt says so

Trax keep a charge and withhold twice. **M&P invoice.** Their Payment
Instrument Report has its own columns - `RRAmount`, `InvoiceAmount`,
`MON_FIX`, `TaxAmount`, `IBFTFee`, `NetPayable` - and behind the invoice is
`paymentinstrumentdetailreport`, which gives what the invoice was made of and
every consignment in the payment.

Read off GlowCart's live account (sub-account of 34G162) on 5 Nov 2026,
payment 20261533146:

| | |
|---|---|
| RR amount | 536,898 |
| Invoice amount | 28,123 - shipment 20,769, fuel 3,115.35, GST 3,840.70, extra 120, OSA/NSA 240 + its GST 38 |
| Tax amount withheld | 20,641 - income tax 10,320.73 **and** sales tax 10,320.73 |
| IBFT fee | 100 |
| Net payable | 488,133, and 488,033 reaches the bank |
| Consignments | **298 - 273 DELIVERED, 25 RETURNED** |

Three things were missing and all three are now read:

- **`MON_FIX` was never read.** It is nought on every payment seen, which is
  precisely why leaving it out was a trap: the day it is not, the receipt
  stops tying to their own net with nothing on the screen to say which figure
  moved.
- **The invoice was one word.** Shipment charge, fuel charge, GST, extra
  charges and the OSA/NSA line with a GST of its own are each named now -
  that is how M&P's charges differ from Trax's, and a receipt that calls them
  all "charges" cannot show it.
- **The withholding was one figure.** Their payment row adds income tax and
  sales tax together; their consignment lines split them, and the receipt
  prints both.

### And a payment's parcels come from the payment

`absorbPaymentParcels` (mnplive.js) is M&P's half of what Trax's
`absorbPortalPayments` does: one call per payment, the consignment list is
the payment's parcels, parcels it does not name let the number go, and the
counts and the invoice split are merged onto the cover. The per-parcel
tracking call still runs afterwards - unlike Trax's, **their** PaymentID is
genuinely theirs - but it can only ever speak for parcels this app already
holds, which is how a payment of 235,668 showed **four parcels**.

**No orphan clearing for M&P.** Trax's payment screen hands over every
payment the account has ever had, so a number with no cover is provably
invented. M&P's payments are asked for a span of days, so a payment older
than anything fetched has no cover and is still perfectly real.

### saveCprs merges `raw` now

A cover is written from the payment list; what a second call of theirs says
about the same payment - the counts, the invoice split - is merged onto the
same row by `mergeCprRaw`. Writing the whole of `raw` on the next sync threw
that away, which is the same fault as a nought erasing a charge. M&P's covers
go through an audited path that compares named fields, so merging is also the
only way to add to one without disturbing that audit.

`npm run check:mnp-receipts` is the arithmetic, on synthetic rows.

### Two accounts of one courier do not sign in at the same second

With `/receipts` asking properly, Trax - ElRB answered at last - and what it
answered was **"The Trax portal could not be reached: 20 (through the
relay)"**. Not a password: a timeout, while Trax - AA Traders on the same
courier tab answered instantly from a session it already held. Both were
started together, so one portal, one relay and one sign-in were being asked
for twice in the same second.

`chaseCpr` runs its accounts **in a queue** now - still not awaited, because
a page must not wait on a courier, but one after another. That is what "one
system for every account" has to mean in practice: the same work for each,
not all of it at once.

**And "20" is a timeout, not a code.** An aborted fetch throws a DOMException
whose `code` is 20 - `ABORT_ERR`, a DOM constant with nothing to do with
networks - and `codeOf()` in wire.js read it as the error code. So a call
that had merely run out of time reported a number that told nobody the
password was fine. It reads `AbortError` and `TimeoutError` by name first,
and every courier says "no answer at all" instead.

### A timestamptz is not a day

`absorbPaymentParcels` read the cover's `created_on` and took the first ten
characters of it. `created_on` is a `timestamptz`, so the driver hands back a
Date and `String(d).slice(0,10)` is **"Thu Nov 05"** - which Postgres then
refuses as a date. The counts and the invoice split had already been written
by then, so the receipt looked half-right and the parcels never linked. The
query asks for `to_char(created_on AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD')`
now, which is what the rest of the M&P path already does.

`day()` in statuses.js exists for exactly this reason on the courier side;
this was the same mistake on our own side of the wire.
