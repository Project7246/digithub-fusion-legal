// Everything the courier dashboard shows, read from our own table. The keeper
// keeps that table in step with the couriers, so this only ever talks to the
// database - which is why the page opens at once.

import { pool } from './db.js';
import { deductingCouriers } from './adapters.js';

const r2 = v => Math.round(Number(v || 0) * 100) / 100;

// What a parcel is worth to us, in SQL.
//
// Most couriers take their charges out of the money they send, so the parcel
// is worth its COD less the fee and the tax. **M&P do not**: they pay the
// whole COD and invoice their charges separately, so netting theirs off would
// understate what they owe by exactly their charges. `deductingCouriers()`
// is the one list, built from the adapters themselves, and the keys in it are
// our own identifiers - never anything typed in.
const DEDUCTS = deductingCouriers();
const NET_OF = '(o.amount - CASE WHEN o.courier IN (' +
  deductingCouriers().map(k => "'" + k + "'").join(',') +
  ') THEN COALESCE(o.fee,0) + COALESCE(o.tax,0) ELSE 0 END)';

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
// ==================== the money ====================
//
// The whole of it, in her words, and the code follows this line for line:
//
//   "jo parcels delivered hoy un ki payment ko minus krna h un sy jis ki
//    payment cpr k through hmy received hoi - ye hmra net receivable ka
//    formula h. ap taxes ko dkh lyna sth kiu k courier wly apna tax cut kr k
//    hmy payment dyty hn. delivered parcals hn un ki payment cpr k through
//    receive ni hoi - ye lazmi show krna."
//
// For any period:
//
//   parcels delivered in it      the COD the courier took at the door
//   less its charges             what it keeps for carrying them
//   less its tax                 it cuts this before it pays us
//   = receivable
//   less received on closed CPRs
//   = net receivable
//
// A CPR that is CLOSED is money received. OPEN or APPROVED is a CPR written
// and not yet paid. And the delivered parcels in **no** CPR at all are the
// ones to watch: "courier wly parcals ko delivered to show krwa dyty hn likn
// us ki payment hmy ni dyty."
//
// Three states, and every delivered parcel is in exactly one, so the three
// add back to what was delivered:
//
//   received   a closed CPR, or the courier's own settled flag
//   pending    a CPR exists for it and has not been paid
//   noCpr      no CPR at all. Delivered, and nothing said about the money.

const CPR_CLOSED = `EXISTS (SELECT 1 FROM courier_cprs c
                             WHERE c.realm_id = o.realm_id
                               AND c.account_id = o.account_id
                               AND c.cpr_number = o.cpr_number
                               AND UPPER(COALESCE(c.status, '')) = 'CLOSED')`;

const HAS_CPR = `(o.cpr_number IS NOT NULL AND o.cpr_number <> '')`;

// Received: a closed CPR, or the courier's own settled flag - which is how
// Trax and M&P pay, neither of them issuing a CPR at all.
const GOT_SQL     = `(o.settled IS TRUE OR (${HAS_CPR} AND ${CPR_CLOSED}))`;
const PENDING_SQL = `(NOT ${GOT_SQL} AND ${HAS_CPR})`;
const NOCPR_SQL   = `(NOT ${GOT_SQL} AND NOT ${HAS_CPR})`;
const PAID_SQL    = GOT_SQL;      // the name moneyWhere() knows it by

// One ageing band of what is still to come, by how long ago it was delivered.
function agePair(name, when) {
  const open = `NOT ${GOT_SQL}`;
  return `COUNT(*) FILTER (WHERE ${open} AND ${when}) AS ${name}_n,
          COALESCE(SUM(${NET_OF}) FILTER (WHERE ${open} AND ${when}),0) AS ${name}_v`;
}

