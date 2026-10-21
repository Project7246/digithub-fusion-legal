// Trax books and tracks through Sonic, the platform behind it. This file is
// written against their own document - API Documentation-SONIC, version 2.0,
// 18 April 2022 - so there is nothing left to guess at:
//
//   live     https://sonic.pk          testing  http://app.sonic.pk
//   the key  portal -> company name (top right) -> Profile -> API key
//   handed   over as a plain `Authorization` header, not a Bearer token
//
// Two things about Sonic decide the shape of everything below.
//
// **`status: 0` means it worked.** It is their own code, not an HTTP one, and
// it sits in the body of a 200. So nothing here reads `status` as a failure.
//
// **Sonic has no "give me a day's shipments" call.** Twenty-seven endpoints and
// every one of them is about a tracking number you already have, or about
// booking a new one. So Trax cannot be swept the way PostEx is, and pretending
// otherwise would be a page of empty days. Instead:
//
//   - the **webhooks** are where Trax orders come from. There are four of them,
//     and between them they carry the status, the money, the weight and the
//     settlement - everything a sweep would have gone looking for.
//   - `refreshKnown()` tops up the parcels we already hold, by name.
//
// So `lists: false` on the adapter, and the keeper asks for the one it can.

import { makeGrouper, num, day } from './statuses.js';
import { flatten, pick } from './hooks.js';
import { qs, call, rows } from './wire.js';

const BASE = (process.env.TRAX_BASE || 'https://sonic.pk/api').replace(/\/+$/, '');

// Sonic writes a status as "<what> - <where it got to>": "Shipment - Out for
// Delivery", "Shipment-Arrived at Origin", "Payment - Processed". The whole
// string is what gets stored, because that is what the courier said; these are
// the ones whose bucket is not obvious from the words alone.
const GROUPS = {
  'shipment - booked':                 'booked',
  'shipment-booked':                   'booked',
  'shipment - arrival service center': 'transit',
  'shipment - arrived at origin':      'transit',
  'shipment-arrived at origin':        'transit',
  'shipment - arrived at destination': 'transit',
  'shipment - out for delivery':       'transit',
  'shipment - delivery unsuccessful':  'transit',
  'shipment - delivered':              'delivered',
  'shipment - return to shipper':      'returning',
  'shipment - returned to shipper':    'returned',
  'shipment - return received':        'returned',
  'shipment - lost':                   'lost',
  'shipment - damaged':                'damaged',
  'shipment - cancelled':              'cancelled',
  // A replacement is a parcel swapped at the door: the new one was handed over,
  // so as far as the books are concerned it was delivered.
  'replacement-exchanged':             'delivered',
  'replacement - exchanged':           'delivered'
};

export const groupOf = makeGrouper(GROUPS);

// Sonic's own code for "it worked" is 0, and some calls answer with no code at
// all. Only a code that is there and is not 0 is a refusal.
function sonicOk(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.status === undefined || json.status === null) return true;
  return Number(json.status) === 0;
}

function headers(token) {
  return { Authorization: String(token || '') };
}

async function ask(token, path, params) {
  const r = await call({ url: qs(BASE, path, params), headers: headers(token) });

  if (r.status === 401 || r.status === 403) {
    throw new Error('Trax refused the API key');
  }
  // Nothing came back at all, which is a different thing from Trax saying no -
  // and on this app it has a known cause, so it is worth naming rather than
  // leaving as "fetch failed".
  if (r.status === 0) {
    throw new Error('Trax could not be reached from this server (' + r.text + '). ' +
      'Press "Can this server reach Trax?" on the couriers page - sonic.pk ' +
      'answers from inside Pakistan and this app is hosted in Bangalore.');
  }
  if (!r.ok) {
    throw new Error(`Trax said ${r.status}: ` +
                    String((r.json && (r.json.message || r.json.error)) || r.text).slice(0, 200));
  }
  if (!sonicOk(r.json)) {
    throw new Error('Trax said: ' +
                    String((r.json && r.json.message) || 'it would not do that').slice(0, 200));
  }
  return r.json || {};
}

/* ---------- a shipment, in the app's own shape ---------- */

