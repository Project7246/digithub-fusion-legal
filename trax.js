// Trax speaks through Sonic, the platform behind it: the API is at sonic.pk and
// the key is on the portal's own profile screen. Like postex.js, this file is
// the whole of that dialect - nothing above it ever sees a Trax field name.
//
// One thing is different, and it is the reason wire.js exists. PostEx published
// its guide; Trax hands one out account by account, and the endpoint that
// answers on one merchant's key is a 404 on another's. So every call here is a
// short list of the shapes it could take, the first one Trax actually answers
// is remembered for that key, and when none of them answer the error says what
// each attempt was told. Locking in an address we only half know would have
// been the same work and a worse error.
//
// If Trax send their guide, the lists below are where it goes, and nothing
// else in the app changes.

import { makeGrouper, num, day } from './statuses.js';
import { flatten, pick } from './hooks.js';
import { qs, call, rows, hunt, knownAuth } from './wire.js';

const BASE = (process.env.TRAX_BASE || 'https://sonic.pk/api').replace(/\/+$/, '');

// Trax's own words, as they appear on the portal. Anything not here is read by
// the word rules in statuses.js, which is what carries a status added later.
const GROUPS = {
  'draft':                         'unbooked',
  'unbooked':                      'unbooked',
  'booked':                        'booked',
  'shipment booked':               'booked',
  'order created':                 'booked',
  'pickup requested':              'booked',
  'pickup scheduled':              'transit',
  'picked':                        'transit',
  'picked up':                     'transit',
  'arrived at origin station':     'transit',
  'departed from origin station':  'transit',
  'in transit':                    'transit',
  'arrived at destination station':'transit',
  'out for delivery':              'transit',
  'delivery attempted':            'transit',
  'on hold':                       'review',
  'delivered':                     'delivered',
  'out for return':                'returning',
  'return in transit':             'returning',
  'returned to shipper':           'returned',
  'return received':               'returned',
  'rto delivered':                 'returned',
  'cancelled':                     'cancelled',
  'canceled':                      'cancelled',
  'lost':                          'lost',
  'damaged':                       'damaged'
};

export const groupOf = makeGrouper(GROUPS);

/* ---------- the key, and how Trax wants to be handed it ---------- */
// Three ways have been seen in the wild and the key itself does not say which
// one it is, so each is tried once and the one that works is kept.
const AUTHS = [
  { name: 'Authorization',        head: k => ({ Authorization: k }) },
  { name: 'Authorization Bearer', head: k => ({ Authorization: 'Bearer ' + k }) },
  { name: 'x-api-key',            head: k => ({ 'x-api-key': k }) },
  { name: 'api_key in the query', head: () => ({}), query: k => ({ api_key: k }) }
];