// The statement for one period. `dates` cuts it on the **delivery** date,
// because that is the day the courier took the cash: a parcel booked in
// September and delivered in October is October's money.
async function parcelMoney(realmId, opts, dates) {
  const base = scope(realmId, opts);
  const args = base.args.slice();
  let where = base.where.join(' AND ') + ` AND o.status_group = 'delivered'`;

  if (dates && dates.from && dates.to) {
    args.push(dates.from); const a = args.length;
    args.push(dates.to);   const b = args.length;
    where += ` AND o.delivered_on >= $${a} AND o.delivered_on <= $${b}`;
  }

  const net = NET_OF;
  const pair = (name, when) =>
    `COUNT(*) FILTER (WHERE ${when}) AS ${name}_n,
     COALESCE(SUM(${net}) FILTER (WHERE ${when}),0) AS ${name}_v`;

  const r = await pool.query(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(o.amount),0) AS cod,
            COALESCE(SUM(o.fee),0)    AS fee,
            COALESCE(SUM(o.tax),0)    AS tax,

            ${pair('got',     GOT_SQL)},
            ${pair('pending', PENDING_SQL)},
            ${pair('nocpr',   NOCPR_SQL)},

            COUNT(DISTINCT o.cpr_number) FILTER (WHERE ${HAS_CPR}) AS cprs_n,
            MIN(o.delivered_on) FILTER (WHERE NOT ${GOT_SQL}) AS oldest_due,

            COUNT(*) FILTER (WHERE NOT ${GOT_SQL}
              AND o.delivered_on < CURRENT_DATE - 14) AS late_n,
            COALESCE(SUM(${net}) FILTER (WHERE NOT ${GOT_SQL}
              AND o.delivered_on < CURRENT_DATE - 14),0) AS late_v,

            ${agePair('a1', `o.delivered_on >= CURRENT_DATE - 7`)},
            ${agePair('a2', `o.delivered_on < CURRENT_DATE - 7 AND o.delivered_on >= CURRENT_DATE - 14`)},
            ${agePair('a3', `o.delivered_on < CURRENT_DATE - 14 AND o.delivered_on >= CURRENT_DATE - 30`)},
            ${agePair('a4', `o.delivered_on < CURRENT_DATE - 30 AND o.delivered_on >= CURRENT_DATE - 60`)},
            ${agePair('a5', `o.delivered_on < CURRENT_DATE - 60`)},
            ${agePair('a0', `o.delivered_on IS NULL`)}
       FROM courier_orders o
      WHERE ${where}`, args);

  const x = r.rows[0] || {};
  const cod = r2(x.cod), fee = r2(x.fee), tax = r2(x.tax);
  const receivable = r2(cod - fee - tax);
  const got = r2(x.got_v);

  return {
    delivered: Number(x.n || 0),
    cod, fee, tax,
    charges: r2(fee + tax),
    receivable,

    gotOrders: Number(x.got_n || 0),
    got,
    pendingOrders: Number(x.pending_n || 0),
    pending: r2(x.pending_v),
    noCprOrders: Number(x.nocpr_n || 0),
    noCpr: r2(x.nocpr_v),

    due: r2(receivable - got),
    dueOrders: Number(x.pending_n || 0) + Number(x.nocpr_n || 0),

    cprsSeen: Number(x.cprs_n || 0),
    oldestDue: day(x.oldest_due),
    lateOrders: Number(x.late_n || 0),
    lateAmount: r2(x.late_v),

    ageing: [
      { label: '0 \u2013 7 days',   n: Number(x.a1_n || 0), amount: r2(x.a1_v) },
      { label: '8 \u2013 14 days',  n: Number(x.a2_n || 0), amount: r2(x.a2_v) },
      { label: '15 \u2013 30 days', n: Number(x.a3_n || 0), amount: r2(x.a3_v) },
      { label: '31 \u2013 60 days', n: Number(x.a4_n || 0), amount: r2(x.a4_v) },
      { label: 'Over 60 days',      n: Number(x.a5_n || 0), amount: r2(x.a5_v), old: true },
      { label: 'No delivery date',  n: Number(x.a0_n || 0), amount: r2(x.a0_v), unknown: true }
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

// ==================== the money, as the CPRs state it ====================
//
// Said plainly, after three goes at it: "net receivble mn to bs wohi payment
// ay gai jis cprs ki payment ka status closed ni hoa. simple si bat h."
//
// And it is. PostEx writes a CPR for the parcels it has collected on. CLOSED
// means it has paid us; anything else means it has not. So what the carrier
// still owes is the CPRs that are not closed - not a sum worked out from the
// parcels, which only ever approximated it and needed every parcel matched to
// a CPR before it could be right.
//
// The parcels still answer their own question - how many went out, what they
// were worth, how they are doing - and that is what the Parcels tab and the
// COD figures are for. They are not the receivable.
// The CPRs themselves, for the same period: how many the courier issued in
// it, how many of those it has paid, how many are still open.
function cprScope(realmId, opts) {
  const where = [`c.realm_id = $1`];
  const args = [realmId];
  if (opts.account) { args.push(Number(opts.account)); where.push(`c.account_id = $${args.length}`); }
  if (opts.courier) { args.push(String(opts.courier)); where.push(`c.courier = $${args.length}`); }
  return { where, args };
}

const CLOSED = `UPPER(COALESCE(c.status, '')) = 'CLOSED'`;

async function cprMoney(realmId, opts, dates) {
  const base = cprScope(realmId, opts);
  const where = base.where.slice();
  const args = base.args.slice();

  if (dates && dates.from && dates.to) {
    args.push(dates.from); where.push(`c.created_on >= $${args.length}`);
    args.push(dates.to);   where.push(`c.created_on < ($${args.length}::date + 1)`);
  }

  const r = await pool.query(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(c.net_amount),0) AS v,
            COUNT(*) FILTER (WHERE ${CLOSED}) AS paid_n,
            COALESCE(SUM(c.net_amount) FILTER (WHERE ${CLOSED}),0) AS paid_v,
            COUNT(*) FILTER (WHERE NOT ${CLOSED}) AS due_n,
            COALESCE(SUM(c.net_amount) FILTER (WHERE NOT ${CLOSED}),0) AS due_v,
            MIN(c.created_on) FILTER (WHERE NOT ${CLOSED}) AS oldest_due
       FROM courier_cprs c
      WHERE ${where.join(' AND ')}`, args);

  const x = r.rows[0] || {};
  return {
    cprs: Number(x.n || 0),
    worth: r2(x.v),
    paidCprs: Number(x.paid_n || 0),
    paid: r2(x.paid_v),
    dueCprs: Number(x.due_n || 0),
    due: r2(x.due_v),
    oldestDue: day(x.oldest_due)
  };
}

