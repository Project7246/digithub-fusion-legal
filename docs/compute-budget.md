# Neon's compute hours, and who spends them

Moved out of CLAUDE.md on 4 Nov 2026, word for word, so that a task reads only
the module it touches. Nothing here was changed, reworded or dropped - see the
index in CLAUDE.md. Read this file before working on this module.

## 6 Nov 2026 - Singapore cutover baseline

The DigitalOcean app moved to SGP1 and the database connection moved to Neon
`Fusion Singapore` (`wispy-dream-34764792`, AWS ap-southeast-1). The owner enabled
maintenance, ran the guarded final copy and saved the new connection; configuration
deployment went live at 11:14:57 PKT. Ohio stays read-only for rollback.

The post-cutover Settings screenshot showed 105.1 MB (10.3% of its configured
1024 MB display limit) and approximately 35.4 of 100 estimated compute hours,
176 wake-ups and 9.9 hours attributed to background sweeps. The shown 199.8
hours/month is a projection, not observed future usage. `compute_meter` history
was copied from Ohio, so these totals include pre-migration activity and are not
Neon's Singapore-project billing counter. The snapshot does not establish savings.

Compare elapsed-time usage deltas over the following days with Neon console
metrics; keep manual migration/copy activity separate. No new polling or compute
configuration change was added. Measure any reduction before reporting it.

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

## The month's compute, and who was actually spending it

Found on 30 Oct 2026, with the couriers apparently broken: `/api/courier/keeper`
said **134 of 100 hours used**, `holding: true`, and the courier sweep had spent
**5.3** of those hours. So the sweep that had been switched off to save the
month was not the one spending it - and because M&P have no webhooks and must be
polled, M&P simply stopped. That is what "the data is not up to date" and the
CPRs ending on the 26th were.

**The Shopify sweep was the spender.** It ran every ten minutes for ever,
whatever the meter said, and ten minutes is longer than Neon's five-minute idle
window - so every pass was its own spell: 144 wake-ups a day, about six minutes
each, to ask an empty queue whether anything had arrived. The meter could not
see it, because it only counted the keeper's own `beginBackground`/
`endBackground` seconds.

It is background work now and says so: counted through the same pair, rested on
`nextGapMinutes()` rather than a flat ten minutes, and held off at an hour
apiece once the month is spent. A backlog in flight is still worked through at
four seconds a batch - that is finite and somebody is waiting for it.

**The rule this leaves behind**: anything that wakes the database on a timer
must be measured by `compute.js` and paced by its budget. A new always-on poller
that is not is a standing charge the meter will blame on something else.

