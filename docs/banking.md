# Banking - decisions and behaviour

Moved out of CLAUDE.md on 4 Nov 2026, word for word, so that a task reads only
the module it touches. Nothing here was changed, reworded or dropped - see the
index in CLAUDE.md. Read this file before working on this module.

## Banking section access - owner override, 6 Nov 2026

Owner explicitly approved opening Banking ("ha kholo") and requested separate
Banking section access. This supersedes the older ADMIN_EMAILS-only decision below.
All access includes Banking management; Reports only includes read-only Banking.
Custom access has independent **Banking reports** (`bankingreports`) and
**Manage Banking** (`banking`, includes reports) choices in the existing access editor.
No grant opens another company's records: every Banking API retains requireCompany
and realm-filtered queries. Hidden Banking amounts also deny Banking access.
GET/HEAD require report access; mutations require management access on the server.
Report-only screens expose reports, CPRs and exports without edit/setup controls.
Banking grant changes and initial member grants write actor, old/new grant and
timestamp into the existing company-scoped Banking audit in the same transaction.
No schema change, migration, background timer or real-account test is involved.
The launcher lists implemented permitted pages only, without future placeholders.

## PostEx HT reconciliation and receipt ranges - 3 Nov 2026

PostEx Receipts cards and the portal list use the same date-filtered CPR response,
including CPRs not yet linked to stored parcels. Do not rebuild these cards from
settled parcel rows. Discard stale range/account responses. Today, 7 days, 30 days,
3 months and Date range controls share the existing reporting flow. CPR date upper
bounds are next-day exclusive. Synthetic coverage includes 26 receipts and empty ranges.

The Finance unpaid CPR headline and pending CPR row use courier cover net amounts;
parcel-based statement/month/ageing values are explicitly estimates, not actual bank
payouts. No-CPR parcel amounts remain separate. Gross QuickBooks COD is labelled gross.
PostEx background reconciliation reaches the oldest unfinished booking within the
existing 120-day catch-up bound, on the existing compute-metered schedule. API failure
must propagate instead of looking like a successful empty sync. Authoritative PostEx
booking dates can correct webhook placeholder dates. No production data rewrite,
scheduler frequency, environment or database schema change is part of this fix.

Cities are no longer truncated to 200. Finance city count follows delivered value.
Pickup detail carries charges, tax and pickup date, preserves full heading totals
when its 2,000-row preview is capped, and enables CSV for the displayed rows.

## Banking cards, Sheet cutoff and internal messages - 2 Nov 2026

Owner requested one consistent Banking card/form design: aligned fields, short
headings, ! help for long explanations, compact tables. /banking opens four
launcher cards, with existing tabs inside each view and a visible Back arrow.
Use URL/history for Banking views rather than reopening the last tab on entry.
Launcher icons use the shared SVG tiles with dimensional gradients/depth, also
on the Fusion home page. Do not remove Finance or other modules' app navigation.
Only Banking replaces its redundant Overview rail with company team messages.

Moved-away fiscal setup source chains must disappear from visible logs/Excel,
including Superseded versions. Keep their database audit intact; edits on an
active chain still retain history. Do not delete stored money/audit rows.

Migration 004 adds banks.sheet_from, an independent Sheet payments start date
beside the Sheet URL. It overrides old fiscal/default feed dates for Sheet Out
only. Transactions' Sheet sync field writes the same setting atomically with
audit. Manual entries/CPRs keep their separate rules. Sheet connection history
opens by button beside the URL; its date/source changes export to Excel. Never
guess or rewrite the owner's existing payment dates or historical totals.

Internal chat is its own messages.js module/router/table (migration 005, RLS).
Participants come through users.messageUsers: active authorized members of the
same current company only. Session determines sender and company. Threads are
private between the two participants, 50-row keyset pages; messages persist.
Snapshot the stored full sender name and timestamp; notify via existing bell
atomically with the message, no external messaging. Unique client key prevents
duplicate sends/notifications after network retry. Read acknowledgements stop
at the displayed message ID. Banking rail opens conversation dialog; recipients
can open /messages from the bell without being granted financial Banking access.
Other modules' left navigation remains unchanged. Typed chat drafts are per
company/user/recipient in session storage. Only active open chat polls (60s,
stops after 2 idle minutes or hidden tab), no always-on database polling.
No production test messages: verify routing/notifications with synthetic fixtures;
owner checks actual two-user delivery/replies with their own authorized users.

