# How a screen is written here, and how a page breaks

Moved out of CLAUDE.md on 4 Nov 2026, word for word, so that a task reads only
the module it touches. Nothing here was changed, reworded or dropped - see the
index in CLAUDE.md. Read this file before working on this module.

## Shared navigation - 6 Nov 2026

Owner requested the same sidebar hierarchy across the app and every company.
All rails rendered by `public/nav.js` now use native details/summary groups:
larger bold parent headings, smaller indented links, a chevron and keyboard
disclosure. The active page's group opens automatically; other group choices
are remembered per section in the browser. Mobile uses the same hierarchy.

Courier provider headings stay larger/bolder than their account links, including
the active account. Providers use native summaries and only one provider opens
at a time. Account query parameters match exactly, so account 1 cannot select
account 10's branch. The Courier accounts folder is a button with expanded state;
existing rights filtering removes denied buttons, their trees and empty groups.
No server permissions, company scope, endpoints or background reads were added.

The shared profile menu, used on the home screen and module pages, offers
**Settings** to `status.boss` only, linking to `/settings#storage`. Existing
profile/appearance entries remain. Database access is still enforced by the
server's existing admin check; this menu link grants no new access.

`node tools/navigation-check.mjs` runs the production renderer and handlers
against synthetic users/accounts for all seven sections, disclosure state,
exact account selection, permission pruning and the super-admin shortcut.
It is included in `check:all`. This DOM harness is not a browser layout check.

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

