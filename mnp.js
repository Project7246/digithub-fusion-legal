// M&P - Muller & Phipps, who trade as Mulphi Logistics. Same shape as
// postex.js and trax.js, and for the same reason: everything the app knows
// about M&P's dialect is in this one file.
//
// M&P hand their integration guide out account by account, and the sign-in is
// not one key but a mailbox and a password, sometimes with a shipper or cost
// centre code beside it. So the key field here is "API key or password" and the
// other two are asked for separately, and - as in trax.js - each call is a
// short list of the shapes it could take, with the first one M&P answer being
// the one kept for that key.
//
// When M&P send their guide, the lists below are where it goes.

import { makeGrouper, num, day } from './statuses.js';
import { flatten, pick } from './hooks.js';
import { qs, call, rows, hunt, knownAuth } from './wire.js';

const BASE = (process.env.MNP_BASE || 'https://mnpcourier.com/api').replace(/\/+$/, '');

// M&P write their statuses in capitals and in the language of the counter
// clerk: "DELIVERY IN PROCESS" is a parcel out on a van. Anything not here
// goes through the word rules in statuses.js.
const GROUPS = {
  'booked':                  'booked',
  'consignment booked':      'booked',
  'shipment booked':         'booked',
  'pending':                 'booked',
  'picked up':               'transit',
  'received at origin':      'transit',
  'in transit':              'transit',
  'received at destination': 'transit',
  'arrived at destination':  'transit',
  'delivery in process':     'transit',
  'out for delivery':        'transit',
  'delivery attempted':      'transit',
  'undelivered':             'transit',
  'hold at station':         'review',
  'on hold':                 'review',
  'delivered':               'delivered',
  'consignment delivered':   'delivered',
  'return in process':       'returning',
  'return to shipper':       'returning',
  'returned to shipper':     'returned',
  'return delivered':        'returned',
  'returned':                'returned',
  'cancelled':               'cancelled',
  'canceled':                'cancelled',
  'lost':                    'lost',
  'damaged':                 'damaged'
};

export const groupOf = makeGrouper(GROUPS);

/* ---------- how M&P want to be handed a sign-in ---------- */
// A key in a header, a key in the query, or a mailbox and password in the body:
// all three have been seen, and which one an account gets depends on when it
// was set up. Each is tried once and the winner is kept for that key.
function authsFor(extra) {
  const user = (extra && extra.username) || '';
  const pass = (extra && extra.password) || '';
  const code = (extra && extra.shipper) || '';

  const list = [
    { name: 'x-api-key',            head: k => ({ 'x-api-key': k }) },
    { name: 'Authorization',        head: k => ({ Authorization: k }) },
    { name: 'Authorization Bearer', head: k => ({ Authorization: 'Bearer ' + k }) },
    { name: 'apikey in the query',  head: () => ({}), query: k => ({ apikey: k }) },
    { name: 'api_key in the query', head: () => ({}), query: k => ({ api_key: k }) }
  ];

  // Only offered when a mailbox was given, so an account that works on a key
  // alone never sends a half-empty sign-in.
  if (user) {
    list.unshift({
      name: 'username and password in the query',
      head: () => ({}),
      query: k => ({
        username: user,
        password: pass || k,
        loginId: user,
        apikey: k,
        shipper_code: code || undefined
      })
    });
  }

  return list;
}

// Once one call has been accepted, the way this sign-in is handed over is
// settled, so the rest of them stop trying the other five.
function shapesFor(paths, extra, token) {
  const known = knownAuth('mnp', token);
  const auths = known ? [known] : authsFor(extra);
  const out = [];
  paths.forEach(p => auths.forEach(a => out.push({
    name: p.name + ' / ' + a.name,
    path: p.path,
    params: p.params || {},
    method: p.method || 'GET',
    body: p.body || null,
    auth: a
  })));
  return out;
}

function sender(token, extra) {
  return shape => call({
    url: qs(BASE, shape.path,
            Object.assign({}, shape.params,
                          shape.auth.query ? shape.auth.query(token) : {})),
    method: shape.method,
    headers: shape.auth.head(token),
    body: shape.body
  });
}