// Once one call has been accepted, the way this key is handed over is settled,
// so the rest of them stop trying the other three.
function shapesFor(paths, token) {
  const known = knownAuth('trax', token);
  const auths = known ? [known] : AUTHS;

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

function sender(token) {
  return shape => call({
    url: qs(BASE, shape.path,
            Object.assign({}, shape.params,
                          shape.auth.query ? shape.auth.query(token) : {})),
    method: shape.method,
    headers: shape.auth.head(token),
    body: shape.body
  });
}

/* ---------- one order, in the app's own shape ---------- */

export function mapOrder(row) {
  const f = flatten(row, 0);
  const status = pick(f, [
    'status', 'shipmentstatus', 'currentstatus', 'statusname', 'trackingstatus',
    'orderstatus', 'statusmessage', 'laststatus'
  ]);

  const cod = num(pick(f, ['codamount', 'cod', 'collectableamount', 'amount',
                           'invoicevalue', 'orderamount', 'productvalue']));
  const fee = num(pick(f, ['deliverycharges', 'servicecharges', 'totalcharges',
                           'charges', 'shippingcharges', 'fee']));
  const tax = num(pick(f, ['gst', 'salestax', 'tax', 'taxamount']));

  return {
    tracking:    pick(f, ['trackingnumber', 'tracking', 'cn', 'cnnumber', 'cnno',
                          'awb', 'awbnumber', 'consignmentnumber', 'trackingid']),
    orderRef:    pick(f, ['orderid', 'orderrefnumber', 'orderref', 'referencenumber',
                          'reference', 'referenceno', 'consigneeorderid']),
    customer:    pick(f, ['consigneename', 'customername', 'receivername', 'name']),
    phone:       pick(f, ['consigneephone', 'customerphone', 'phone', 'mobile',
                          'consigneemobile', 'contactnumber']),
    address:     pick(f, ['consigneeaddress', 'deliveryaddress', 'address',
                          'customeraddress']),
    detail:      pick(f, ['itemdescription', 'productdescription', 'orderdetail',
                          'description', 'remarks']),
    notes:       pick(f, ['comments', 'note', 'notes', 'statusremarks']),
    items:       num(pick(f, ['pieces', 'quantity', 'items', 'noofpieces'])),
    weight:      num(pick(f, ['weight', 'actualweight', 'bookingweight'])),
    status,
    statusGroup: groupOf(status),
    amount:      cod,
    payout:      0,
    upfront:     0,
    reserve:     0,
    balance:     0,
    fee,
    tax,
    city:        pick(f, ['destinationcity', 'consigneecity', 'city', 'cityname',
                          'deliverycity']),
    bookedOn:    day(pick(f, ['bookingdate', 'shipmentdate', 'orderdate',
                              'createdat', 'createddate', 'bookingdatetime'])),
    pickedOn:    day(pick(f, ['pickupdate', 'pickeddate', 'pickupdatetime'])),
    deliveredOn: day(pick(f, ['deliverydate', 'delivereddate', 'deliveredon',
                              'deliverydatetime'])),
    raw:         row
  };
}

/* ---------- the calls the app makes of any courier ---------- */

// Proves the key, and nothing else. A city list is the cheapest thing a courier
// will hand over, so that is what is asked for.
export async function testToken(token) {
  const paths = [
    { name: '/cities',            path: '/cities' },
    { name: '/city/list',         path: '/city/list' },
    { name: '/cities/list',       path: '/cities/list' },
    { name: '/pickup_address',    path: '/pickup_address' },
    { name: '/shipment/payments', path: '/shipment/payments' }
  ];

  const got = await hunt({
    courier: 'trax', job: 'test', token,
    shapes: shapesFor(paths, token),
    send: sender(token),
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
    message: 'Trax answered on ' + got.shape.name +
             (got.found.n ? ', ' + got.found.n + ' rows' : '')
  };
}

// Every order in a span of days.
export async function fetchOrders(token, from, to, statusId, extra) {
  const dates = [
    { start_date: from, end_date: to },
    { from_date: from,  to_date: to },
    { fromDate: from,   toDate: to },
    { startDate: from,  endDate: to },
    { date_from: from,  date_to: to }
  ];

  const paths = [];
  ['/shipment/list', '/shipments', '/shipment/all', '/shipment/report',
   '/shipment/payments', '/orders'].forEach(p => {
    dates.forEach(d => paths.push({
      name: p + ' (' + Object.keys(d)[0] + ')',
      path: p,
      params: Object.assign({}, d,
                            extra && extra.account ? { account: extra.account } : {})
    }));
  });

  const got = await hunt({
    courier: 'trax', job: 'orders', token,
    shapes: shapesFor(paths, token),
    send: sender(token),
    good: a => {
      const list = rows(a.json);
      if (!list) return null;
      const mapped = list.map(mapOrder).filter(x => x.tracking);
      // an address that answers with rows carrying no tracking number is the
      // wrong address, not an empty day
      if (list.length && !mapped.length) return null;
      return mapped;
    }
  });

  const seen = new Map();
  got.found.forEach(o => seen.set(o.tracking, o));
  return [...seen.values()];
}

// One parcel, asked about by name.
export async function trackOne(token, tracking) {
  const cn = String(tracking || '').trim();
  const paths = [];

  [{ p: '/shipment/track',  k: 'tracking_number' },
   { p: '/shipment/track',  k: 'cn_number' },
   { p: '/shipment/track',  k: 'tracking_no' },
   { p: '/track',           k: 'tracking_number' },
   { p: '/shipment/status', k: 'tracking_number' }].forEach(x => {
    const params = {};
    params[x.k] = cn;
    paths.push({ name: x.p + '?' + x.k, path: x.p, params });
  });
  ['/shipment/track/', '/track/'].forEach(p => {
    paths.push({ name: p + '<cn>', path: p + encodeURIComponent(cn) });
  });

  const got = await hunt({
    courier: 'trax', job: 'track', token,
    shapes: shapesFor(paths, token),
    send: sender(token),
    good: a => {
      const list = rows(a.json);
      const one = list && list.length ? mapOrder(list[0])
                                      : (a.json ? mapOrder(a.json) : null);
      return one && one.status ? one : null;
    }
  });

  return got.found;
}

// What Trax has paid out for a parcel. Trax settles by receipt the way PostEx
// does, so the same few fields come back and the receipts page needs no new
// reading.
export async function fetchPayment(token, tracking) {
  const cn = String(tracking || '').trim();
  const paths = [
    { name: '/shipment/payments?tracking_number', path: '/shipment/payments',
      params: { tracking_number: cn } },
    { name: '/payment/status?tracking_number',    path: '/payment/status',
      params: { tracking_number: cn } },
    { name: '/shipment/payment/<cn>',
      path: '/shipment/payment/' + encodeURIComponent(cn) }
  ];

  const got = await hunt({
    courier: 'trax', job: 'payment', token,
    shapes: shapesFor(paths, token),
    send: sender(token),
    good: a => {
      const list = rows(a.json);
      const r = list && list.length ? list[0] : a.json;
      return r && typeof r === 'object' ? r : null;
    }
  });

  const f = flatten(got.found, 0);
  const paid = pick(f, ['settlementdate', 'paymentdate', 'paiddate', 'settledon']);
  const flag = pick(f, ['settled', 'ispaid', 'paid', 'paymentstatus', 'status']);

  return {
    tracking:  cn,
    orderRef:  pick(f, ['orderid', 'orderrefnumber', 'reference']),
    settled:   !!day(paid) || /^(1|true|yes|paid|settled|completed)$/i.test(String(flag)),
    settledOn: day(paid),
    cprNumber: pick(f, ['cprnumber', 'cpr', 'paymentreference',
                        'settlementreference', 'invoicenumber', 'paymentid']),
    upfrontOn: null,
    reserveOn: null
  };
}

// Trax's webhooks carry the same field names its order rows do, so the reader
// in hooks.js finds them without help. It is named here all the same: the day
// Trax sends a shape of its own, this is the one place that has to change.
export const adapter = {
  key: 'trax',
  name: 'Trax',
  // One key, and the account number only where a sign-in holds several. The
  // first field is always the one kept as the account's token.
  fields: [
    { name: 'token', label: 'API key', secret: true,
      hint: 'sonic.pk → Settings → Profile → API key' },
    { name: 'account', label: 'Account number', optional: true,
      hint: 'only if this sign-in holds more than one Trax account' }
  ],
  hook: {
    where: 'sonic.pk → Settings → Webhooks',
    note: 'Trax offers a webhook per event. Paste this one address into each of ' +
          'them — status, delivery and return all read the same here.'
  },
  groupOf,
  testToken,
  fetchOrders,
  fetchPayment,
  trackOne
};
