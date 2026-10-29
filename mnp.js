// M&P - Muller & Phipps, who trade as M&P Express Logistics. Written against
// their own document, M&P COD API Manual, version 2025022404:
//
//   base      https://mnpcourier.com/mycodapi/api
//   sign-in   a username and password **in the call itself**, not a header
//   accounts  M&P give an account number (4T154) and, for the reports, a
//             location id - and both can be asked for rather than typed in
//
// Three things decide the shape of this file.
//
// **The sign-in is a pair, and it goes in the request.** GETs take it as query
// parameters, POSTs in the JSON body. Their own document spells the two names
// three different ways across the endpoints - `username`, `UserName`,
// `Username` - so every call sends all three. It costs nothing and it is the
// difference between working and a blank refusal.
//
// **A month is the unit, not a day.** `Reports/QSR_Report` takes a month
// number and a year, and that is the only call that hands back a list of
// consignments with their statuses. So a span of days is fetched a month at a
// time and cut to the span here.
//
// **M&P have no webhooks.** Not in their document and not in their portal -
// there is no callback of any kind. So M&P is the one courier here that has to
// be asked, and the asking is kept to one report call per month per account,
// plus bulk tracking (200 consignments a call) for the parcels still moving.

import { makeGrouper, num, day } from './statuses.js';

// M&P's tracking screen writes its timestamps month first - "06/14/2025" is
// 14 June - while their reports write "14 Jun 2025". Sonic writes the same
// shape the other way round, so the order has to be said out loud here rather
// than guessed at in statuses.js.
const stamp = v => day(v, 'mdy');
import { flatten, pick } from './hooks.js';
import { qs, call, rows } from './wire.js';

const BASE = (process.env.MNP_BASE || 'https://mnpcourier.com/mycodapi/api')
  .replace(/\/+$/, '');

// Their tracking screen is public and does not need the sign-in.
const TRACK_BASE = (process.env.MNP_TRACK_BASE ||
  'https://tracking.mulphilog.com.pk/api').replace(/\/+$/, '');

// M&P write a status two ways: the tracking screen's plain words ("Booked",
// "Delivered") and the report's prefixed code ("RS-Return to Shipper"). Both
// are here; anything else goes through the word rules in statuses.js.
const GROUPS = {
  'booked':                   'booked',
  'manifested':               'booked',
  'picked up':                'transit',
  'received at origin':       'transit',
  'in transit':               'transit',
  'arrived at destination':   'transit',
  'received at destination':  'transit',
  'out for delivery':         'transit',
  'delivery in process':      'transit',
  'delivery attempted':       'transit',
  'undelivered':              'transit',
  'hold at station':          'review',
  'on hold':                  'review',
  'delivered':                'delivered',
  'ds-delivered':             'delivered',
  'consignment delivered':    'delivered',
  'rs-return to shipper':     'returned',
  'return to shipper':        'returned',
  'returned to shipper':      'returned',
  'return in process':        'returning',
  'rs-in process':            'returning',
  'cancelled':                'cancelled',
  'void':                     'cancelled',
  'lost':                     'lost',
  'damaged':                  'damaged'
};

export const groupOf = makeGrouper(GROUPS);

/* ---------- how the sign-in is handed over ---------- */

// All three spellings, every time. Their document uses a different one in
// almost every section and the server ignores what it does not know.
function signIn(token, extra) {
  const user = (extra && (extra.username || extra.user)) || '';
  const pass = (extra && extra.password) || token;

  return {
    username: user, password: pass,
    UserName: user, Password: pass,
    Username: user
  };
}

function accountOf(extra) {
  return (extra && (extra.account || extra.accountNo)) || '';
}

async function get(token, extra, path, params) {
  const r = await call({
    url: qs(BASE, path, Object.assign({}, signIn(token, extra), params || {}))
  });
  return unwrap(r, path);
}

async function post(token, extra, path, body) {
  const r = await call({
    url: qs(BASE, path, {}),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Object.assign({}, signIn(token, extra), body || {})
  });
  return unwrap(r, path);
}

