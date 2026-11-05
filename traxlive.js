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
  saveOrders, savePayments, saveCprs, haveTrackings, linkCprParcels,
  clearCprStrays, cprParcelCounts, clearCprWithoutCover
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

/* ==================== the portal's own payment list ====================

   `absorbPayment` above is the webhook's path: Trax tell us a payment id and
   `/invoice` opens it. That only ever covers a payment that arrived **after**
   the webhook was switched on, and for an account whose webhooks were never
   set up it covers nothing at all - which is how an account can hold thirteen
   thousand parcels and not one receipt.

   The portal has the whole list and always did (traxportal.js `payments`), so
   this is the same job done from the other side: read every payment, write it
   down as the receipt it is, and put its number on the parcels it paid for.
   Nothing here asks the courier about a parcel one at a time.                */

// account|payment -> when its shipment lists were last read.
//
// A payment is skipped when what we hold matches the courier's own count, and
// that is the usual case - but an account whose parcels were never all
// imported never matches, and without this it would read three lists for
// every payment on every visit to /receipts, for ever. A restart reads them
// again, which is the right price for a memory that costs nothing.
const readAt = new Map();
const AGAIN = Math.max(5, Number(process.env.TRAX_PAYMENT_REREAD_MINUTES) || 360) * 60000;

// and never more than this many in one run, so one visit cannot turn into
// thirty calls through the relay
const PER_RUN = Math.max(1, Number(process.env.TRAX_PAYMENTS_PER_RUN) || 6);

export async function absorbPortalPayments(realmId, acc, opts = {}) {
  const a = adapterFor(acc.courier);
  const portal = a && a.portal;
  if (!portal || !portal.payments) {
    return { covers: 0, linked: 0, note: 'this courier has no payment screen here' };
  }

  // The caller is already signed in - the backfill signs in once for the
  // parcels and the payments are the same visit. Signing in a second time
  // while the first session is live is what Trax refuse, and the refusal
  // reads as a wrong password, which it is not.
  const session = opts.session ||
    await portal.sessionFor(acc.id, acc.portal_email, opts.secret);
  const covers = await portal.payments(session, {});

  // **An answer of "no payments" is still an answer.** `asked()` throws when
  // the sign-in has gone or the feed is not a list, so an empty list here is
  // the screen itself saying the account has none - and an account with no
  // payments certainly has no parcels inside one. Returning early left Trax -
  // ElRB showing twenty-two receipts that no payment of theirs ever issued.
  if (!covers.length) {
    return { covers: 0, linked: 0, cleared: 0, read: 0,
             orphans: await clearCprWithoutCover(realmId, acc.id) };
  }

  await saveCprs(realmId, acc.id, acc.courier, covers);

  const say = typeof opts.say === 'function' ? opts.say : () => {};

  // **Every kind of shipment the payment holds.** Their screen prints
  // `total_shipments` and then a button per kind, and the three buttons add
  // up to it: delivered + returned + adjusted. Reading two of the three left
  // the third out of the receipt, and left it free to be stamped with some
  // other payment's number by the per-parcel call.
  const KINDS = ['delivered', 'returned', 'adjusted'];

  // What is already under each of these numbers here. A payment whose parcels
  // are all in agrees with the courier's own count, and is not read again -
  // which is what makes this safe to run on every visit to /receipts rather
  // than only on a backfill. `force` reads them all whatever we hold.
  const held = await cprParcelCounts(realmId, acc.id, covers.map(c => c.cprNumber));

  // Read first, write second. A parcel stamped with payment B that really
  // belongs to payment A must be linked to A before B is allowed to let go
  // of its strays, or the run itself would lose it until the next one.
  const lists = new Map();
  let read = 0;

  for (const c of covers) {
    if (opts.stop && opts.stop()) break;

    const want = Number((c.raw && c.raw.shipments) || 0);
    const have = held.get(String(c.cprNumber)) || 0;
    const key = acc.id + '|' + c.cprNumber;

    if (!opts.force) {
      if (want && have === want) continue;                // already whole
      const last = readAt.get(key) || 0;
      if (Date.now() - last < AGAIN) continue;            // asked recently
      if (read >= PER_RUN) break;                         // enough for one visit
    }

    const all = [];
    let asked = 0;

    for (const kind of KINDS) {
      try {
        const list = await portal.paymentShipments(session, c.remoteId || c.cprNumber, kind);
        asked += 1;
        list.forEach(t => all.push(t));
      } catch (e) {
        say('Payment ' + c.cprNumber + ' (' + kind + '): ' + e.message);
      }
    }

    // A payment whose kinds would not all answer is not a payment we know the
    // whole of, so it is linked but never cleared - half a list is the one
    // thing clearCprStrays must not be given.
    if (!all.length) continue;
    lists.set(c.cprNumber, { trackings: all, whole: asked === KINDS.length, cover: c });
    if (asked === KINDS.length) readAt.set(key, Date.now());
    read += 1;
  }

  // ---- link ----
  //
  // `settled` is left alone on purpose. Whether this payment has actually
  // been paid is the cover's own status, and dashdata reads that - writing a
  // flag here would be the same mistake M&P's mapper made, where a payment
  // that merely existed counted as money received.
  let linked = 0;
  for (const [cpr, item] of lists) {
    linked += await linkCprParcels(realmId, acc.id, cpr, item.trackings,
      item.cover.createdOn ? String(item.cover.createdOn).slice(0, 10) : null);
  }

  // ---- and let the strangers go ----
  let cleared = 0;
  for (const [cpr, item] of lists) {
    if (!item.whole) continue;
    cleared += await clearCprStrays(realmId, acc.id, cpr, item.trackings);
  }

  // The payment screen has just answered, so a number on a parcel that no
  // payment of theirs - and no webhook of theirs - ever issued is a number
  // this app invented. Those showed as receipts of one or five parcels with
  // no status and no date on them.
  const orphans = await clearCprWithoutCover(realmId, acc.id);

  return { covers: covers.length, read, linked, cleared, orphans };
}