## Twice-daily Banking retention - 2 Nov 2026

Owner requested server-side Banking archive runs daily at 15:00 and 22:00
Asia/Karachi (10:00/17:00 UTC), independent of browser, login or user computer.
banking-schedule.js starts from existing initBanking, no hosting/env changes.
The timeout does not query the database between slots. Restart checks the latest
due slot only. Durable company-scoped append-only archive-schedule audit events
and transactional advisory locking prevent repeat/completing another live run;
stale one-hour claims can retry. No new table or migration for scheduling.
Retain available covers via the named courier boundary, then attempt up to 20
missing details per company within a shared three-minute launch budget, serially.
Use existing compute meter/guard: nearly exhausted allowance holds background
work; failures are counted, not silently called complete coverage. Details keep
their existing retry backoff. Existing Logistics ingestion/keeper stays unchanged.
Two daily retention runs do not guarantee every old detail is fetched immediately.
DigitalOcean must be running; after downtime catch up latest slot on restart.
This supersedes the earlier statement that retention has no independent timer.

## Clear Banking setup and retained CPRs - 2 Nov 2026

Owner's UI rule for future forms: short accurate headings/labels, aligned fields,
plain language understandable without accounting jargon. Put long explanations
behind an adjacent ! help icon, not paragraphs inside labels. Banking daily tabs
are Live balance & CPRs and Transactions; Bank / courier links and Bank settings
are secondary setup tabs. The old Courier payments label described linkage badly.

Opening balance and its statement Balance date are entered under Transactions
in the Opening & fiscal totals card, beside aligned Fiscal In and Fiscal Out
groups. Bank settings has Auto sync from (formerly True on); it is not the
statement balance date. Explicit CPR/Sheet start dates override that bank default.
Manual entries still follow fiscal year; balance formula remains opening + fiscal
In - fiscal Out. New baseline dates are nullable for old records; never invent
an old statement date. Blank opening means unknown, not zero. Opening edits and
fiscal totals save with audit in one transaction. Bank moves keep source bank's
opening; changing the selected bank loads that bank's actual opening fields.

Banking-only migration 003 adds the statement date and a company-scoped RLS CPR
archive with no courier-account FK. Logistics files/calculations/sync are untouched.
Each existing Banking refresh retains all available CPR covers from the named
courier read boundary; missing live fields never erase saved money. Merge by
company/account/CPR, no duplicate bank deposits. Old account removal or credentials
disconnect cannot cascade-delete the Banking copy already retained.

Detail JSON is allow-listed, versioned, gzip compressed, hash deduplicated and
read only when needed; report queries never load order blobs. No credentials or
uploaded Excel files are retained. Full detail is saved on first read and then
served offline. Missing details get at most two attempts per Banking-triggered
batch, paced/metered by existing compute budget, with 6-hour retry backoff. No new
timer or Logistics polling. The UI shows saved cover/detail counts: do not claim
unfetched portal detail is archived or tell the owner to disconnect before required
detail coverage is complete. Unsupported live detail uses saved local orders and
states missing information honestly. No automatic retention deletion of bank records.

Saved CPR covers export as streamed company CSV (300-row keyset pages), working
details export through existing CPR Excel from retained JSON. Archive updates have
compact audit entries. Portal failure must not prevent export of saved full detail.
This archive is not an offsite backup; no hosting/env/DNS/deployment changes here.

## Fiscal opening bank correction - 2 Nov 2026

Owner requested changing the bank while editing a fiscal opening. Keep the bank
selector enabled and retain typed amounts/dates when changing the edit's bank.
Save atomically clears the original bank's fiscal totals and appends them to
the selected bank, with existing audit/history preserved. Reject occupied target
fiscal amounts rather than silently overwrite them. Stale source versions and
failed audits roll back everything. No schema or deployment setup changes.

## Banking input preservation - 2 Nov 2026

Alt-Tab/visibility refresh must never erase unsaved Banking form input. Track
input/change revisions: skip background reads while dirty and discard in-flight
background results/errors if the form changes or the user switches views.
Explicit saves/cancels keep existing behavior. Fiscal View log belongs inside
its fiscal opening card, alongside that section's actions.

## Log presentation - 2 Nov 2026