// M&P answer a 200 with `isSuccess: false` and the reason in `message`, and
// their lists arrive wrapped in an array of one. Both are undone here so
// nothing above this line has to know.
function unwrap(r, path) {
  if (r.status === 401 || r.status === 403) {
    throw new Error('M&P refused that login');
  }
  if (r.status === 0) {
    throw new Error('M&P could not be reached from this server (' + r.text + '). ' +
      'Press "Can this server reach M&P?" on the couriers page.');
  }
  if (!r.ok) {
    throw new Error(`M&P said ${r.status} on ${path}: ` +
      String((r.json && (r.json.message || r.json.Message)) || r.text).slice(0, 200));
  }

  const body = Array.isArray(r.json) ? (r.json[0] || {}) : (r.json || {});
  const said = body.isSuccess !== undefined ? body.isSuccess
             : (body.isSucces !== undefined ? body.isSucces : undefined);

  if (said === false || said === 'false') {
    throw new Error('M&P said: ' + String(body.message || 'it would not do that').slice(0, 200));
  }

  return { body, all: Array.isArray(r.json) ? r.json : [r.json] };
}

/* ---------- which account, and which location ---------- */
// Both are things M&P hand out, and both can be asked for - so nobody has to
// find a number in an email from two years ago to add an account.

export async function listAccounts(token, extra) {
  const { body } = await get(token, extra, '/UserManagement/GetAccounts', {});
  const list = Array.isArray(body.locationList) ? body.locationList : [];
  return list.map(a => ({
    account: String(a.AccountNo || a.accountNo || '').trim(),
    cod: a.IsCod === true || a.IsCod === 'true'
  })).filter(a => a.account);
}

// The report calls want a location id, which is M&P's sub-account - the
// account the booking actually went through.
export async function listLocations(token, extra) {
  const account = accountOf(extra);
  const { body } = await get(token, extra, '/UserManagement/GetSubAccounts',
                             { AccountNo: account, 'Account No': account });
  const list = Array.isArray(body.locationList) ? body.locationList : [];
  return list.map(l => ({
    location: String(l.subAccountId || l.SubAccountId || '').trim(),
    name: l.shipperName || l.ShipperName || '',
    address: l.shipperAddress || l.ShipperAddress || ''
  })).filter(l => l.location);
}

/* ---------- a consignment, in the app's own shape ---------- */

// A row of the QSR report: one consignment, with where it ended up.
export function mapReportRow(row) {
  const f = flatten(row, 0);
  const status = pick(f, ['rrstatus', 'status', 'deliverystatus', 'cnstatus']);

  return {
    tracking:    pick(f, ['consignmentnumber', 'cnno', 'cn']),
    orderRef:    pick(f, ['orderrefno', 'orderid', 'customerorderref']),
    customer:    pick(f, ['consignee', 'consigneename']),
    phone:       pick(f, ['contactno', 'consigneemobno']),
    address:     pick(f, ['deliveryaddress', 'consigneeaddress']),
    detail:      pick(f, ['service', 'servicetype']),
    notes:       pick(f, ['receivedby']),
    items:       num(pick(f, ['pieces'])),
    weight:      num(pick(f, ['weight'])),
    status,
    statusGroup: groupOf(status),
    amount:      num(pick(f, ['codamount'])),
    payout:      0,
    upfront:     0,
    reserve:     0,
    balance:     0,
    // What M&P kept, and the tax on it. These were **hard nought** until
    // 30 Oct 2026, which is why an M&P receipt showed no tax at all and why
    // every M&P parcel looked as though it had cost nothing to carry - it
    // overstated what M&P still owed and it priced nothing on the rates
    // screen. Read by name through pick(), so a column they do not send
    // leaves it at nought exactly as before.
    fee:         num(pick(f, ['servicecharges', 'servicecharge', 'deliverycharges',
                              'charges', 'totalcharges', 'freight', 'freightcharges'])),
    tax:         num(pick(f, ['gst', 'salestax', 'tax', 'gstamount'])),
    city:        pick(f, ['destination', 'destzone', 'destinationcity']),
    bookedOn:    day(pick(f, ['bookingdate'])),
    pickedOn:    null,
    deliveredOn: day(pick(f, ['deliverydate'])),
    raw:         {}
  };
}

