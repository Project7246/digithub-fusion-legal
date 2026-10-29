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

/* ---------- the location id, which nobody should have to know ---------- */
//
// M&P's report calls take a `locationID` - their sub-account, the one the
// bookings went through - and it is the single thing that has broken most
// often here. The id saved on one account was not even in M&P's own list of
// sub-accounts: the QSR report answered anyway, and the payment report
// refused with **"There is no Payment Report record against the request
// parameters"**, which reads as "you have no payments" and is not what it
// means.
//
// So nobody types it any more. The call is tried with whatever is saved, then
// with none at all, then with each sub-account this sign-in actually holds,
// and the one that answers is remembered for as long as the process lives.
// A courier's own account numbers are the courier's to know, not something
// for a person to copy out of an email from two years ago.

const worked = new Map();      // account number -> the location id that answered

function remember(account, id) {
  if (account) worked.set(String(account), String(id == null ? '' : id));
}

export function forgetLocations() { worked.clear(); }

// Every id worth trying, best first and each one only once.
async function locationsToTry(token, extra) {
  const account = accountOf(extra);
  const saved = (extra && (extra.location || extra.locationId)) || '';
  const out = [];
  const add = v => {
    const id = String(v == null ? '' : v);
    if (!out.some(x => x === id)) out.push(id);
  };

  if (worked.has(String(account))) add(worked.get(String(account)));
  add(saved);
  add('');                                     // their reports often ignore it

  try {
    (await listLocations(token, extra)).forEach(l => add(l.location));
  } catch (e) { /* the sign-in works or nothing else would have got this far */ }

  return out;
}