// Month by month, on the same rule: the parcels delivered in that month, and
// what has and has not come back on them.
async function byMonth(realmId, opts) {
  const base = scope(realmId, opts);
  const net = NET_OF;

  const r = await pool.query(
    `SELECT to_char(date_trunc('month', o.delivered_on), 'YYYY-MM') AS m,
            COUNT(*) AS n,
            COALESCE(SUM(o.amount),0) AS cod,
            COALESCE(SUM(o.fee + o.tax),0) AS charges,
            COUNT(*) FILTER (WHERE ${GOT_SQL}) AS got_n,
            COALESCE(SUM(${net}) FILTER (WHERE ${GOT_SQL}),0) AS got_v,
            COUNT(*) FILTER (WHERE ${PENDING_SQL}) AS pending_n,
            COALESCE(SUM(${net}) FILTER (WHERE ${PENDING_SQL}),0) AS pending_v,
            COUNT(*) FILTER (WHERE ${NOCPR_SQL}) AS nocpr_n,
            COALESCE(SUM(${net}) FILTER (WHERE ${NOCPR_SQL}),0) AS nocpr_v
       FROM courier_orders o
      WHERE ${base.where.join(' AND ')}
        AND o.status_group = 'delivered'
        AND o.delivered_on IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC`, base.args);

  return r.rows.map(x => {
    const cod = r2(x.cod), charges = r2(x.charges);
    const receivable = r2(cod - charges);
    const got = r2(x.got_v);
    return {
      month: x.m,
      parcels: Number(x.n || 0),
      cod, charges, receivable,
      gotOrders: Number(x.got_n || 0),
      got,
      pendingOrders: Number(x.pending_n || 0),
      pending: r2(x.pending_v),
      noCprOrders: Number(x.nocpr_n || 0),
      noCpr: r2(x.nocpr_v),
      due: r2(receivable - got)
    };
  });
}