// `/shipment/track` answers with one nested object: shipper, pickup,
// consignee, order_information and the whole tracking_history, newest first.
export function mapTracked(details) {
  const d = details || {};
  const consignee = d.consignee || {};
  const info = d.order_information || {};
  const history = Array.isArray(d.tracking_history) ? d.tracking_history : [];

  // newest first in their example, but a timestamp is there on every line, so
  // the latest is picked rather than assumed
  const latest = history.slice().sort(
    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0] || {};

  const status = String(latest.status || '').trim();
  const group = groupOf(status);

  const lineOf = want => {
    const hit = history.find(h => groupOf(h.status) === want);
    return hit ? day(hit.date_time) : null;
  };

  const items = Array.isArray(info.items) ? info.items : [];

  return {
    tracking:    String(d.tracking_number || '').trim(),
    orderRef:    String(d.order_id || '').trim(),
    customer:    consignee.name || '',
    phone:       consignee.phone_number_1 || consignee.phone_number_2 || '',
    address:     consignee.address || '',
    detail:      items.map(i => i.description || i.product_type || '').filter(Boolean).join(', '),
    notes:       latest.status_reason || info.instructions || '',
    items:       items.reduce((n, i) => n + (num(i.quantity) || 0), 0) || items.length,
    weight:      num(info.weight),
    status,
    statusGroup: group,
    amount:      num(info.amount),
    payout:      0,
    upfront:     0,
    reserve:     0,
    balance:     0,
    fee:         0,
    tax:         0,
    city:        consignee.destination || (d.pickup && d.pickup.origin) || '',
    bookedOn:    lineOf('booked') || day(history.length
                   ? history[history.length - 1].date_time : null),
    pickedOn:    lineOf('transit'),
    deliveredOn: group === 'delivered' ? day(latest.date_time) : lineOf('delivered'),
    // the history is the useful part of what they sent and it is small; the
    // rest of the nesting is not kept
    raw:         { tracking_history: history.slice(0, 12) }
  };
}

/* ---------- the calls ---------- */

// The cheapest thing Sonic will hand over, and it proves the key.
export async function testToken(token) {
  const j = await ask(token, '/cities', {});
  const list = rows(j) || [];
  return {
    ok: true,
    statuses: [],
    shape: 'Authorization header',
    message: 'Trax answered' + (list.length ? ' with ' + list.length + ' cities' : '')
  };
}

// type=0 is the shipper's own tracking - it is the one that carries weight and
// payment lines. type=1 is what a consignee sees.
export async function trackOne(token, tracking) {
  const j = await ask(token, '/shipment/track', {
    tracking_number: String(tracking || '').trim(),
    type: 0
  });

  const d = j.details || (j.data && j.data.details) || null;
  if (!d) throw new Error('Trax knows nothing about ' + tracking);
  return mapTracked(d);
}

// Just the words, for when the whole history is not wanted.
export async function statusOne(token, tracking) {
  const j = await ask(token, '/shipment/status', {
    tracking_number: String(tracking || '').trim(),
    type: 0
  });
  const s = String(j.current_status || j['current_status'] || '').trim();
  return { tracking: String(tracking), status: s, statusGroup: groupOf(s) };
}

// What Trax charged for a parcel. Their `net_payable` is what the merchant is
// owed, so it is not a fee - the fee is total_charges, and gst is the tax.
export async function fetchCharges(token, tracking) {
  const j = await ask(token, '/shipment/charges',
                      { tracking_number: String(tracking || '').trim() });
  const c = j.charges || {};
  return {
    tracking:  String(tracking),
    fee:       num(c.total_charges) || (num(c.weight_charges) + num(c.fuel_surcharge) +
                                        num(c.cash_handling_charges)),
    tax:       num(c.gst),
    netPayable: num(c.net_payable),
    raw: c
  };
}

// Settlement. `/shipment/payments` carries the payment status and every
// payment made against the parcel; the payment's own id is the nearest thing
// Trax has to PostEx's CPR number, so that is where it is kept.
export async function fetchPayment(token, tracking) {
  const cn = String(tracking || '').trim();
  const j = await ask(token, '/shipment/payments', { tracking_number: cn });

  const said = String(j.current_payment_status || '').trim();
  const paid = Array.isArray(j.payments) ? j.payments : [];
  const first = paid[0] || {};

  return {
    tracking:   cn,
    orderRef:   '',
    settled:    /processed|paid|cleared|transferred/i.test(said) || paid.length > 0,
    settledOn:  day(first.datetime),
    cprNumber:  first.id === undefined || first.id === null ? '' : String(first.id),
    upfrontOn:  null,
    reserveOn:  null,
    status:     said,
    amount:     num(first.payable) || num(first.amount),
    fee:        num(first.charges),
    tax:        num(first.gst)
  };
}

