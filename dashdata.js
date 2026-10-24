// Everything the courier dashboard shows, read from our own table. The keeper
// keeps that table in step with the couriers, so this only ever talks to the
// database - which is why the page opens at once.

import { pool } from './db.js';

const r2 = v => Math.round(Number(v || 0) * 100) / 100;
const day = v => v ? new Date(v).toISOString().slice(0, 10) : null;

function nextDay(s) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// the same where-clause everywhere, built once
function scope(realmId, opts) {
  const where = ['o.realm_id = $1'];
  const args = [realmId];

  if (opts.account) { args.push(Number(opts.account)); where.push(`o.account_id = $${args.length}`); }
  if (opts.courier) { args.push(String(opts.courier)); where.push(`o.courier = $${args.length}`); }

  return { where, args };
}

/* ==================== the whole picture ==================== */

export async function dashboard(realmId, opts) {
  const { from, to } = opts;
  const base = scope(realmId, opts);

  const w = base.where.join(' AND ');
  const args = base.args.slice();

  // dates come after whatever the scope needed
  args.push(from); const iFrom = args.length;
  args.push(to);   const iTo = args.length;

  const booked = `${w} AND o.booked_on >= $${iFrom} AND o.booked_on <= $${iTo}`;

  /* ---------- what each status is worth ---------- */

  const statuses = await pool.query(
    `SELECT o.status, o.status_group,
            COUNT(*) AS n,
            COALESCE(SUM(o.amount),0) AS amount
       FROM courier_orders o WHERE ${booked}
      GROUP BY o.status, o.status_group
      ORDER BY n DESC`, args);

  const groups = await pool.query(
    `SELECT o.status_group,
            COUNT(*) AS n,
            COALESCE(SUM(o.amount),0) AS amount
       FROM courier_orders o WHERE ${booked}
      GROUP BY o.status_group ORDER BY n DESC`, args);

  /* ---------- the totals ---------- */

  const totals = await pool.query(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(o.amount),0) AS amount,
            COALESCE(SUM(o.fee),0) AS fee,
            COALESCE(SUM(o.tax),0) AS tax,
            -- whether a parcel was collected is a date the courier stamps,
            -- not something to be guessed from its status
            COUNT(*) FILTER (WHERE o.picked_on IS NOT NULL) AS picked,
            COALESCE(SUM(o.amount) FILTER (WHERE o.picked_on IS NULL),0) AS unpicked_amount,
            COUNT(*) FILTER (WHERE o.picked_on IS NULL) AS unpicked,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered'),0) AS delivered_amount,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group NOT IN
              ('delivered','returned','cancelled','expired','lost','damaged')),0) AS pending_amount,
            COUNT(*) FILTER (WHERE o.status_group NOT IN
              ('delivered','returned','cancelled','expired','lost','damaged')) AS pending_orders,
            MAX(o.seen_at) AS last_seen
       FROM courier_orders o WHERE ${booked}`, args);

  /* ---------- day by day: booked, delivered, returned, and what each is worth ---------- */

  const daily = await pool.query(
    `WITH b AS (
       SELECT o.booked_on AS d, COUNT(*) AS n, COALESCE(SUM(o.amount),0) AS amt
         FROM courier_orders o WHERE ${booked} GROUP BY o.booked_on),
     dl AS (
       SELECT o.delivered_on AS d, COUNT(*) AS n, COALESCE(SUM(o.amount),0) AS amt
         FROM courier_orders o
        WHERE ${w} AND o.status_group = 'delivered'
          AND o.delivered_on >= $${iFrom} AND o.delivered_on <= $${iTo}
        GROUP BY o.delivered_on),
     rt AS (
       SELECT o.delivered_on AS d, COUNT(*) AS n, COALESCE(SUM(o.amount),0) AS amt
         FROM courier_orders o
        WHERE ${w} AND o.status_group = 'returned'
          AND o.delivered_on >= $${iFrom} AND o.delivered_on <= $${iTo}
        GROUP BY o.delivered_on),
     pk AS (
       SELECT o.picked_on AS d, COUNT(*) AS n, COALESCE(SUM(o.amount),0) AS amt
         FROM courier_orders o
        WHERE ${w} AND o.picked_on >= $${iFrom} AND o.picked_on <= $${iTo}
        GROUP BY o.picked_on)
     SELECT COALESCE(b.d, dl.d, rt.d, pk.d) AS day,
            COALESCE(b.n,0) AS booked,       COALESCE(b.amt,0)  AS booked_amount,
            COALESCE(dl.n,0) AS delivered,   COALESCE(dl.amt,0) AS delivered_amount,
            COALESCE(rt.n,0) AS returned,    COALESCE(rt.amt,0) AS returned_amount,
            COALESCE(pk.n,0) AS picked,      COALESCE(pk.amt,0) AS picked_amount
       FROM b
       FULL OUTER JOIN dl ON dl.d = b.d
       FULL OUTER JOIN rt ON rt.d = COALESCE(b.d, dl.d)
       FULL OUTER JOIN pk ON pk.d = COALESCE(b.d, dl.d, rt.d)
      ORDER BY 1`, args);

  /* ---------- where the parcels went ---------- */

  const cities = await pool.query(
    `SELECT o.city,
            COUNT(*) AS n,
            COUNT(*) FILTER (WHERE o.status_group = 'delivered') AS delivered,
            COUNT(*) FILTER (WHERE o.status_group = 'returned') AS returned,
            COUNT(*) FILTER (WHERE o.status_group IN ('lost','damaged')) AS lost,
            COUNT(*) FILTER (WHERE o.status_group IN
              ('unbooked','booked','transit','review','returning')) AS moving,
            COALESCE(SUM(o.amount),0) AS booked_amount,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered'),0) AS amount,
            COALESCE(SUM(o.fee)  FILTER (WHERE o.status_group = 'delivered'),0) AS fee,
            COALESCE(SUM(o.tax)  FILTER (WHERE o.status_group = 'delivered'),0) AS tax
       FROM courier_orders o
      WHERE ${booked} AND o.city IS NOT NULL AND o.city <> ''
      GROUP BY o.city ORDER BY n DESC LIMIT 200`, args);

  /* ---------- one row per account ---------- */

  const accounts = await pool.query(
    `SELECT o.account_id, a.label, a.courier,
            COUNT(*) AS orders,
            COUNT(*) FILTER (WHERE o.status_group = 'delivered') AS delivered,
            COUNT(*) FILTER (WHERE o.status_group = 'returned') AS returned,
            COALESCE(SUM(o.amount),0) AS amount,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered'),0) AS delivered_amount,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group NOT IN
              ('delivered','returned','cancelled','expired','lost','damaged')),0) AS pending_amount,
            COALESCE(SUM(o.fee),0) AS fee,
            COALESCE(SUM(o.tax),0) AS tax
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
      WHERE ${booked}
      GROUP BY o.account_id, a.label, a.courier
      ORDER BY orders DESC`, args);

  /* ---------- one row per courier company ---------- */
  // Two PostEx accounts are one PostEx. "All courier companies" is asked by
  // their names, not by ours, so the question "how is PostEx doing against
  // M&P" has an answer that does not need adding up by eye.
  const byCourier = await pool.query(
    `SELECT o.courier,
            COUNT(DISTINCT o.account_id) AS accounts,
            COUNT(*) AS orders,
            COUNT(*) FILTER (WHERE o.status_group = 'delivered') AS delivered,
            COUNT(*) FILTER (WHERE o.status_group = 'returned') AS returned,
            COUNT(*) FILTER (WHERE o.status_group IN
              ('unbooked','booked','transit','review','returning')) AS moving,
            COALESCE(SUM(o.amount),0) AS amount,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered'),0) AS delivered_amount,
            COALESCE(SUM(o.fee + o.tax) FILTER (WHERE o.status_group = 'delivered'),0) AS charges,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered'
              AND o.settled IS NOT TRUE),0) AS due_cod,
            COALESCE(SUM(o.fee + o.tax) FILTER (WHERE o.status_group = 'delivered'
              AND o.settled IS NOT TRUE),0) AS due_charges,
            COUNT(*) FILTER (WHERE o.status_group = 'delivered' AND o.settled IS NOT TRUE) AS due_n
       FROM courier_orders o
      WHERE ${booked}
      GROUP BY o.courier
      ORDER BY orders DESC`, args);

  /* ---------- money that has actually moved, newest first ---------- */

  const recent = await pool.query(
    `SELECT o.tracking, o.order_ref, o.amount, o.status, o.status_group,
            o.city, o.delivered_on, a.label
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
      WHERE ${w} AND o.status_group = 'delivered' AND o.delivered_on IS NOT NULL
      ORDER BY o.delivered_on DESC, o.tracking DESC
      LIMIT 12`, base.args);

  /* ---------- the day laid out, quiet days and all ---------- */

  const byDay = {};
  daily.rows.forEach(x => {
    const d = day(x.day);
    if (d) byDay[d] = x;
  });

  const days = [];
  let cur = from, guard = 0;
  while (cur <= to && guard < 400) {
    const x = byDay[cur];
    days.push({
      day: cur,
      booked: x ? Number(x.booked) : 0,
      bookedAmount: x ? r2(x.booked_amount) : 0,
      delivered: x ? Number(x.delivered) : 0,
      deliveredAmount: x ? r2(x.delivered_amount) : 0,
      returned: x ? Number(x.returned) : 0,
      returnedAmount: x ? r2(x.returned_amount) : 0,
      picked: x ? Number(x.picked) : 0,
      pickedAmount: x ? r2(x.picked_amount) : 0
    });
    cur = nextDay(cur); guard++;
  }

  const t = totals.rows[0] || {};
  const g = {};
  groups.rows.forEach(x => { g[x.status_group || 'other'] = x; });
  const gc = k => (g[k] ? Number(g[k].n) : 0);

  const settled = gc('delivered') + gc('returned');

  // What the courier is holding that is ours.
  //
  // This is the number the whole page was missing. Everything else here says
  // where parcels got to; this says what that is worth to us and how much of
  // it has actually come back:
  //
  //   COD on delivered parcels    what the courier collected at the door
  //   less their charges          what they keep for carrying it
  //   = net payable               what they owe us
  //   less what they have settled  parcels marked paid, or on a receipt
  //   = still to receive          the figure to chase them for
  //
  // And it is asked twice. Once inside the dates on screen, because that is
  // the range being looked at - and once with no dates at all, because money
  // owed from last month is still owed today and a date filter is no reason
  // to leave it off the screen.
  const money = await moneyOwed(realmId, opts, { from, to });

  return {
    from, to,
    money,
    totals: {
      orders: Number(t.orders || 0),
      picked: Number(t.picked || 0),
      unpicked: Number(t.unpicked || 0),
      unpickedAmount: r2(t.unpicked_amount),
      amount: r2(t.amount),
      fee: r2(t.fee),
      tax: r2(t.tax),
      deliveredAmount: r2(t.delivered_amount),
      pendingAmount: r2(t.pending_amount),
      pendingOrders: Number(t.pending_orders || 0),
      delivered: gc('delivered'),
      returned: gc('returned'),
      successRate: settled ? r2(100 * gc('delivered') / settled) : 0,
      lastSeen: t.last_seen
    },
    groups: groups.rows.map(x => ({
      group: x.status_group || 'other',
      count: Number(x.n),
      amount: r2(x.amount)
    })),
    statuses: statuses.rows.map(x => ({
      status: x.status || '(blank)',
      group: x.status_group || 'other',
      count: Number(x.n),
      amount: r2(x.amount)
    })),
    days,
    // Where the parcels go, and how each city actually behaves. These
    // percentages decide which courier gets which city's parcels, so every
    // one of them is worked out from settled orders only - a city with
    // fifty parcels still in transit should not look like a failure.
    cities: cities.rows.map(x => {
      const n         = Number(x.n);
      const delivered = Number(x.delivered);
      const returned  = Number(x.returned);
      const lost      = Number(x.lost);
      const settled   = delivered + returned;
      const pct = (part, whole) => whole ? r2(100 * part / whole) : 0;

      return {
        city:          x.city,
        count:         n,
        delivered,
        returned,
        lost,
        moving:        Number(x.moving),
        settled,
        bookedAmount:  r2(x.booked_amount),
        amount:        r2(x.amount),
        fee:           r2(x.fee),
        tax:           r2(x.tax),
        rate:          pct(delivered, settled),   // of what is settled
        returnRate:    pct(returned, settled),
        lostRate:      pct(lost, n),
        movingRate:    pct(Number(x.moving), n)
      };
    }),
    accounts: accounts.rows.map(x => ({
      id: x.account_id,
      label: x.label,
      courier: x.courier,
      orders: Number(x.orders),
      delivered: Number(x.delivered),
      returned: Number(x.returned),
      amount: r2(x.amount),
      deliveredAmount: r2(x.delivered_amount),
      pendingAmount: r2(x.pending_amount),
      fee: r2(x.fee),
      tax: r2(x.tax),
      successRate: (Number(x.delivered) + Number(x.returned))
        ? r2(100 * Number(x.delivered) / (Number(x.delivered) + Number(x.returned)))
        : 0
    })),
    couriers: byCourier.rows.map(x => {
      const cod = r2(x.delivered_amount), charges = r2(x.charges);
      const dueCod = r2(x.due_cod), dueCharges = r2(x.due_charges);
      return {
        courier: x.courier,
        accounts: Number(x.accounts),
        orders: Number(x.orders),
        delivered: Number(x.delivered),
        returned: Number(x.returned),
        moving: Number(x.moving),
        amount: r2(x.amount),
        deliveredAmount: cod,
        charges,
        net: r2(cod - charges),
        dueOrders: Number(x.due_n),
        due: r2(dueCod - dueCharges),
        settledAmount: r2((cod - charges) - (dueCod - dueCharges)),
        successRate: (Number(x.delivered) + Number(x.returned))
          ? r2(100 * Number(x.delivered) / (Number(x.delivered) + Number(x.returned)))
          : 0
      };
    }),
    recent: recent.rows.map(x => ({
      tracking: x.tracking,
      orderRef: x.order_ref,
      amount: r2(x.amount),
      status: x.status,
      statusGroup: x.status_group,
      city: x.city,
      account: x.label,
      on: day(x.delivered_on)
    }))
  };
}

/* ==================== what the courier still owes ==================== */

// Asked of the delivered parcels, because a parcel that did not arrive
// collected nothing. `settled` is the courier's own word for "we have paid
// this one out" - PostEx says so on its payment call, Trax on its payment
// webhook, M&P by handing back a PaymentID - and a receipt number on the row
// says the same thing a second way, so either counts.
// When is a delivered parcel paid for?
//
// A CPR number on a parcel is not payment, and reading it as one was wrong.
// PostEx issues a CPR as APPROVED when it means to pay and marks it CLOSED
// once it has, and that is how the merchant reads it: "jis cpr k agy status
// close likha hoa h is ka mtlb un cprs ki paymnt hmy receive ho gai... bs jis
// k agy approve likha hoa h us ki payment show ho gi". So an approved CPR is
// still money to come, and it belongs in the receivable.
//
// A cpr number we hold no advice for stays paid, which is how Trax and M&P
// arrive: their payment webhook and M&P's PaymentID are written only once the
// money is out, and there is no CPR document on our side to read a status off.
const CLOSED_CPR = `UPPER(COALESCE(c.status, '')) = 'CLOSED'`;
const OPEN_CPR = `EXISTS (SELECT 1 FROM courier_cprs c
                           WHERE c.realm_id = o.realm_id
                             AND c.account_id = o.account_id
                             AND c.cpr_number = o.cpr_number
                             AND NOT (${CLOSED_CPR}))`;
const PAID_SQL =
  `(o.settled IS TRUE OR (o.cpr_number IS NOT NULL AND o.cpr_number <> ''
     AND NOT ${OPEN_CPR}))`;

// One ageing bucket: how many parcels are in it and what is still receivable
// on them. The amount is the COD less that parcel's own charges, which is the
// same arithmetic as the statement above it - so the buckets add up to the net
// receivable exactly, and a column of figures that does not tie out is a
// column nobody trusts.
function agePair(name, when, paid) {
  const open = `o.status_group = 'delivered' AND NOT ${paid}`;
  return `COUNT(*) FILTER (WHERE ${open} AND ${when}) AS ${name}_n,
          COALESCE(SUM(o.amount - o.fee - o.tax) FILTER (WHERE ${open} AND ${when}),0) AS ${name}_v`;
}

async function owedQuery(realmId, opts, dates) {
  const base = scope(realmId, opts);
  const args = base.args.slice();
  let where = base.where.join(' AND ');

  if (dates && dates.from && dates.to) {
    args.push(dates.from); const a = args.length;
    args.push(dates.to);   const b = args.length;
    where += ` AND o.booked_on >= $${a} AND o.booked_on <= $${b}`;
  }

  const paid = PAID_SQL;

  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE o.status_group = 'delivered') AS delivered_n,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered'),0) AS cod,
            COALESCE(SUM(o.fee + o.tax) FILTER (WHERE o.status_group = 'delivered'),0) AS charges,

            COUNT(*) FILTER (WHERE o.status_group = 'delivered' AND ${paid}) AS paid_n,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered' AND ${paid}),0) AS paid_cod,
            COALESCE(SUM(o.fee + o.tax) FILTER (WHERE o.status_group = 'delivered' AND ${paid}),0) AS paid_charges,

            COUNT(*) FILTER (WHERE o.status_group = 'delivered' AND NOT ${paid}) AS due_n,
            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered' AND NOT ${paid}),0) AS due_cod,
            COALESCE(SUM(o.fee + o.tax) FILTER (WHERE o.status_group = 'delivered' AND NOT ${paid}),0) AS due_charges,

            MIN(o.delivered_on) FILTER (WHERE o.status_group = 'delivered' AND NOT ${paid}) AS oldest_due,

            COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered' AND NOT ${paid}
              AND o.delivered_on < CURRENT_DATE - 14),0) AS late_cod,
            COUNT(*) FILTER (WHERE o.status_group = 'delivered' AND NOT ${paid}
              AND o.delivered_on < CURRENT_DATE - 14) AS late_n,

            -- The ageing of what is still receivable, by how long ago the
            -- parcel was delivered. This is how a receivable is read in any
            -- set of books: not one figure but five, because money a week old
            -- and money three months old are not the same money. The buckets
            -- are cut on the delivery date, since that is the day the courier
            -- took our cash and the debt began.
            ${agePair('a1', `o.delivered_on >= CURRENT_DATE - 7`, paid)},
            ${agePair('a2', `o.delivered_on < CURRENT_DATE - 7 AND o.delivered_on >= CURRENT_DATE - 14`, paid)},
            ${agePair('a3', `o.delivered_on < CURRENT_DATE - 14 AND o.delivered_on >= CURRENT_DATE - 30`, paid)},
            ${agePair('a4', `o.delivered_on < CURRENT_DATE - 30 AND o.delivered_on >= CURRENT_DATE - 60`, paid)},
            ${agePair('a5', `o.delivered_on < CURRENT_DATE - 60`, paid)},
            ${agePair('a0', `o.delivered_on IS NULL`, paid)}
       FROM courier_orders o
      WHERE ${where}`, args);

  const x = r.rows[0] || {};
  const cod = r2(x.cod), charges = r2(x.charges);
  const paidCod = r2(x.paid_cod), paidCharges = r2(x.paid_charges);
  const dueCod = r2(x.due_cod), dueCharges = r2(x.due_charges);

  return {
    delivered: Number(x.delivered_n || 0),
    cod,
    charges,
    net: r2(cod - charges),
    paidOrders: Number(x.paid_n || 0),
    paid: r2(paidCod - paidCharges),
    dueOrders: Number(x.due_n || 0),
    dueCod,
    dueCharges,
    due: r2(dueCod - dueCharges),
    oldestDue: day(x.oldest_due),
    lateOrders: Number(x.late_n || 0),
    lateCod: r2(x.late_cod),
    ageing: [
      { label: '0 – 7 days',    n: Number(x.a1_n || 0), amount: r2(x.a1_v) },
      { label: '8 – 14 days',   n: Number(x.a2_n || 0), amount: r2(x.a2_v) },
      { label: '15 – 30 days',  n: Number(x.a3_n || 0), amount: r2(x.a3_v) },
      { label: '31 – 60 days',  n: Number(x.a4_n || 0), amount: r2(x.a4_v) },
      { label: 'Over 60 days',  n: Number(x.a5_n || 0), amount: r2(x.a5_v), old: true },
      { label: 'Delivery date not given', n: Number(x.a0_n || 0), amount: r2(x.a0_v), unknown: true }
    ]
  };
}