// A consignment as the tracking call gives it: the same fields plus its own
// history, and the settlement when there is one.
export function mapTracked(row) {
  const r = row || {};
  const history = Array.isArray(r.CNTrackingDetail) ? r.CNTrackingDetail : [];

  const latest = history.length ? history[history.length - 1] : {};
  const status = String(latest.TrackingStatus || r.DeliveryStatus || '').trim();
  const group = groupOf(status);

  const lineOf = want => {
    const hit = history.slice().reverse().find(h => groupOf(h.TrackingStatus) === want);
    return hit ? stamp(hit.TransactionTime) : null;
  };

  return {
    tracking:    String(r.ConsignmentNumber || '').trim(),
    orderRef:    String(r.OrderId || '').trim(),
    customer:    r.ConsigneeName || '',
    phone:       r.ContactNo || '',
    address:     r.DeliveryAddress || '',
    detail:      r.ServiceType || '',
    notes:       latest.TrackingNarration || '',
    items:       num(r.Pieces),
    weight:      num(r.Weight),
    status,
    statusGroup: group,
    amount:      num(r.CODAmount),
    payout:      num(r.AmountPaid),
    upfront:     0,
    reserve:     0,
    balance:     0,
    // the same two, off the tracking call. Whichever of the two calls carries
    // them wins, because saveOrders keeps the later answer.
    fee:         num(r.ServiceCharges || r.DeliveryCharges || r.TotalCharges ||
                     r.Charges || r.FreightCharges),
    tax:         num(r.GST || r.SalesTax || r.Tax || r.GSTAmount),
    city:        r.DestinationCity || r.OriginCity || '',
    bookedOn:    day(r.BookingDate),
    pickedOn:    lineOf('transit'),
    deliveredOn: group === 'delivered' ? stamp(latest.TransactionTime) : lineOf('delivered'),
    settled:     !!(r.PaymentID && String(r.PaymentID).trim()),
    settledOn:   day(r.PaymentDate),
    cprNumber:   String(r.PaymentID || '').trim(),
    raw:         { history: history.slice(-8) }
  };
}

/* ---------- the calls ---------- */

// GetAccounts needs nothing but the sign-in, so it both proves the login and
// says which account numbers it holds - which is why it is the test call.
export async function testToken(token, extra) {
  const accounts = await listAccounts(token, extra);

  let locations = [];
  const account = accountOf(extra) || (accounts[0] && accounts[0].account);
  if (account) {
    locations = await listLocations(token, Object.assign({}, extra, { account }))
      .catch(() => []);
  }

  return {
    ok: true,
    statuses: [],
    shape: 'username and password',
    accounts: accounts.map(a => a.account),
    locations: locations.map(l => l.location),
    // handed back so the add screen can keep them without anybody typing them
    learned: {
      account: account || '',
      location: (locations[0] && locations[0].location) || ''
    },
    message: 'M&P answered' +
      (accounts.length ? ' with ' + accounts.length + ' account' +
        (accounts.length === 1 ? '' : 's') + ': ' +
        accounts.map(a => a.account).join(', ') : '')
  };
}

function monthsOf(from, to) {
  const out = [];
  let y = Number(String(from).slice(0, 4));
  let m = Number(String(from).slice(5, 7));
  const lastY = Number(String(to).slice(0, 4));
  const lastM = Number(String(to).slice(5, 7));

  let guard = 0;
  while ((y < lastY || (y === lastY && m <= lastM)) && guard < 36) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
    guard++;
  }
  return out;
}

// A span of days, a month at a time, because the report is monthly. The rows
// are cut to the span afterwards so a sweep of "the last four days" does not
// save a whole month every time.
export async function fetchOrders(token, from, to, statusId, extra) {
  const location = (extra && (extra.location || extra.locationId)) || '';
  if (!location) {
    throw new Error('M&P reports need the location id - add it to this account ' +
                    '(it is the sub-account the bookings go through)');
  }

  const seen = new Map();

  for (const m of monthsOf(from, to)) {
    const { all } = await post(token, extra, '/Reports/QSR_Report', {
      MonthNumber: m.month,
      year: m.year,
      Year: m.year,
      locationID: String(location)
    });

    all.forEach(block => {
      const list = Array.isArray(block && block.Details) ? block.Details : (rows(block) || []);
      list.forEach(row => {
        const o = mapReportRow(row);
        if (!o.tracking) return;
        // the report is a whole month; only the days asked for are kept
        if (o.bookedOn && (o.bookedOn < from || o.bookedOn > to)) return;
        seen.set(o.tracking, o);
      });
    });
  }

  return [...seen.values()];
}