export async function moneyOwed(realmId, opts, dates) {
  const [range, ever, cprRange, cprEver, months, receipts] = await Promise.all([
    parcelMoney(realmId, opts, dates),
    parcelMoney(realmId, opts, null),
    cprMoney(realmId, opts, dates).catch(() => null),
    cprMoney(realmId, opts, null).catch(() => null),
    byMonth(realmId, opts).catch(() => []),
    receiptsOwed(realmId, opts).catch(() => null)
  ]);

  return { range, ever, cprRange, cprEver, months, receipts };
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
            -- kept apart as well as together: "what tax was deducted on this
            -- receipt" is the question asked of a CPR, and a single
            -- charges figure cannot answer it
            COALESCE(SUM(o.fee),0) AS fee,
            COALESCE(SUM(o.tax),0) AS tax,
            MAX(c.received_on)   AS received_on,
            MAX(c.qb_payment_id) AS qb_payment_id,
            MAX(c.status)        AS status,
            MAX(c.net_amount)    AS net_amount,
            MAX(c.remote_id)     AS remote_id,
            -- what the courier said about the payment itself: the gross it
            -- collected, what it kept, and where it sent the rest
            MAX(c.gross_amount)  AS gross_amount,
            MAX(c.charge_amount) AS charge_amount,
            MAX(c.instrument)    AS instrument,
            MAX(c.pay_mode)      AS pay_mode,
            MAX(c.paid_to_bank)  AS paid_to_bank,
            MAX(c.paid_to_account) AS paid_to_account,
            MAX(c.paid_to_name)  AS paid_to_name
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
      fee: r2(x.fee),
      tax: r2(x.tax),
      // What they actually paid against this receipt. A courier that deducts
      // pays the COD less its charges; M&P pay the whole COD and bill their
      // charges on an invoice of their own, so taking them off here would
      // show a receipt as smaller than the money that arrived.
      net: x.net_amount != null ? r2(x.net_amount)
         : (DEDUCTS.indexOf(x.courier) > -1 ? r2(amount - charges) : amount),
      status: x.status || '',
      remoteId: x.remote_id || null,
      inBooks: !!x.received_on,
      receivedOn: day(x.received_on),
      qbPaymentId: x.qb_payment_id || null,
      gross: x.gross_amount == null ? null : r2(x.gross_amount),
      charge: x.charge_amount == null ? null : r2(x.charge_amount),
      instrument: x.instrument || '',
      mode: x.pay_mode || '',
      paidToBank: x.paid_to_bank || '',
      paidToAccount: x.paid_to_account || '',
      paidToName: x.paid_to_name || ''
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

function moneyWhere(opts, where, args) {
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    where.push(`o.status_group = 'delivered'`);
    where.push(`NOT ${GOT_SQL}`);
  };

  // still to come: delivered, and no closed CPR has paid for it
  if (opts.due === '1' || opts.due === 1) open();

  // received: a closed CPR, or the courier's own settled flag
  if (opts.due === '0' || opts.due === 0) {
    where.push(`o.status_group = 'delivered'`);
    where.push(GOT_SQL);
  }

  // in a CPR, and that CPR has not been paid yet
  if (opts.pending === '1' || opts.pending === 1) {
    where.push(`o.status_group = 'delivered'`);
    where.push(PENDING_SQL);
  }

  // delivered and in no CPR at all - the ones the courier has said nothing
  // about, which is the list she asked to be able to see
  if (opts.nocpr === '1' || opts.nocpr === 1) {
    where.push(`o.status_group = 'delivered'`);
    where.push(NOCPR_SQL);
  }

  if (opts.late === '1' || opts.late === 1) {
    open();
    where.push(`o.delivered_on < CURRENT_DATE - 14`);
  }

  if (opts.age && AGE_WHERE[String(opts.age)]) {
    open();
    where.push(AGE_WHERE[String(opts.age)]);
  }

  // one span of delivery dates, which is how every money figure is cut
  if (args) {
    if (opts.dfrom) { args.push(opts.dfrom); where.push(`o.delivered_on >= $${args.length}`); }
    if (opts.dto)   { args.push(opts.dto);   where.push(`o.delivered_on <= $${args.length}`); }
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

    moneyWhere(opts, where, args);
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
  moneyWhere(opts, where, args);

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

/* ==================== the Logistics front page ==================== */
//
// What the section's own screen shows, and the figures beside the rail's
// lines. **Four queries in one Promise.all**, for the reason the delivery
// report gives: a front page that fires a dozen is a database that never
// sleeps, and the month's compute pays for it.
//
// Nothing here works a figure out in its own way. "Received" is GOT_SQL, the
// same sentence the statement and the ageing use - PostEx's closed CPR, or the
// courier's own settled flag, which is how Trax and M&P pay. One definition,
// so two screens cannot disagree about what is still owed.
export async function logisticsSummary(realmId, opts) {
  const base = scope(realmId, opts || {});
  const w = base.where.join(' AND ');
  const args = base.args;

  // A parcel still with the courier: not delivered, not sent back, not written
  // off. The same list the dashboard's "pending" uses.
  const MOVING = `o.status_group NOT IN
    ('delivered','returned','cancelled','expired','lost','damaged')`;

  const [parcels, money, byCourier, accounts] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE ${MOVING}) AS moving,
              -- whether a parcel was collected is a date the courier stamps,
              -- never something to be guessed from its status
              COUNT(*) FILTER (WHERE ${MOVING} AND o.picked_on IS NULL) AS unpicked,
              COUNT(*) FILTER (WHERE ${MOVING} AND o.picked_on IS NULL
                               AND o.booked_on < CURRENT_DATE - 2) AS unpicked_old,
              COUNT(*) FILTER (WHERE o.status_group = 'delivered'
                               AND o.delivered_on >= CURRENT_DATE - 7) AS delivered7,
              COUNT(*) FILTER (WHERE o.booked_on >= CURRENT_DATE - 7) AS booked7,
              COUNT(*) FILTER (WHERE o.status_group IN ('returned','returning')
                               AND o.booked_on >= CURRENT_DATE - 30) AS returns30,
              COUNT(*) FILTER (WHERE o.status_group = 'returning') AS returning,
              COUNT(*) FILTER (WHERE o.status_group IN ('lost','damaged')) AS trouble,
              MAX(o.seen_at) AS last_seen
         FROM courier_orders o WHERE ${w}`, args),

    pool.query(
      `SELECT COALESCE(SUM(${NET_OF})
                FILTER (WHERE NOT ${GOT_SQL}),0) AS owed,
              COUNT(*) FILTER (WHERE NOT ${GOT_SQL}) AS owed_n,
              COALESCE(SUM(${NET_OF})
                FILTER (WHERE NOT ${GOT_SQL}
                        AND o.delivered_on < CURRENT_DATE - 14),0) AS late,
              COUNT(*) FILTER (WHERE NOT ${GOT_SQL}
                        AND o.delivered_on < CURRENT_DATE - 14) AS late_n
         FROM courier_orders o
        WHERE ${w} AND o.status_group = 'delivered'`, args),

    // One row per courier **company**, not per account: PostEx against Trax by
    // name, rather than two PostEx accounts to be added up by eye.
    pool.query(
      `SELECT o.courier,
              COUNT(*) FILTER (WHERE o.booked_on >= CURRENT_DATE - 30) AS parcels,
              COUNT(*) FILTER (WHERE o.status_group = 'delivered'
                               AND o.booked_on >= CURRENT_DATE - 30) AS delivered,
              COUNT(*) FILTER (WHERE o.status_group IN ('returned','returning')
                               AND o.booked_on >= CURRENT_DATE - 30) AS returned,
              COUNT(*) FILTER (WHERE ${MOVING}) AS moving,
              COALESCE(SUM(o.fee + o.tax) FILTER (WHERE o.booked_on >= CURRENT_DATE - 30),0) AS charges,
              COALESCE(SUM(${NET_OF})
                FILTER (WHERE o.status_group = 'delivered' AND NOT ${GOT_SQL}),0) AS owed
         FROM courier_orders o WHERE ${w}
        GROUP BY o.courier ORDER BY 2 DESC`, args),

    // The accounts themselves, for the line that says what is waiting on
    // somebody. A webhook that has not called in a day is the quiet failure
    // worth naming: nothing breaks, the parcels simply stop moving.
    pool.query(
      `SELECT id, courier, label, last_error, last_sync, hook_at,
              (portal_secret IS NOT NULL) AS portal_ready
         FROM courier_accounts
        WHERE realm_id = $1 AND active IS TRUE
        ORDER BY courier, label`, [realmId])
  ]);

  const p = parcels.rows[0] || {};
  const m = money.rows[0] || {};
  const n = v => Number(v || 0);

  return {
    parcels: {
      moving: n(p.moving),
      unpicked: n(p.unpicked),
      unpickedOld: n(p.unpicked_old),
      delivered7: n(p.delivered7),
      booked7: n(p.booked7),
      returns30: n(p.returns30),
      returning: n(p.returning),
      trouble: n(p.trouble),
      lastSeen: p.last_seen || null
    },
    money: {
      owed: r2(m.owed), owedCount: n(m.owed_n),
      late: r2(m.late), lateCount: n(m.late_n)
    },
    couriers: byCourier.rows.map(x => ({
      courier: x.courier,
      parcels: n(x.parcels),
      delivered: n(x.delivered),
      returned: n(x.returned),
      moving: n(x.moving),
      charges: r2(x.charges),
      owed: r2(x.owed)
    })),
    accounts: accounts.rows.map(a => ({
      id: a.id,
      courier: a.courier,
      label: a.label,
      error: a.last_error || null,
      lastSync: a.last_sync || null,
      hookAt: a.hook_at || null,
      portalReady: a.portal_ready === true
    }))
  };
}
