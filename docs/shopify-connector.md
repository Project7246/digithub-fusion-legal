# Shopify connector and QuickBooks writing

Moved out of CLAUDE.md on 4 Nov 2026, word for word, so that a task reads only
the module it touches. Nothing here was changed, reworded or dropped - see the
index in CLAUDE.md. Read this file before working on this module.
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