// Up to 200 consignments in one call - this is what keeps M&P cheap, since
// there are no webhooks to lean on.
export async function refreshKnown(token, trackings, extra) {
  const want = (trackings || []).map(t => String(t).trim()).filter(Boolean);
  if (!want.length) return [];

  const account = accountOf(extra);
  const out = [];

  for (let i = 0; i < want.length; i += 200) {
    const { all } = await post(token, extra,
      '/Tracking/Bulk_Consignment_Tracking_New', {
        AccountNo: account,
        Consignments: want.slice(i, i + 200)
      });

    all.forEach(block => {
      const list = Array.isArray(block && block.tracking_Details) ? block.tracking_Details : [];
      list.forEach(row => {
        const o = mapTracked(row);
        if (o.tracking) out.push(o);
      });
    });
  }

  return out;
}

// One consignment. The public tracking screen's own call, which needs no
// sign-in at all - `id` is always 4, their document is firm about that.
export async function trackOne(token, tracking, extra) {
  const cn = String(tracking || '').trim();

  const r = await call({ url: qs(TRACK_BASE, '/CNTracking', { consignment: cn, id: 4 }) });
  if (r.ok) {
    const body = Array.isArray(r.json) ? (r.json[0] || {}) : (r.json || {});
    const list = Array.isArray(body.tracking_Details) ? body.tracking_Details : [];
    if (list.length) return mapTracked(list[0]);
  }

  // their public screen is down or does not know it: the signed-in bulk call
  // knows about anything booked on this account
  const some = await refreshKnown(token, [cn], extra);
  if (!some.length) throw new Error('M&P knows nothing about ' + cn);
  return some[0];
}

// Settlement for one consignment. The bulk tracking rows already carry
// PaymentID, PaymentDate and AmountPaid, so there is nothing else to ask.
export async function fetchPayment(token, tracking, extra) {
  const o = await trackOne(token, tracking, extra);
  return {
    tracking:  o.tracking || String(tracking),
    orderRef:  o.orderRef || '',
    settled:   !!o.settled,
    settledOn: o.settledOn || null,
    cprNumber: o.cprNumber || '',
    upfrontOn: null,
    reserveOn: null,
    amount:    o.payout || 0
  };
}

// What M&P paid out in a span of days, as their own payment report sees it:
// one row per payment, with the instrument it went out on. Their limit is 31
// days a call, so the caller keeps the span short.
// M&P keep two city lists and they are not the same list: Get_Cities is
// where they will collect from, Get_Cities_All is where they will deliver to.
// A merchant asking "do M&P go there" means the second; a merchant asking
// "can they pick up from our second warehouse" means the first. Both are
// read and merged into one row per city with two flags, because showing two
// lists side by side only makes somebody compare them by eye.
export async function fetchAreas(token, extra) {
  const account = accountOf(extra);
  const params = { AccountNo: account, 'Account No': account };

  async function names(path) {
    try {
      const { body } = await get(token, extra, path, params);
      const list = Array.isArray(body.City) ? body.City
                 : (Array.isArray(body.city) ? body.city : []);
      return list.map(v => String(v || '').trim()).filter(Boolean);
    } catch (e) {
      // one of the two refusing is not a reason to show neither
      return { error: e.message };
    }
  }

  const [pick, drop] = await Promise.all([
    names('/Branches/Get_Cities'),
    names('/Branches/Get_Cities_All')
  ]);

  const trouble = [];
  if (!Array.isArray(pick)) trouble.push('pickup list: ' + pick.error);
  if (!Array.isArray(drop)) trouble.push('delivery list: ' + drop.error);
  if (trouble.length === 2) throw new Error(trouble.join('; '));

  const byKey = new Map();
  const add = (list, which) => {
    (Array.isArray(list) ? list : []).forEach(n => {
      const key = n.toUpperCase();
      const row = byKey.get(key) ||
        { id: '', name: n, hub: '', zone: '', pickup: false, delivery: false, services: [] };
      row[which] = true;
      byKey.set(key, row);
    });
  };
  add(pick, 'pickup');
  add(drop, 'delivery');

  const out = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (trouble.length) out.trouble = trouble.join('; ');
  return out;
}

