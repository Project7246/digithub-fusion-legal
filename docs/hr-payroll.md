# HR and payroll - decisions and behaviour

Moved out of CLAUDE.md on 4 Nov 2026, word for word, so that a task reads only
the module it touches. Nothing here was changed, reworded or dropped - see the
index in CLAUDE.md. Read this file before working on this module.
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