// Sonic cannot be asked for a span of days, so this is the sweep's shape for
// Trax: the parcels we already hold, asked about by name, newest first and
// capped - a courier that only answers one at a time is a courier it is easy
// to spend an afternoon and a month's compute on.
export async function refreshKnown(token, trackings, extra) {
  const want = (trackings || []).map(t => String(t).trim()).filter(Boolean);
  const cap = Math.max(1, Number((extra && extra.cap) || process.env.TRAX_REFRESH_CAP) || 60);
  const list = want.slice(0, cap);

  const out = [];
  // three at a time: polite to them, and quick enough that the database is not
  // being held awake while we wait
  for (let i = 0; i < list.length; i += 3) {
    const answers = await Promise.all(
      list.slice(i, i + 3).map(cn => trackOne(token, cn).catch(() => null))
    );
    answers.forEach(o => { if (o && o.tracking) out.push(o); });
  }
  return out;
}

/* ---------- the four webhooks ---------- */
//
// Sonic has one toggle per kind in the portal (Shipment Status, Payment Status,
// Initial Charges, Final Charges) and each takes **a URL and nothing else** -
// there is no field for a header. So the address itself has to carry both
// secrets, which is why the hook URL for Trax is handed over with `?k=` on the
// end and why `headerless` is set below.
//
// Their rules, which the route has to live up to: five attempts, **three
// seconds** each, and after five failures the subscription is switched off and
// has to be turned on again by hand. So the route answers before it does
// anything slow, and never with a 500.
//
// What each one sends (their document, sections 24 to 27):
//
//   status    tracking_number, status, date_time
//   payment   tracking_number, status, date_time, payment_id
//   charges   tracking_number, origin, destination, cod_amount, actual_weight,
//             chargeable_weight, weight_charges, cash_handling_charges,
//             insurance_charges, fuel_surcharges, gst, total_charges,
//             net_payable  (+ packaging/return/replacement/try_buy/intercept/
//             nsa charges on the final one)
export function readHook(body) {
  const f = flatten(body, 0);

  const tracking = pick(f, ['trackingnumber', 'tracking', 'cn', 'cnnumber']);
  const status = pick(f, ['status', 'currentstatus', 'shipmentstatus']);
  const when = pick(f, ['datetime', 'date', 'time']);
  const paymentId = pick(f, ['paymentid']);
  const totals = pick(f, ['totalcharges', 'weightcharges', 'netpayable']);

  // which of the four this is. The payment hook is the one carrying a payment
  // id or a status that begins with "Payment"; a charges hook carries charges
  // and usually no status at all.
  let kind = 'status';
  if (paymentId || /^payment/i.test(status)) kind = 'payment';
  else if (!status && totals) kind = 'charges';

  return {
    kind,
    tracking,
    status,
    ref: '',
    when,
    amount: pick(f, ['codamount']),
    city: pick(f, ['destination']),
    // the money side, for the two charges hooks - this is the whole reason
    // Trax needs so little polling
    fee: pick(f, ['totalcharges']),
    tax: pick(f, ['gst']),
    weight: pick(f, ['chargeableweight', 'actualweight']),
    paymentId,
    settled: kind === 'payment' && /processed|paid|cleared/i.test(status)
  };
}

export const adapter = {
  key: 'trax',
  name: 'Trax',
  // where it lives, so the reach check can be run from the server itself
  base: BASE,
  // Sonic hands out one API key per account, and that is the whole sign-in.
  fields: [
    { name: 'token', label: 'API key', secret: true,
      hint: 'sonic.pk → click your company name (top right) → Profile → API key' }
  ],
  hook: {
    where: 'sonic.pk → Settings → Webhooks',
    note: 'Four toggles - Shipment Status, Payment Status, Initial Charges, ' +
          'Final Charges. Paste this same address into all four; Fusion can ' +
          'tell them apart. Trax waits only 3 seconds and switches a webhook ' +
          'off after 5 failures, so turn each one on while Fusion is up.',
    // Sonic's webhook screen takes a URL and nothing else - no header field -
    // so the second secret rides in the address as ?k=
    headerless: true
  },
  // No endpoint anywhere in their API lists a day's shipments, so the keeper
  // tops up what we hold instead of asking for days.
  lists: false,
  groupOf,
  readHook,
  testToken,
  trackOne,
  statusOne,
  fetchCharges,
  fetchPayment,
  refreshKnown
};