/* ---------- one consignment, in the app's own shape ---------- */

export function mapOrder(row) {
  const f = flatten(row, 0);
  const status = pick(f, [
    'status', 'cnstatus', 'shipmentstatus', 'currentstatus', 'statusname',
    'deliverystatus', 'statusmessage', 'lastactivity'
  ]);

  const cod = num(pick(f, ['codamount', 'cod', 'amount', 'collectamount',
                           'invoicevalue', 'declaredvalue', 'productvalue']));
  const fee = num(pick(f, ['charges', 'servicecharges', 'deliverycharges',
                           'totalcharges', 'freight', 'fee']));
  const tax = num(pick(f, ['gst', 'salestax', 'tax', 'taxamount', 'fed']));

  return {
    tracking:    pick(f, ['cnno', 'cnnumber', 'cn', 'consignmentno', 'consignmentnumber',
                          'trackingnumber', 'tracking', 'awb', 'bookingno']),
    orderRef:    pick(f, ['orderid', 'orderno', 'referenceno', 'reference',
                          'orderrefnumber', 'shipperreference']),
    customer:    pick(f, ['consigneename', 'customername', 'receivername', 'name']),
    phone:       pick(f, ['consigneephone', 'consigneemobile', 'customerphone',
                          'phone', 'mobile', 'cellno']),
    address:     pick(f, ['consigneeaddress', 'deliveryaddress', 'address']),
    detail:      pick(f, ['description', 'itemdescription', 'contents', 'remarks']),
    notes:       pick(f, ['comments', 'note', 'notes', 'reason']),
    items:       num(pick(f, ['pieces', 'pcs', 'quantity', 'items'])),
    weight:      num(pick(f, ['weight', 'actualweight', 'chargedweight'])),
    status,
    statusGroup: groupOf(status),
    amount:      cod,
    payout:      0,
    upfront:     0,
    reserve:     0,
    balance:     0,
    fee,
    tax,
    city:        pick(f, ['destinationcity', 'consigneecity', 'tocity', 'city',
                          'cityname', 'destination']),
    bookedOn:    day(pick(f, ['bookingdate', 'cndate', 'shipmentdate', 'orderdate',
                              'createddate', 'bookingdatetime'])),
    pickedOn:    day(pick(f, ['pickupdate', 'pickeddate'])),
    deliveredOn: day(pick(f, ['deliverydate', 'delivereddate', 'deliveredon',
                              'deliverydatetime'])),
    raw:         row
  };
}

/* ---------- the calls the app makes of any courier ---------- */

export async function testToken(token, extra) {
  const paths = [
    { name: '/cities',          path: '/cities' },
    { name: '/city/list',       path: '/city/list' },
    { name: '/getcities',       path: '/getcities' },
    { name: '/shipper',         path: '/shipper' },
    { name: '/account/balance', path: '/account/balance' }
  ];

  const got = await hunt({
    courier: 'mnp', job: 'test', token,
    shapes: shapesFor(paths, extra, token),
    send: sender(token, extra),
    good: a => {
      const list = rows(a.json);
      if (list) return { n: list.length };
      return a.json && typeof a.json === 'object' ? { n: 0 } : null;
    }
  });

  return {
    ok: true,
    statuses: [],
    shape: got.shape.name,
    message: 'M&P answered on ' + got.shape.name +
             (got.found.n ? ', ' + got.found.n + ' rows' : '')
  };
}

export async function fetchOrders(token, from, to, statusId, extra) {
  const dates = [
    { from_date: from,  to_date: to },
    { start_date: from, end_date: to },
    { fromDate: from,   toDate: to },
    { dateFrom: from,   dateTo: to }
  ];

  const paths = [];
  ['/shipments', '/consignments', '/cn/list', '/booking/list', '/orders',
   '/shipment/report'].forEach(p => {
    dates.forEach(d => paths.push({
      name: p + ' (' + Object.keys(d)[0] + ')',
      path: p,
      params: Object.assign({}, d,
                            extra && extra.shipper ? { shipper_code: extra.shipper } : {})
    }));
  });

  const got = await hunt({
    courier: 'mnp', job: 'orders', token,
    shapes: shapesFor(paths, extra, token),
    send: sender(token, extra),
    good: a => {
      const list = rows(a.json);
      if (!list) return null;
      const mapped = list.map(mapOrder).filter(x => x.tracking);
      if (list.length && !mapped.length) return null;
      return mapped;
    }
  });

  const seen = new Map();
  got.found.forEach(o => seen.set(o.tracking, o));
  return [...seen.values()];
}