export async function fetchPayouts(token, from, to, extra) {
  const location = (extra && (extra.location || extra.locationId)) || '';
  const { all } = await post(token, extra, '/Reports/Payment_Report', {
    dateFrom: from, dateTo: to, locationID: String(location)
  });

  const out = [];
  all.forEach(block => {
    const list = Array.isArray(block && block.Details) ? block.Details : [];
    list.forEach(row => out.push({
      paymentId:  String(row.PaymentID || '').trim(),
      paidOn:     day(row.PaidOn),
      amount:     num(row.RRAmount),
      invoiced:   num(row.InvoiceAmount),
      netPayable: num(row.NetPayable),
      mode:       row.InstrumentMode || '',
      instrument: String(row.InstrumentNumber || '').trim(),
      bank:       (block && block.BankName) || '',
      account:    (block && block.AccountNo) || ''
    }));
  });
  return out;
}

export const adapter = {
  // their own row, untouched, for settling what they do and do not send
  peek,
  key: 'mnp',
  name: 'M&P',
  base: BASE,
  // their public tracking screen is a different host on a different network,
  // so one of the two being reachable says nothing about the other
  extraBases: [{ base: TRACK_BASE, label: 'M&P tracking screen' }],
  // The login M&P hand out, plus the two numbers they hand out with it. Both
  // numbers are discovered by the test call, so they are optional here.
  fields: [
    { name: 'token', label: 'Password', secret: true,
      hint: 'the password M&P gave you for the COD API' },
    { name: 'username', label: 'Username', secret: false,
      hint: 'the username M&P gave you' },
    { name: 'account', label: 'Account number', optional: true,
      hint: 'like 4T154 - looked up for you if you leave it out' },
    { name: 'location', label: 'Location id', optional: true,
      hint: 'the sub-account bookings go through - looked up too' }
  ],
  hook: {
    where: null,
    note: 'M&P have no webhook of any kind - not in their API manual and not ' +
          'in the portal. So M&P is asked rather than told: one monthly report ' +
          'call per account, and bulk tracking for the parcels still moving.',
    none: true
  },
  lists: true,
  groupOf,
  testToken,
  fetchOrders,
  fetchPayment,
  fetchPayouts,
  trackOne,
  refreshKnown,
  listAccounts,
  listLocations,
  fetchAreas
};

/* ---------- what they actually send ---------- */
//
// Their charges and their GST are read by name, and the names came from
// their manual rather than from an answer - so when a figure comes out at
// nought there is no way, from the screens, to tell "M&P sent no such column"
// from "M&P sent nought". This hands back **their own row, untouched**, so
// the question is settled by looking rather than by guessing again.
//
// It is shown to Fusion's own admin and nobody else, and it is the account's
// own data: one row of a report they can already open on the courier's portal.
export async function peek(token, from, to, extra) {
  const location = (extra && (extra.location || extra.locationId)) || '';
  const out = { calls: [], saved: { account: accountOf(extra) || '', location: location } };

  // Which account numbers and which sub-accounts this sign-in actually holds.
  // "There is no QSR Report record against the request parameters" is what M&P
  // say when the location id is not one of theirs, and that sentence reads as
  // "no data" - so the two are put side by side here.
  try {
    out.accounts = await listAccounts(token, extra);
  } catch (e) {
    out.accounts = [{ error: e.message }];
  }
  try {
    out.locations = await listLocations(token, extra);
  } catch (e) {
    out.locations = [{ error: e.message }];
  }

  const month = String(from || '').slice(0, 7) || '';
  const [y, m] = month ? month.split('-') : ['', ''];

  if (location && y) {
    try {
      const { all } = await post(token, extra, '/Reports/QSR_Report', {
        MonthNumber: Number(m), year: Number(y), Year: Number(y),
        locationID: String(location)
      });
      const block = all.find(b => Array.isArray(b && b.Details) && b.Details.length) || null;
      const list = block ? block.Details : (rows(all[0]) || []);
      out.calls.push({
        what: 'Reports/QSR_Report',
        rows: list.length,
        keys: list.length ? Object.keys(list[0]) : [],
        first: list[0] || null,
        // what the block itself carries around the rows - their monthly
        // totals sit here, and that is where a GST figure often is
        blockKeys: block ? Object.keys(block).filter(k => k !== 'Details') : [],
        block: block ? Object.fromEntries(
          Object.entries(block).filter(([k]) => k !== 'Details')) : null
      });
    } catch (e) {
      out.calls.push({ what: 'Reports/QSR_Report', error: e.message });
    }
  } else {
    out.calls.push({ what: 'Reports/QSR_Report',
      error: 'no location id on this account, or no date to read' });
  }

  return out;
}