// What the receipts themselves say: the courier has paid these out, and this
// much of that has been written into QuickBooks. A receipt sitting here with
// no QuickBooks payment against it is money in the bank that the books do not
// know about yet, which is a different job from chasing the courier.
async function receiptsOwed(realmId, opts) {
  const where = ['c.realm_id = $1'];
  const args = [realmId];

  if (opts.account) { args.push(Number(opts.account)); where.push(`c.account_id = $${args.length}`); }
  if (opts.courier) { args.push(String(opts.courier)); where.push(`c.courier = $${args.length}`); }

  const r = await pool.query(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(COALESCE(c.cod_amount, c.net_amount)),0) AS worth,
            -- the carrier's own two words: CLOSED is paid, anything else is
            -- still to come, and the merchant reads the list that way
            COUNT(*) FILTER (WHERE UPPER(COALESCE(c.status,'')) = 'CLOSED') AS closed_n,
            COALESCE(SUM(COALESCE(c.cod_amount, c.net_amount))
              FILTER (WHERE UPPER(COALESCE(c.status,'')) = 'CLOSED'),0) AS closed_v,
            COUNT(*) FILTER (WHERE UPPER(COALESCE(c.status,'')) <> 'CLOSED') AS open_n,
            COALESCE(SUM(COALESCE(c.cod_amount, c.net_amount))
              FILTER (WHERE UPPER(COALESCE(c.status,'')) <> 'CLOSED'),0) AS open_v,
            COUNT(*) FILTER (WHERE c.received_on IS NOT NULL) AS taken_n,
            COALESCE(SUM(COALESCE(c.received_amount, c.cod_amount, c.net_amount))
              FILTER (WHERE c.received_on IS NOT NULL),0) AS taken,
            COUNT(*) FILTER (WHERE c.received_on IS NULL) AS waiting_n,
            COALESCE(SUM(COALESCE(c.cod_amount, c.net_amount))
              FILTER (WHERE c.received_on IS NULL),0) AS waiting
       FROM courier_cprs c
      WHERE ${where.join(' AND ')}`, args);

  const x = r.rows[0] || {};
  return {
    receipts: Number(x.n || 0),
    worth: r2(x.worth),
    closed: Number(x.closed_n || 0),
    closedAmount: r2(x.closed_v),
    open: Number(x.open_n || 0),
    openAmount: r2(x.open_v),
    inBooks: Number(x.taken_n || 0),
    inBooksAmount: r2(x.taken),
    notInBooks: Number(x.waiting_n || 0),
    notInBooksAmount: r2(x.waiting)
  };
}

export async function moneyOwed(realmId, opts, dates) {
  const [range, ever, receipts] = await Promise.all([
    owedQuery(realmId, opts, dates),
    owedQuery(realmId, opts, null),
    receiptsOwed(realmId, opts).catch(() => null)
  ]);

  return { range, ever, receipts };
}

/* ==================== the receipts ==================== */

// this month's, for the small box on the dashboard
export async function recentCprs(realmId, opts) {
  const base = scope(realmId, opts);
  const where = base.where.concat([`o.cpr_number IS NOT NULL`, `o.cpr_number <> ''`]);
  const args = base.args.slice();

  if (opts.from) { args.push(opts.from); where.push(`o.settled_on >= $${args.length}`); }
  if (opts.to)   { args.push(opts.to);   where.push(`o.settled_on <= $${args.length}`); }

  // Built from the parcels themselves, which is what makes this work for every
  // courier: PostEx hands over a receipt from its portal, M&P hand back a
  // PaymentID on each consignment, Trax a payment id on a webhook - and all
  // three end up as a receipt number on the order. The receipt row in
  // courier_cprs is joined where there is one, for what was done with it in
  // QuickBooks, and its absence is not a problem: the parcels are the receipt.
  const r = await pool.query(
    `SELECT o.cpr_number, o.account_id, a.label, a.courier,
            MIN(o.settled_on) AS settled_on,
            COUNT(*) AS orders,
            COALESCE(SUM(o.amount),0) AS amount,
            COALESCE(SUM(o.fee + o.tax),0) AS charges,
            MAX(c.received_on)   AS received_on,
            MAX(c.qb_payment_id) AS qb_payment_id,
            MAX(c.status)        AS status,
            MAX(c.net_amount)    AS net_amount,
            MAX(c.remote_id)     AS remote_id
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
       LEFT JOIN courier_cprs c
              ON c.realm_id = o.realm_id
             AND c.account_id = o.account_id
             AND c.cpr_number = o.cpr_number
      WHERE ${where.join(' AND ')}
      GROUP BY o.cpr_number, o.account_id, a.label, a.courier
      ORDER BY MIN(o.settled_on) DESC NULLS LAST
      LIMIT ${Number(opts.limit) || 200}`, args);

  return r.rows.map(x => {
    const amount = r2(x.amount), charges = r2(x.charges);
    return {
      cpr: x.cpr_number,
      accountId: x.account_id,
      account: x.label,
      courier: x.courier,
      settledOn: day(x.settled_on),
      orders: Number(x.orders),
      amount,
      charges,
      net: x.net_amount == null ? r2(amount - charges) : r2(x.net_amount),
      status: x.status || '',
      remoteId: x.remote_id || null,
      inBooks: !!x.received_on,
      qbPaymentId: x.qb_payment_id || null
    };
  });
}

/* ==================== the delivery report ====================  */
//
// One question, asked four ways, and every one of them per courier company:
// where did the parcels get to, how long did each leg take, which cities are
// the trouble, and what happened day by day. It is kept to four queries on
// purpose - a report page that fires a dozen is a database that never sleeps,
// and the month's compute is what pays for that.
//
// Nothing here is PostEx's or M&P's vocabulary. The thirteen buckets in
// statuses.js are what a report counts, with the courier's own words kept
// beside them so a dispute can be settled with what the courier actually
// said.

export async function deliveryReport(realmId, opts) {
  const base = scope(realmId, opts);
  const w = base.where.join(' AND ');
  const args = base.args.slice();

  args.push(opts.from); const iFrom = args.length;
  args.push(opts.to);   const iTo = args.length;

  // Booked in the range. A parcel booked last week and delivered today is
  // this week's parcel: the date it was handed over is the one a merchant
  // counts a batch by.
  const inRange = `${w} AND o.booked_on >= $${iFrom} AND o.booked_on <= $${iTo}`;

  const [states, speed, cities, daily] = await Promise.all([
    /* ---- 1. every status, under its bucket, under its courier ---- */
    pool.query(
      `SELECT o.courier, o.status_group, COALESCE(o.status,'') AS status,
              COUNT(*) AS n,
              COALESCE(SUM(o.amount),0)       AS amount,
              COALESCE(SUM(o.fee + o.tax),0)  AS charges,
              COUNT(*) FILTER (WHERE o.settled IS TRUE
                                  OR COALESCE(o.cpr_number,'') <> '') AS paid
         FROM courier_orders o
        WHERE ${inRange}
        GROUP BY o.courier, o.status_group, COALESCE(o.status,'')
        ORDER BY n DESC`, args),

    /* ---- 2. how long each leg took ---- */
    // Three legs: with us until pickup, with the courier until the door, and
    // the whole journey. Counted only where both ends are known, because a
    // parcel with no pickup date is a missing date, not a same-day pickup.
    pool.query(
      `SELECT o.courier,
              COUNT(*) FILTER (WHERE o.picked_on IS NOT NULL
                                 AND o.booked_on IS NOT NULL) AS n_pick,
              AVG(o.picked_on - o.booked_on) FILTER (WHERE o.picked_on IS NOT NULL
                                 AND o.booked_on IS NOT NULL) AS d_pick,
              COUNT(*) FILTER (WHERE o.delivered_on IS NOT NULL
                                 AND o.picked_on IS NOT NULL) AS n_leg,
              AVG(o.delivered_on - o.picked_on) FILTER (WHERE o.delivered_on IS NOT NULL
                                 AND o.picked_on IS NOT NULL) AS d_leg,
              COUNT(*) FILTER (WHERE o.delivered_on IS NOT NULL
                                 AND o.booked_on IS NOT NULL) AS n_all,
              AVG(o.delivered_on - o.booked_on) FILTER (WHERE o.delivered_on IS NOT NULL
                                 AND o.booked_on IS NOT NULL) AS d_all,
              COUNT(*) FILTER (WHERE o.delivered_on - o.booked_on <= 2)            AS b_fast,
              COUNT(*) FILTER (WHERE o.delivered_on - o.booked_on BETWEEN 3 AND 5) AS b_ok,
              COUNT(*) FILTER (WHERE o.delivered_on - o.booked_on BETWEEN 6 AND 10) AS b_slow,
              COUNT(*) FILTER (WHERE o.delivered_on - o.booked_on > 10)            AS b_bad,
              COUNT(*) FILTER (WHERE o.status_group IN
                      ('booked','transit','returning','review')
                   AND o.booked_on < (CURRENT_DATE - 14))                          AS stuck
         FROM courier_orders o
        WHERE ${inRange}
        GROUP BY o.courier`, args),

    /* ---- 3. the cities, per courier ---- */
    pool.query(
      `SELECT o.courier, COALESCE(NULLIF(TRIM(o.city),''),'(no city)') AS city,
              COUNT(*) AS n,
              COUNT(*) FILTER (WHERE o.status_group = 'delivered') AS delivered,
              COUNT(*) FILTER (WHERE o.status_group = 'returned')  AS returned,
              COUNT(*) FILTER (WHERE o.status_group IN ('lost','damaged')) AS trouble,
              COALESCE(SUM(o.amount) FILTER (WHERE o.status_group = 'delivered'),0) AS amount
         FROM courier_orders o
        WHERE ${inRange}
        GROUP BY o.courier, 2
        ORDER BY n DESC
        LIMIT 600`, args),

    /* ---- 4. the days ---- */
    // Booked on the day, and - separately - delivered on the day and returned
    // on the day, because a parcel booked on Monday and delivered on Friday
    // belongs to both Monday and Friday and to neither alone.
    pool.query(
      `SELECT d::date AS day, courier,
              SUM(booked) AS booked, SUM(delivered) AS delivered, SUM(returned) AS returned,
              SUM(amount) AS amount
         FROM (
           SELECT o.booked_on AS d, o.courier, 1 AS booked, 0 AS delivered, 0 AS returned,
                  0::numeric AS amount
             FROM courier_orders o WHERE ${inRange} AND o.booked_on IS NOT NULL
           UNION ALL
           SELECT o.delivered_on, o.courier, 0, 1, 0, COALESCE(o.amount,0)
             FROM courier_orders o WHERE ${inRange} AND o.delivered_on IS NOT NULL
                  AND o.status_group = 'delivered'
           UNION ALL
           SELECT o.delivered_on, o.courier, 0, 0, 1, 0
             FROM courier_orders o WHERE ${inRange} AND o.delivered_on IS NOT NULL
                  AND o.status_group = 'returned'
         ) t
        WHERE d IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1`, args)
  ]);

  /* ---------- the buckets, rolled up per courier ---------- */

  const couriers = new Map();
  const get = key => {
    if (!couriers.has(key)) {
      couriers.set(key, {
        courier: key, orders: 0, amount: 0, charges: 0, paid: 0,
        groups: {}, statuses: []
      });
    }
    return couriers.get(key);
  };

  states.rows.forEach(x => {
    const c = get(x.courier);
    const n = Number(x.n), amount = r2(x.amount), charges = r2(x.charges);
    const g = x.status_group || 'other';

    c.orders += n; c.amount += amount; c.charges += charges;
    c.paid += Number(x.paid);

    const had = c.groups[g] || { n: 0, amount: 0, charges: 0 };
    c.groups[g] = { n: had.n + n, amount: r2(had.amount + amount),
                    charges: r2(had.charges + charges) };

    // the courier's own word for it, kept so a report can be argued with
    c.statuses.push({ status: x.status, group: g, n, amount, charges });
  });

  speed.rows.forEach(x => {
    const c = get(x.courier);
    const avg = v => v == null ? null : Math.round(Number(v) * 10) / 10;
    c.speed = {
      toPickup:   { days: avg(x.d_pick), of: Number(x.n_pick) },
      onTheRoad:  { days: avg(x.d_leg),  of: Number(x.n_leg) },
      doorToDoor: { days: avg(x.d_all),  of: Number(x.n_all) },
      spread: {
        fast: Number(x.b_fast), ok: Number(x.b_ok),
        slow: Number(x.b_slow), bad: Number(x.b_bad)
      },
      // still moving, a fortnight after it was handed over
      stuck: Number(x.stuck)
    };
  });

  cities.rows.forEach(x => {
    const c = get(x.courier);
    (c.cities = c.cities || []).push({
      city: x.city,
      orders: Number(x.n),
      delivered: Number(x.delivered),
      returned: Number(x.returned),
      trouble: Number(x.trouble),
      amount: r2(x.amount),
      rate: (Number(x.delivered) + Number(x.returned))
        ? Math.round(1000 * Number(x.delivered) /
            (Number(x.delivered) + Number(x.returned))) / 10
        : null
    });
  });

  daily.rows.forEach(x => {
    const c = get(x.courier);
    (c.days = c.days || []).push({
      day: day(x.day),
      booked: Number(x.booked),
      delivered: Number(x.delivered),
      returned: Number(x.returned),
      amount: r2(x.amount)
    });
  });

  const list = [...couriers.values()].sort((a, b) => b.orders - a.orders);
  list.forEach(c => {
    c.statuses.sort((a, b) => b.n - a.n);
    c.cities = (c.cities || []).sort((a, b) => b.orders - a.orders);
    c.days = c.days || [];
    c.speed = c.speed || null;
  });

  return { from: opts.from, to: opts.to, couriers: list };
}

/* ==================== pickups, which stand in for load sheets ==================== */

export async function pickups(realmId, opts) {
  const base = scope(realmId, opts);
  const where = base.where.concat([`o.picked_on IS NOT NULL`]);
  const args = base.args.slice();

  if (opts.from) { args.push(opts.from); where.push(`o.picked_on >= $${args.length}`); }
  if (opts.to)   { args.push(opts.to);   where.push(`o.picked_on <= $${args.length}`); }

  const r = await pool.query(
    `SELECT o.picked_on AS day, o.account_id, a.label,
            COUNT(*) AS parcels,
            COALESCE(SUM(o.amount),0) AS amount,
            COUNT(*) FILTER (WHERE o.status_group = 'delivered') AS delivered,
            COUNT(*) FILTER (WHERE o.status_group = 'returned') AS returned
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
      WHERE ${where.join(' AND ')}
      GROUP BY o.picked_on, o.account_id, a.label
      ORDER BY o.picked_on DESC
      LIMIT ${Number(opts.limit) || 120}`, args);

  return r.rows.map(x => ({
    day: day(x.day),
    accountId: x.account_id,
    account: x.label,
    parcels: Number(x.parcels),
    amount: r2(x.amount),
    delivered: Number(x.delivered),
    returned: Number(x.returned)
  }));
}

// the parcels picked up on one day
export async function pickupOrders(realmId, opts) {
  const base = scope(realmId, opts);
  const args = base.args.slice();
  args.push(opts.day);

  const r = await pool.query(
    `SELECT o.tracking, o.order_ref, o.amount, o.status, o.status_group,
            o.city, o.booked_on, o.delivered_on, a.label
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
      WHERE ${base.where.join(' AND ')} AND o.picked_on = $${args.length}
      ORDER BY o.tracking
      LIMIT 2000`, args);

  const rows = r.rows.map(x => ({
    account: x.label,
    tracking: x.tracking,
    orderRef: x.order_ref,
    amount: r2(x.amount),
    status: x.status,
    statusGroup: x.status_group,
    city: x.city,
    bookedOn: day(x.booked_on),
    deliveredOn: day(x.delivered_on)
  }));

  return {
    day: opts.day,
    parcels: rows.length,
    amount: r2(rows.reduce((s, x) => s + x.amount, 0)),
    orders: rows
  };
}

/* ==================== the orders behind one number ==================== */

// The money filters, in one place.
//
// They were written out inside eachOrder (the download) and left out of
// ordersBy (the drawer) altogether - so every "click a line to see those
// parcels" on the statement opened **every** parcel in the range instead of
// the handful the figure was made of. The number said 254 and the drawer
// showed 3,000, which is worse than not opening at all: it teaches somebody
// that the figures on the page are not to be trusted.
//
// `due=1` is still receivable, `due=0` is remitted, `late=1` is the chase
// list, and `age` is one bucket of the ageing table.
const AGE_WHERE = {
  a1: `o.delivered_on >= CURRENT_DATE - 7`,
  a2: `o.delivered_on < CURRENT_DATE - 7 AND o.delivered_on >= CURRENT_DATE - 14`,
  a3: `o.delivered_on < CURRENT_DATE - 14 AND o.delivered_on >= CURRENT_DATE - 30`,
  a4: `o.delivered_on < CURRENT_DATE - 30 AND o.delivered_on >= CURRENT_DATE - 60`,
  a5: `o.delivered_on < CURRENT_DATE - 60`,
  a0: `o.delivered_on IS NULL`
};

function moneyWhere(opts, where) {
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    where.push(`o.status_group = 'delivered'`);
    where.push(`NOT ${PAID_SQL}`);
  };

  if (opts.due === '1' || opts.due === 1) open();
  if (opts.due === '0' || opts.due === 0) {
    where.push(`o.status_group = 'delivered'`);
    where.push(PAID_SQL);
  }
  if (opts.late === '1' || opts.late === 1) {
    open();
    where.push(`o.delivered_on < CURRENT_DATE - 14`);
  }
  // every parcel sitting under one CPR, paid or not
  if (opts.cprStatus === 'open' || opts.cprStatus === 'closed') {
    where.push(`o.cpr_number IS NOT NULL AND o.cpr_number <> ''`);
    where.push(opts.cprStatus === 'closed' ? `NOT ${OPEN_CPR}` : OPEN_CPR);
  }
  if (opts.age && AGE_WHERE[String(opts.age)]) {
    open();
    where.push(AGE_WHERE[String(opts.age)]);
  }
}

// The same rows as ordersBy but without its ceiling, handed over a page at a
// time so a month of parcels never sits in memory all at once. ordersBy stops
// at two thousand because a drawer cannot show more than that; a download is
// the opposite - it is worth having precisely because it is complete.
export async function eachOrder(realmId, opts, onBatch) {
  const PAGE = 2000;
  let after = null;          // (booked_on, tracking) of the last row sent
  let sent = 0;

  for (let guard = 0; guard < 500; guard++) {
    const base = scope(realmId, opts);
    const where = base.where.slice();
    const args = base.args.slice();

    if (opts.from) { args.push(opts.from); where.push(`o.booked_on >= $${args.length}`); }
    if (opts.to)   { args.push(opts.to);   where.push(`o.booked_on <= $${args.length}`); }
    if (opts.status) { args.push(opts.status); where.push(`o.status = $${args.length}`); }
    if (opts.city)   { args.push(opts.city);   where.push(`o.city = $${args.length}`); }
    if (opts.cpr)    { args.push(opts.cpr);    where.push(`o.cpr_number = $${args.length}`); }

    moneyWhere(opts, where);
    if (opts.picked === '1' || opts.picked === 1) where.push(`o.picked_on IS NOT NULL`);
    if (opts.picked === '0' || opts.picked === 0) where.push(`o.picked_on IS NULL`);

    if (opts.group) {
      const groups = String(opts.group).split(',').map(s => s.trim()).filter(Boolean);
      if (groups.length === 1) {
        args.push(groups[0]); where.push(`o.status_group = $${args.length}`);
      } else if (groups.length > 1) {
        args.push(groups); where.push(`o.status_group = ANY($${args.length})`);
      }
    }

    // Carrying on from the last row read, rather than OFFSET - an offset makes
    // the database walk everything it already skipped on every page.
    if (after) {
      args.push(after.day); args.push(after.tracking);
      where.push(`(o.booked_on, o.tracking) < ($${args.length - 1}::date, $${args.length})`);
    }

    const r = await pool.query(
      `SELECT o.tracking, o.order_ref, o.amount, o.fee, o.tax, o.status, o.status_group,
              o.city, o.booked_on, o.picked_on, o.delivered_on,
              o.settled_on, o.cpr_number, a.label
         FROM courier_orders o
         JOIN courier_accounts a ON a.id = o.account_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.booked_on DESC, o.tracking DESC
        LIMIT ${PAGE}`, args);

    if (!r.rows.length) break;

    const last = r.rows[r.rows.length - 1];
    after = { day: day(last.booked_on), tracking: last.tracking };

    await onBatch(r.rows.map(x => ({
      account: x.label,
      tracking: x.tracking,
      orderRef: x.order_ref,
      amount: r2(x.amount),
      fee: r2(x.fee),
      tax: r2(x.tax),
      status: x.status,
      statusGroup: x.status_group,
      city: x.city,
      bookedOn: day(x.booked_on),
      pickedOn: day(x.picked_on),
      deliveredOn: day(x.delivered_on),
      settledOn: day(x.settled_on),
      cprNumber: x.cpr_number
    })));

    sent += r.rows.length;
    if (r.rows.length < PAGE) break;
    if (!after.day) break;          // no booking date to page on, so stop here
  }

  return sent;
}

export async function ordersBy(realmId, opts) {
  const base = scope(realmId, opts);
  const where = base.where.slice();
  const args = base.args.slice();

  if (opts.from) { args.push(opts.from); where.push(`o.booked_on >= $${args.length}`); }
  if (opts.to)   { args.push(opts.to);   where.push(`o.booked_on <= $${args.length}`); }
  if (opts.status) { args.push(opts.status); where.push(`o.status = $${args.length}`); }
  // A stage on the dashboard is not always one group - "still moving" covers
  // five of them - so a comma-separated list is allowed.
  if (opts.group) {
    const groups = String(opts.group).split(',').map(s => s.trim()).filter(Boolean);
    if (groups.length === 1) {
      args.push(groups[0]); where.push(`o.status_group = $${args.length}`);
    } else if (groups.length > 1) {
      args.push(groups); where.push(`o.status_group = ANY($${args.length})`);
    }
  }
  if (opts.city)   { args.push(opts.city);   where.push(`o.city = $${args.length}`); }
  // '1' is collected, '0' is still sitting with the merchant
  if (opts.picked === '1' || opts.picked === 1) where.push(`o.picked_on IS NOT NULL`);
  if (opts.picked === '0' || opts.picked === 0) where.push(`o.picked_on IS NULL`);
  if (opts.cpr)    { args.push(opts.cpr);    where.push(`o.cpr_number = $${args.length}`); }
  // and the money ones, the same as the download uses
  moneyWhere(opts, where);

  const r = await pool.query(
    `SELECT o.tracking, o.order_ref, o.amount, o.fee, o.tax, o.status, o.status_group,
            o.city, o.booked_on, o.picked_on, o.delivered_on,
            o.settled_on, o.cpr_number, a.label
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.booked_on DESC NULLS LAST, o.tracking
      LIMIT 2000`, args);

  const rows = r.rows.map(x => ({
    account: x.label,
    tracking: x.tracking,
    orderRef: x.order_ref,
    amount: r2(x.amount),
    fee: r2(x.fee),
    tax: r2(x.tax),
    status: x.status,
    statusGroup: x.status_group,
    city: x.city,
    bookedOn: day(x.booked_on),
    pickedOn: day(x.picked_on),
    deliveredOn: day(x.delivered_on),
    settledOn: day(x.settled_on),
    cprNumber: x.cpr_number
  }));

  return {
    count: rows.length,
    amount: r2(rows.reduce((s, x) => s + x.amount, 0)),
    orders: rows
  };
}