// One report call, asked until it answers. `body(id)` builds the call for a
// given location id; `rowsOf(all)` says what came back. A refusal that names
// the parameters is M&P's way of saying "not that id", so it is tried with the
// next one rather than reported as "you have no data".
async function report(token, extra, path, body, rowsOf) {
  const account = accountOf(extra);
  const tries = await locationsToTry(token, extra);
  let last = null;

  for (const id of tries) {
    try {
      const { all } = await post(token, extra, path, body(id));
      const rows = rowsOf(all);
      if (rows.length) { remember(account, id); return { rows, location: id }; }
      last = last || new Error('M&P had nothing on ' + path + ' for these dates');
    } catch (e) {
      last = last || e;
    }
  }

  // Nothing came back. There are two reasons for that and they are not the
  // same thing at all:
  //
  //   **nothing booked yet.** M&P say "There is no ... record against the
  //   request parameters", which reads like a refusal and is not one - an
  //   account that exists but has had no bookings through it answers exactly
  //   this. It is not an error, and writing it on the account as one leaves
  //   somebody chasing a courier about a week they never used.
  //
  //   **something is wrong** - the login, the route, the parameters. That is
  //   an error, and it says what was tried.
  const why = last ? last.message : 'M&P said nothing';
  if (/no\s+\w*\s*report record|no record against/i.test(why)) {
    return { rows: [], empty: true, location: tries[0] || '' };
  }

  throw new Error(why + ' (tried ' + tries.length + ' location id' +
    (tries.length === 1 ? '' : 's') + ': ' +
    tries.map(x => x || 'none').join(', ') + ')');
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

// What M&P billed for one consignment. There can be more than one line - a
// return is invoiced as well as the delivery - so they are added up, and the
// numbers are kept beside the parcel so a figure can be opened into the
// invoice it came from.
function invoiced(r) {
  const list = Array.isArray(r && r.CNTrackingInvDetail) ? r.CNTrackingInvDetail : [];
  return list.reduce((sum, x) => sum + num(x && x.AmountInvoiced), 0);
}

function invoiceLines(r) {
  const list = Array.isArray(r && r.CNTrackingInvDetail) ? r.CNTrackingInvDetail : [];
  return list.map(x => ({
    number: String((x && x.InvoiceNumber) || '').trim(),
    on: day(x && x.InvoiceDate),
    amount: num(x && x.AmountInvoiced),
    kind: String((x && x.InvoiceType) || '').trim()
  })).filter(x => x.number || x.amount);
}

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
    // **M&P do not deduct anything at the door.** Read off their own answer on
    // 30 Oct 2026: a parcel with CODAmount 6943 came back with AmountPaid
    // 6943 - the whole of it - and what they charge for carrying it is
    // invoiced separately, one row per consignment under
    // `CNTrackingInvDetail`: InvoiceNumber, InvoiceDate, AmountInvoiced,
    // InvoiceType. That is the charge, and it is why their QSR report has no
    // charge column at all and why guessing at `servicecharges` and `gst`
    // never matched anything.
    //
    // So `fee` is what they invoiced, `tax` is nought, and the nought is
    // honest: this call gives one amount and does not split it into carriage
    // and GST. Their invoice does, and nothing here reads an invoice yet.
    fee:         invoiced(r),
    tax:         0,
    city:        r.DestinationCity || r.OriginCity || '',
    bookedOn:    day(r.BookingDate),
    pickedOn:    lineOf('transit'),
    deliveredOn: group === 'delivered' ? stamp(latest.TransactionTime) : lineOf('delivered'),
    settled:     !!(r.PaymentID && String(r.PaymentID).trim()),
    settledOn:   day(r.PaymentDate),
    cprNumber:   String(r.PaymentID || '').trim(),
    // what they paid, which for M&P is the whole COD, and what they billed
    payout:      num(r.AmountPaid),
    raw:         { history: history.slice(-8), invoices: invoiceLines(r) }
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
  const seen = new Map();

  for (const m of monthsOf(from, to)) {
    // No location id is asked of anybody now - see report() above. A month
    // that genuinely holds nothing is not a failure, so it is passed over
    // rather than stopping the span.
    let got;
    try {
      got = await report(token, extra, '/Reports/QSR_Report',
        id => ({ MonthNumber: m.month, year: m.year, Year: m.year, locationID: id }),
        all => {
          const out = [];
          all.forEach(block => {
            const list = Array.isArray(block && block.Details) ? block.Details : (rows(block) || []);
            list.forEach(row => out.push(row));
          });
          return out;
        });
    } catch (e) {
      // the last month of a span is often empty - that is not an error
      if (monthsOf(from, to).length > 1) continue;
      throw e;
    }

    {
      const list = got.rows || [];
      list.forEach(row => {
        const o = mapReportRow(row);
        if (!o.tracking) return;
        // the report is a whole month; only the days asked for are kept
        if (o.bookedOn && (o.bookedOn < from || o.bookedOn > to)) return;
        seen.set(o.tracking, o);
      });
    }
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
  const got = await report(token, extra, '/Reports/Payment_Report',
    id => ({ dateFrom: from, dateTo: to, locationID: id }),
    all => {
      const out = [];
      all.forEach(block => {
        const list = Array.isArray(block && block.Details) ? block.Details : [];
        list.forEach(row => out.push(Object.assign({ __block: block }, row)));
      });
      return out;
    });

  const out = [];
  {
    const list = got.rows || [];
    {
      list.forEach(row => {
        const block = row.__block || {};
        out.push({
          paymentId:  String(row.PaymentID || '').trim(),
          paidOn:     day(row.PaidOn),
          amount:     num(row.RRAmount),
          invoiced:   num(row.InvoiceAmount),
          netPayable: num(row.NetPayable),
          mode:       row.InstrumentMode || '',
          instrument: String(row.InstrumentNumber || '').trim(),
          // where they sent it. They name the beneficiary and the IBAN on
          // every payment, which is how a bank changed with the courier shows
          // up here rather than on a statement weeks later.
          bank:        (block && block.BankName) || '',
          beneficiary: (block && (block.BeneficiaryName || block.AcccountName ||
                                  block.AccountName)) || '',
          bankAccount: (block && (block.BeneficiaryBankAccount ||
                                  block.BeneficiaryAccount)) || '',
          branch:      (block && block.BranchName) || '',
          account:     (block && block.AccountNo) || ''
        });
      });
    }
  }
  return out;
}

export const adapter = {
  // their own row, untouched, for settling what they do and do not send
  peek,
  key: 'mnp',
  name: 'M&P',
  // **They do deduct**, and the parcel does not show it.
  //
  // Their tracking call reports `AmountPaid` equal to the whole `CODAmount`,
  // which reads as "nothing was kept" and is what this was first written to.
  // Their payment report says otherwise, and it is the one that describes the
  // money that actually moved:
  //
  //     PaymentID 20261533146 - RRAmount 6943, InvoiceAmount 13286,
  //     NetPayable -6343, IBFT
  //
  // NetPayable is RRAmount less InvoiceAmount, so what reaches the bank is the
  // COD **net of their invoices** - the same shape as PostEx and Trax, told
  // in two places instead of one. So M&P are left on the default here, and
  // `fee` on a parcel is what they invoiced for carrying it.
  //
  // What is still not settled, and should not be guessed at: that payment's
  // InvoiceAmount (13,286) is not that parcel's invoice (109.25), so a
  // payment carries invoices beyond the parcels it pays for. Until the two
  // are reconciled, the receivable is right per parcel and a payment's own
  // net is the figure to trust for the bank.
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
    // Left here because an account saved before this still carries one, and a
    // right one is one call saved. It is tried first and then simply passed
    // over: M&P's reports are asked with every sub-account the sign-in holds
    // until one answers, so a wrong id no longer stops anything.
    { name: 'location', label: 'Location id', optional: true,
      hint: 'leave it out - every sub-account is tried until one answers' }
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
      if (list.length) {
        peekSample.tracking = String(
          list[0].consignmentNumber || list[0].CNNo || list[0].cn || '').trim();
      }
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

  // **Is the location id needed at all?** Asked straight out, because the one
  // saved on an account was not even in M&P's own list of sub-accounts and the
  // QSR report answered anyway, while the payment report refused. So both
  // calls are tried with the saved id, with none at all, and with each
  // sub-account this sign-in really holds - and whichever answers is the
  // answer. Guessing at this is what left an account erroring for a week.
  const tries = [{ label: 'the id saved on this account', id: location },
                 { label: 'no location id at all', id: '' }];
  (out.locations || []).forEach(l => {
    if (l && l.location && l.location !== location) {
      tries.push({ label: 'sub-account ' + l.location + ' (' + (l.name || '') + ')',
                   id: l.location });
    }
  });

  for (const t of tries) {
    try {
      const { all } = await post(token, extra, '/Reports/Payment_Report', {
        dateFrom: from, dateTo: to, locationID: String(t.id || '')
      });
      const block = all.find(b => Array.isArray(b && b.Details) && b.Details.length) || all[0] || null;
      const list = (block && block.Details) || [];
      // What the shape of this report actually is. A row per payment and a
      // row per consignment look identical until the rows are counted by
      // payment number - and the two give completely different figures on a
      // receipt, so it is worth knowing rather than inferring.
      const byId = new Map();
      list.forEach(r => {
        const k = String(r.PaymentID || '');
        const g = byId.get(k) || { rows: 0, rr: 0, inv: 0, net: 0 };
        g.rows += 1;
        g.rr  += Number(String(r.RRAmount || 0).replace(/[^0-9.\-]/g, '')) || 0;
        g.inv += Number(String(r.InvoiceAmount || 0).replace(/[^0-9.\-]/g, '')) || 0;
        g.net += Number(String(r.NetPayable || 0).replace(/[^0-9.\-]/g, '')) || 0;
        byId.set(k, g);
      });
      const biggest = [...byId.entries()].sort((a, b) => b[1].rows - a[1].rows)[0] || null;

      out.calls.push({
        what: 'Reports/Payment_Report',
        tried: t.label,
        rows: list.length,
        payments: byId.size,
        rowsPerPayment: biggest ? biggest[1].rows : 0,
        biggest: biggest ? { id: biggest[0], ...biggest[1] } : null,
        // every row of that one payment, as they sent them
        itsRows: biggest ? list.filter(r => String(r.PaymentID || '') === biggest[0]).slice(0, 6) : [],
        keys: list.length ? Object.keys(list[0]) : [],
        first: list[0] || null,
        blockKeys: block ? Object.keys(block).filter(k => k !== 'Details') : [],
        block: block ? Object.fromEntries(
          Object.entries(block).filter(([k]) => k !== 'Details')) : null
      });
      if (list.length) break;        // one that answers is enough
    } catch (e) {
      out.calls.push({ what: 'Reports/Payment_Report', tried: t.label, error: e.message });
    }
  }

  // and the same question of the QSR report, which is the one that must keep
  // working whatever is decided about the id
  if (location && m && y) {
    try {
      const { all } = await post(token, extra, '/Reports/QSR_Report', {
        MonthNumber: Number(m), year: Number(y), Year: Number(y), locationID: ''
      });
      const block = all.find(b => Array.isArray(b && b.Details) && b.Details.length) || null;
      const list = block ? block.Details : [];
      out.calls.push({ what: 'Reports/QSR_Report', tried: 'no location id at all',
                       rows: list.length });
    } catch (e) {
      out.calls.push({ what: 'Reports/QSR_Report', tried: 'no location id at all',
                       error: e.message });
    }
  }

  // and one consignment off the bulk tracking call, which is the other place
  // a per-parcel deduction could be
  try {
    const account = accountOf(extra);
    const one = await pool0(token, extra, account);
    out.calls.push(one);
  } catch (e) {
    out.calls.push({ what: 'Tracking/Bulk_Consignment_Tracking_New', error: e.message });
  }

  return out;
}

// One parcel we already hold, asked about by name - the caller passes none, so
// the newest consignment on the QSR answer above is used where there is one.
async function pool0(token, extra, account) {
  const sample = peekSample.tracking;
  if (!sample) {
    return { what: 'Tracking/Bulk_Consignment_Tracking_New',
             error: 'no consignment number to ask about' };
  }
  const { all } = await post(token, extra,
    '/Tracking/Bulk_Consignment_Tracking_New',
    { AccountNo: account, Consignments: [sample] });

  const block = all.find(b => Array.isArray(b && b.tracking_Details) &&
                              b.tracking_Details.length) || all[0] || null;
  const list = (block && block.tracking_Details) || [];
  const row = list[0] || null;

  return {
    what: 'Tracking/Bulk_Consignment_Tracking_New',
    rows: list.length,
    keys: row ? Object.keys(row) : [],
    // the history is long and says nothing about money
    first: row ? Object.fromEntries(
      Object.entries(row).filter(([k]) => k !== 'CNTrackingDetail')) : null
  };
}

// the consignment number peek() picks up on its way past
const peekSample = { tracking: '' };
