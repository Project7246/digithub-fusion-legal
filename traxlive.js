// What Trax has instead of a list.
//
// It was taken here for months that a Trax account can only ever know what its
// webhooks have told it, because Sonic has no call that takes a span of days.
// The first half of that is right and the second half hid the thing that
// matters: `/invoice` takes **one payment** and hands back every shipment in
// it. One id, a whole batch - charges, GST and all.
//
// That is the same shape as a PostEx CPR, and `cprlive.js` is the same idea
// written for PostEx's portal. So a Trax account fills itself the same way:
//
//   a payment webhook arrives carrying payment_id
//     -> the whole payment is read
//     -> every parcel in it is settled, with its charges and tax
//     -> the payment itself is written down as the receipt it is
//     -> and any parcel in it this app has never heard of is looked up
//
// That last line is the one that answers "how do past orders get in". A
// payment made this week pays for parcels delivered over the last fortnight,
// and most of them were booked before Fusion ever saw this account.

import { adapterFor } from './adapters.js';
import {
  saveOrders, savePayments, saveCprs, haveTrackings
} from './couriers.js';

// Parcels looked up three at a time, and never more than this many from one
// payment - a receipt with two thousand parcels on it should not become two
// thousand calls in the few seconds a webhook is being dealt with.
const STRANGER_CAP = Math.max(0, Number(process.env.TRAX_STRANGER_CAP) || 300);
const AT_ONCE = 3;

// Guard, so two webhooks about the same payment do not read it twice over.
const busy = new Set();

export function absorbing(accountId, paymentId) {
  return busy.has(String(accountId) + ':' + String(paymentId));
}

export async function absorbPayment(realmId, acc, paymentId, opts) {
  const a = adapterFor(acc.courier);
  if (!a || typeof a.fetchInvoice !== 'function') return 0;

  const id = String(paymentId == null ? '' : paymentId).trim();
  if (!id) return 0;

  const lock = String(acc.id) + ':' + id;
  if (busy.has(lock)) return 0;
  busy.add(lock);

  try {
    const inv = await a.fetchInvoice(acc.token, id, (opts && opts.type) || 2);
    if (!inv.parcels.length) return 0;

    // The payment is the receipt. Written down under the same roof as a
    // PostEx CPR so the finance screens do not have to know which courier
    // paid - CLOSED because a payment that exists is money that moved.
    await saveCprs(realmId, acc.id, acc.courier, [{
      cprNumber:  inv.id,
      remoteId:   inv.id,
      status:     (opts && opts.status) || 'CLOSED',
      netAmount:  inv.parcels.reduce((n, p) => n + (Number(p.amount) || 0), 0),
      createdOn:  inv.invoiceDate,
      approvedOn: inv.invoiceDate,
      raw:        { billing_method: inv.billingMethod, parcels: inv.parcels.length }
    }]);

    const settled = await savePayments(realmId, acc.id, inv.parcels);

    // Everything in this payment we hold no row for. They are parcels: they
    // were delivered and paid for. Not writing them down would leave the
    // money against nothing.
    let brought = 0;
    if (typeof a.trackOne === 'function' && STRANGER_CAP) {
      const names = inv.parcels.map(p => p.tracking);
      const known = await haveTrackings(realmId, acc.id, names);
      const strangers = names.filter(t => !known.has(t)).slice(0, STRANGER_CAP);

      for (let i = 0; i < strangers.length; i += AT_ONCE) {
        const answers = await Promise.all(
          strangers.slice(i, i + AT_ONCE).map(
            cn => a.trackOne(acc.token, cn).catch(() => null))
        );
        const good = answers.filter(o => o && o.tracking);
        if (good.length) {
          try { brought += await saveOrders(realmId, acc.id, acc.courier, good); }
          catch (e) { /* the payment is still written down */ }
        }
      }

      // their charges were saved above, but a parcel written after them has
      // nothing on it yet, so the same lines go on again
      if (brought) await savePayments(realmId, acc.id, inv.parcels);
    }

    return { parcels: inv.parcels.length, settled, brought };
  } finally {
    busy.delete(lock);
  }
}