Owner requested that logs not grow the entry page. Fiscal opening, transfer,
manual In/Out and bank-opening history show View log buttons by default. Tables
open only in a dialog, with Excel download of the same visible, company-scoped
records. Preserve Edit/Remove: close the dialog to edit in the existing form;
removal keeps the existing audited behavior. Never export hidden deleted chains.

## Latest owner balance/log rule - 2 Nov 2026 (supersedes earlier balance notes)

Live Balance = Opening Balance + full selected Fiscal Year In - full selected
Fiscal Year Out, including historical fiscal opening totals and manual entries.
Do not exclude historical fiscal turnover from this formula. Automatic feed
cutoffs and manual fiscal-year selection remain as already specified. Deleted
fiscal setups, zero clearing replacements and their previous versions disappear
from visible logs; edit history stays for active entries. Store explicit setup
save/remove actions in the existing audit table, without deleting stored history.
Earlier unmarked zero resets with unchanged cutoff dates are treated as clears
for display compatibility; future explicit edits to zero retain their history.

Owner clarification, 1 Nov: In/Out start dates apply to automatic CPR/Sheet
feeds only. Manual hand entries and transfers count in Year In/Out by their
transaction fiscal year even before automatic start/opening dates. Include
them in fiscal drilldowns too. Opening bank balance remains separate: manual
movements before its dated balance are historical turnover, already covered by
that opening, and do not change live balance twice. Entries after opening count
in live balance regardless of automatic feed start dates. Never auto-recreate
deleted entries or change the owner's stored figures.

## Banking reviewable entries and payment detail - 1 Nov 2026

Owner requested visible logs below fiscal-opening, transfer and manual In/Out
forms, including wrong-bank entries, edit/remove actions, and source lists under
Opening, Year In and Year Out arrow buttons. Logs cover all banks and preserve
actor, saved time, superseded setup versions and reversed transactions.

Owner clarified: removed manual In/Out and transfer entries must disappear
from the visible transaction log; edited entries keep their change history as
Updated. Audit and money reversals remain stored. New reversal payloads mark
edit versus remove explicitly.
If the latest edited version is removed, hide its entire prior edit chain too;
Updated history stays visible only while the resulting entry remains active.
Older edit replacements share the reversal's
exact PostgreSQL transaction timestamp; use full timestamp text for compatibility,
not JS millisecond dates. Do not rewrite old production audit rows to hide them.

Use existing setup/audit tables; no new schema or deployment configuration.
Edit/remove posted manual transactions by atomic reversal plus replacement,
including both sides of transfers. Original and reversal moves remain stored,
but the report excludes both so cancellation never inflates fiscal In or Out.
Repeated reversal and stale fiscal correction must fail safely. Clearing a
fiscal setup appends zero historical totals with the same cutoff dates, never
deletes history. To move a fiscal opening to another bank, clear the wrong bank
then enter the amounts on the correct bank. Opening bank edits now record old
and new values atomically; do not invent audit history for earlier bank edits.

View payments opens a dedicated dialog immediately, including read/matching
errors. Month-filtered rows and Excel use the same fiscal/opening/Out cutoffs.
Show date, receiver, sender bank, receiver bank, account head, combined remarks,
reference/proof links and total. Source Google Sheet remains read-only. Keep
negative CPRs visible in red with zero bank impact, as already specified.

## Banking manual fiscal openings and Google bank book - 1 Nov 2026

Owner supplies historical fiscal Opening In and Opening Out; do not fetch
transactions back to 1 July to reconstruct them. In/Out each have an inclusive
start date. Historical totals seed fiscal columns only, never add money already
included in the dated opening bank balance twice. Live balance is dated opening
balance plus new actual bank In minus new actual bank Out. Opening date remains
the earliest balance cutoff. Courier deductions are already included in CPR net;
never post them as separate Out, for any courier. Owner clarified negative CPR
is courier liability, recovered from future settlements unless paid separately.
Keep it red in the CPR list; exclude it from bank In, Out, receivable and balance,
with no verification warning. Separate delivery bills actually paid from the
bank and present in the spending sheet remain real Out.

Owner reaffirmed: opening bank balance is entered only as Opening Balance.
Fiscal Opening In is the selected bank's historical incoming total in that
fiscal year strictly before its selected In start date. New manual In and net
received CPRs on/after the cutoff add to Year In. Out source failure or sheet
name mismatch must not hide known Year In in rows, totals or drilldowns: track
incomeIncomplete separately. Out and live balance remain unavailable if expenses
cannot be read. Missing incoming CPR money still marks income incomplete.