export async function trackOne(token, tracking, extra) {
  const cn = String(tracking || '').trim();
  const paths = [];

  [{ p: '/tracking', k: 'cn_number' },
   { p: '/tracking', k: 'cnno' },
   { p: '/tracking', k: 'tracking_number' },
   { p: '/track',    k: 'cn_number' },
   { p: '/cn/status', k: 'cn_number' }].forEach(x => {
    const params = {};
    params[x.k] = cn;
    paths.push({ name: x.p + '?' + x.k, path: x.p, params });
  });
  ['/tracking/', '/track/', '/cn/'].forEach(p => {
    paths.push({ name: p + '<cn>', path: p + encodeURIComponent(cn) });
  });

  const got = await hunt({
    courier: 'mnp', job: 'track', token,
    shapes: shapesFor(paths, extra, token),
    send: sender(token, extra),
    good: a => {
      const list = rows(a.json);
      // M&P answer a tracking call with the parcel's whole history, newest
      // last - the current status is the last line of it, not the first.
      const r = list && list.length ? list[list.length - 1] : a.json;
      const one = r ? mapOrder(r) : null;
      if (!one || !one.status) return null;
      if (!one.tracking) one.tracking = cn;
      return one;
    }
  });

  return got.found;
}

export async function fetchPayment(token, tracking, extra) {
  const cn = String(tracking || '').trim();
  const paths = [
    { name: '/payments?cn_number', path: '/payments', params: { cn_number: cn } },
    { name: '/payment/status',     path: '/payment/status', params: { cn_number: cn } },
    { name: '/cod/status',         path: '/cod/status', params: { cn_number: cn } }
  ];

  const got = await hunt({
    courier: 'mnp', job: 'payment', token,
    shapes: shapesFor(paths, extra, token),
    send: sender(token, extra),
    good: a => {
      const list = rows(a.json);
      const r = list && list.length ? list[0] : a.json;
      return r && typeof r === 'object' ? r : null;
    }
  });

  const f = flatten(got.found, 0);
  const paid = pick(f, ['paymentdate', 'settlementdate', 'paiddate', 'chequedate']);
  const flag = pick(f, ['settled', 'ispaid', 'paid', 'paymentstatus', 'status']);

  return {
    tracking:  cn,
    orderRef:  pick(f, ['orderid', 'orderno', 'referenceno']),
    settled:   !!day(paid) || /^(1|true|yes|paid|settled|cleared)$/i.test(String(flag)),
    settledOn: day(paid),
    cprNumber: pick(f, ['cprnumber', 'cpr', 'paymentreference', 'chequeno',
                        'instrumentno', 'paymentid']),
    upfrontOn: null,
    reserveOn: null
  };
}

export const adapter = {
  key: 'mnp',
  name: 'M&P',
  fields: [
    { name: 'token', label: 'API key or password', secret: true,
      hint: 'whatever M&P gave you for the integration' },
    { name: 'username', label: 'Login / mailbox', optional: true,
      hint: 'if M&P sign you in with a mailbox rather than a key' },
    { name: 'password', label: 'Password', secret: true, optional: true,
      hint: 'only when the login above needs its own password' },
    { name: 'shipper', label: 'Shipper or cost centre code', optional: true,
      hint: 'the code on your M&P account, if you were given one' }
  ],
  hook: {
    where: 'ask M&P support to add a status callback for your account',
    note: 'M&P set webhooks up at their end rather than on a screen you can ' +
          'open. Send them this address and the header, and the moment they ' +
          'switch it on the calls appear below.'
  },
  groupOf,
  testToken,
  fetchOrders,
  fetchPayment,
  trackOne
};