Owner explicitly approved necessary Banking schema/audit additions. Migration
002 adds append-only company-scoped fiscal setup history and entry audit; no
existing balance or movement is overwritten. Manual In/Out and paired transfers
commit with audit; audited entries cannot use the old delete endpoint.

Google workbook is read-only. Monthly tabs with the existing month/year format
are discovered on refresh, including future months. Match ONLY portal Bank Name
to column G Sender Bank Account, never receiver bank, account title, narration
or an alias. Owner will align the names later; mismatches must be visible rather
than silently attached elsewhere. Amount Sent (E) is bank Out; Amount Received,
Payable and MR/PC allocation totals are not substituted. Preserve row identity,
all display values and proof links; month-filtered view shows receiver, sender,
date, amount, combined narration (P, fallback M), account head (N), reference
and a source-row link. Existing published bank-specific CSV remains supported.
Do not edit the source Google Sheet, dropdowns, sharing or credentials.

## Banking compact view decision - 1 Nov 2026

Owner requested a compact modern Banking table, clearer buttons, Live Balance
and totals under every money column. Accounts and Recent activity have separate
views; received/receivable amount buttons open the existing CPR lists and detail.
Column totals use exact paisa and include available account figures. Incomplete
coverage must show the included/total account count and a partial marker; never
present missing balances as zero or a partial total as a complete bank balance.
If no balance is available, show Needs checking. Preserve all existing CPR
net/status rules, exports, linking and bank editing behavior.

## Banking: the banks, and what moves through them

### Banking CPR net and status - owner decision, 31 Oct 2026

Follow-up, 1 Nov: the owner wants the Banking tables compact like the Logistics
receipts table: smaller rows, tighter padding and headers that fit the width.
Read-only inspection of M&P's Payment_Report showed invoice totals repeated
on consignment rows, and row NetPayable is that row's RRAmount less that
repeated invoice. Summing those rows is not an authoritative bank payment;
the report also omits withholding fields. Correcting the payment source needs
the portal's payment summary, not a guessed deduction formula. Until that
source is verified, the existing M&P CPR net is not verified against the bank.

Resolved source, 1 Nov: the owner provided the consignment export and authorized
read-only study of the M&P portal. Its consolidated source is
`CustomerPortalAPI/api/reports/paymentinstrumentreport`, one row per payment.
The list's `NetPayable` is **before IBFT fee**; subtract `IBFTFee` once, as the
portal does. `TaxAmount` is withholding and is already reflected in that net.
The detail endpoint `paymentinstrumentdetailreport` returns the final net
in `paymentHead.netPayable` (do not subtract the fee again), invoice breakdown
and all consignments, including separate charge-only and COD-only rows.

- `mnpportal.js` reads the current public portal client's gateway credential
  into memory at runtime. No credential literal, new environment setting or
  browser session is stored. Responses must match the saved courier account.
- `mnplive.js` saves consolidated covers, never sums invoice/net columns from
  the old COD API. An IBFT instrument confirms receipt; a generated payment
  without that confirmed instrument remains pending.
- `migrations/001_courier_cpr_audit.sql` adds the company-scoped RLS audit table.
  Correction and audit commit together; QuickBooks receipt/journal fields are
  untouched. The existing budgeted keeper refreshes the last 120 days of M&P
  payment covers, correcting old sums and following pending payments.
- Logistics CPR gross, invoice, withholding, bank fee and net use those covers
  even when only some COD parcels are linked locally. Banking popup/Excel use
  the portal's full detail; invoice GST is labelled included in the invoice.
- `node tools/mnp-payments-check.mjs` and `node tools/mnp-store-check.mjs` check
  synthetic figures, account isolation, one-time migration, atomic audit,
  rollback, duplicate payments and the Logistics totals. A separate read-only
  live check matched the owner's CPR in both list and detail without using DB.

Banking reads the courier CPR's own `net_amount`, after the courier's charges,
GST, withholdings and other deductions. Never substitute a sum of parcel COD
for that bank amount. Logistics and Finance retain their existing calculations.

- **To receive is only generated pending CPRs**, confirmed by the owner on
  31 Oct. Delivered orders without a CPR are not Banking receivables.
- Confirmed, transferred, processed and the existing closed/paid/cleared
  statuses mean received. Pending/open CPRs stay receivable and never increase
  the balance. Unknown statuses are named for review rather than guessed paid.
- Received money follows the bank link effective on its payment date; pending
  CPRs follow the current bank. The opening date excludes earlier deposits.
- The Banking report is a read-only projection of CPR covers, manual entries
  and the live published spending CSV. Historical generated `bank_moves` are
  retained, not rewritten or counted a second time. Explicit old deposit bank
  corrections remain respected. No new tables or migrations are needed.
- Fiscal year In and Out accumulate actual movements from 1 July to 30 June.
  Live balance is opening plus actual received money and other movements,
  less expenses; pending CPRs are excluded. An unreadable spending sheet makes
  the balance unavailable and shows an error rather than a misleading total.
- Bank title is prominent, bank name underneath. Explicit received/receivable
  buttons open a separate list below the bank table; clicking a bank row does
  not expand it. CPR references open detail with an Excel download. Missing
  courier detail is shown as unavailable, never as a made-up zero.
- Refresh reads current CPR data and refreshes the CSV (a short in-memory cache
  otherwise avoids repeat calls). Returning to a visible tab after a minute
  refreshes it; no always-on database poller was added.
- `node tools/banking-check.mjs` and `node tools/banking-report-check.mjs` use
  synthetic data only; the latter stubs SQL and CSV, checking the report,
  status transitions, isolation and Excel without touching production.
  `node tools/banking-ui-check.mjs` executes the page script with a DOM stub
  to check separate lists and popup logic; it does not claim visual browser QA.

Asked for on 30 Oct 2026, with the reason attached: the management wants one
live report - every bank account, what is in it, what is still to come, what
has been paid and received **during the tax year** - instead of assembling it
by hand from fifty accounts.

**It is Fusion's own.** Every route asks `requireBoss`, `/banking.html` is
`'__boss__'` in `PAGE_NEED` (the one value that is not a right and cannot be
handed out), and the tile and the rail line are drawn for nobody else. A
client's own administrator is `admin` but not `boss`, and that is the
difference this uses.

Three feeds and no more, which is the whole design:

| | where it comes from |
|---|---|
| **opening** | typed once, with the day it is true of. **Nothing before that day is ever counted** - "wo balance ky pichy wali transaction bank na uthay" - so the figure typed in stays the figure |
| **in** | the couriers: a receipt that has been paid |
| **out** | the spending sheet the company already keeps, read live from its published CSV |

and two by hand, because no feed can know them: a transfer between two banks
and an adjustment.

### A courier's money lands where it landed, not where it lands now

`bank_links` is one dated row per change, never edited. A deposit is written
against the bank that account was paying into **on the day the receipt was
paid**, so changing the bank on 1 November does not move October's money - and
the rows themselves are the change log the screen shows, with who made each
change and when.

- **One receipt is one deposit anywhere.** The unique key is
  `(realm_id, source, ref)` and deliberately **not** the bank: with the bank in
  it, correcting the date a bank was changed from would leave the old deposit
  where it was and write a second one, and the same money would sit in two
  accounts.
- A payment that landed in the account a courier was told to stop using is
  **moved bank to bank** (`/api/bank/move`), not adjusted away.
- Receipts with nowhere to land are named rather than dropped: `homeless()`
  says which account, how much, and which of the two reasons it is - no bank
  set yet, or paid before the bank's opening date.

### The spending sheet is read, not retyped

`sheet_url` on a bank is a Google Sheet published as CSV. The headings are
found by their words (a date, an amount, something saying what it was for), the
CSV is parsed with quotes understood - `"Fuel, Lahore"` is one column - and the
date is read **day first, by hand**, never through `new Date()`.

A row's key is its day, its amount and its words, so **a row taken out of the
sheet comes off the bank too**: the sheet stays the record rather than becoming
a one-way import. The trade is that two genuinely identical payments on one day
are one row here, which is the price of not needing a column nobody keeps.

### The tax year

**1 July to 30 June, named by the year it ends in** - 1 July 2025 to 30 June
2026 is tax year 2026. `taxYear()` is the only thing that knows it, and every
"during the year" figure is cut by that and nothing else.

**What we owe is not in this app**, so the report says `payable: null` rather
than nought. A nought is a figure nobody can argue with and nobody should
trust.

