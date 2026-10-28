// What the CPR pages read.
//
// Receipts are asked from the courier when they are asked for. The list of
// receipts is small and is written down so the page knows which ones have
// already been receipted in QuickBooks; what is inside a receipt is not
// written down at all - a single receipt can be two thousand orders, and ten
// accounts of those would be gigabytes a year for something QuickBooks
// already holds once it is posted. It is kept in memory for a few minutes
// instead, which is all a person clicking around needs.

import {
  getAccount, saveCprs, listPortalCprs, saveCprTotals, cprsMissingTotals,
  cprsToLink, markCprLinked, savePayments
} from './couriers.js';
import { adapterFor } from './adapters.js';
import { decrypt } from './secrets.js';
import {
  tokenFor, forget as forgetToken,
  fetchCprs, fetchSummary, fetchTransactions, fetchAdjustments
} from './postexportal.js';

/* ==================== the account, signed in ==================== */

// Everything the portal calls need, gathered in one place. The password is
// only ever decrypted here, and never leaves this object.
async function sessionFor(realmId, accountId) {
  const acc = await getAccount(realmId, accountId);
  if (!acc) throw new Error('No such courier account');
  if (acc.courier !== 'postex') {
    throw new Error(`${acc.courier} has no receipts adapter yet`);
  }
  if (!acc.portal_email || !acc.portal_secret) {
    throw new Error('This account has no PostEx sign-in saved. Add it on the Couriers page.');
  }

  const email = acc.portal_email;
  const password = decrypt(acc.portal_secret);

  const t = await tokenFor(acc.id, email, password);

  return {
    accountId:  acc.id,
    label:      acc.label,
    email,
    password,
    jwt:        t.jwt,
    merchantId: acc.merchant_id || t.merchantId
  };
}

export function forget(accountId) {
  forgetToken(Number(accountId));
  for (const k of [...detail.keys()]) {
    if (k.startsWith(accountId + '|')) detail.delete(k);
  }
}

/* ==================== the list ==================== */

// Asked from PostEx, then written down - the writing is only so the page can
// show which receipts have already been paid into QuickBooks.
export async function refreshCprs(realmId, accountId, from, to) {
  const s = await sessionFor(realmId, accountId);
  const rows = await fetchCprs(s, from, to);

  await saveCprs(realmId, s.accountId, 'postex', rows.map(r => ({
    cprNumber:  r.cpr,
    remoteId:   r.remoteId,
    status:     r.status,
    statusId:   r.statusId,
    netAmount:  r.netAmount,
    createdOn:  r.createdOn,
    approvedOn: r.approvedOn,
    raw:        {}                    // the row itself is already in our columns
  })));

  // The list only carries the net - what the courier pays out. The figure a
  // QuickBooks payment has to match is the COD it collected, and that is in
  // each receipt's summary. Read once per receipt and kept, so the list stays
  // a database read afterwards.
  await fillTotals(realmId, s).catch(() => {});

  return rows.length;
}

async function fillTotals(realmId, s){
  const need = await cprsMissingTotals(realmId, s.accountId, 12);
  if (!need.length) return;

  for (const c of need) {
    try {
      const sum = await fetchSummary(s, c.remoteId, c.createdOn);

      await saveCprTotals(realmId, s.accountId, c.cpr, {
        cod: sum.grandTotal,
        charges: sum.codCharges + sum.upfrontCharges,
        tax: sum.tax,
        withholding: sum.salesTax + sum.incomeTax,
        orders: (sum.lines || []).reduce((a, l) => a + l.orders, 0)
      });
    } catch (e) {
      // one receipt refusing to answer should not stop the rest
    }
  }
}

// What the page draws: our own rows, so the QuickBooks column comes with them.
export async function listCprs(realmId, opts) {
  return listPortalCprs(realmId, opts);
}

/* ==================== one receipt ==================== */

// account id + receipt id -> { at, value }
const detail = new Map();
const HOLD = 10 * 60 * 1000;      // ten minutes
const KEEP = 3;                   // three receipts at a time, no more

function remember(key, value) {
  detail.set(key, { at: Date.now(), value });

  while (detail.size > KEEP) {
    const oldest = [...detail.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    detail.delete(oldest[0]);
  }
}

// ==================== reading a receipt into the parcels ====================
//
// A CPR names every parcel it paid for, and PostEx hands that list over in one
// call. So the money on five thousand parcels is twenty calls, not five
// thousand - and the list carries the fee, the tax and the settlement date,
// which is why the charges column used to sit at zero.
//
// "postex ko khud btna chahiy total itny paracels hn or itni payment h, or
// sary status sb kuch wo khud btye." This is that, as far as PostEx will go:
// it will not push the money to us, but it will hand over a whole receipt at
// a time instead of being asked about one parcel at a time.
export async function absorbCpr(realmId, accountId, cpr) {
  const s = await sessionFor(realmId, accountId);
  const rows = await fetchTransactions(s, cpr.remoteId);
  if (!rows.length) {
    await markCprLinked(realmId, accountId, cpr.cpr);
    return 0;
  }

  // A closed receipt is money received; an open one names the parcels it will
  // pay for and has not. Both are worth writing down - the second is what
  // makes "in a CPR, not paid yet" a real line rather than a guess.
  const paid = String(cpr.status || '').toUpperCase() === 'CLOSED';

  const n = await savePayments(realmId, accountId, rows.map(o => ({
    tracking:  o.tracking,
    settled:   paid && o.settled !== false,
    settledOn: o.settledOn || null,
    cprNumber: cpr.cpr,
    fee:       o.fee,
    tax:       o.tax
  })));

  await markCprLinked(realmId, accountId, cpr.cpr);
  return n;
}

// Every receipt that has not been read in yet, newest first. Bounded by time
// like the per-parcel chase, and guarded by the same set so two never run.
export async function fillFromCprs(realmId, acc) {
  const a = adapterFor(acc.courier);
  if (!a || acc.courier !== 'postex') return 0;
  if (!acc.portal_email) return 0;          // no portal sign-in, nothing to ask with

  const SECONDS = Math.max(10, Number(process.env.CPR_LINK_SECONDS) || 180);
  const until = Date.now() + SECONDS * 1000;

  // Ask what receipts exist before reading them in, or a receipt issued this
  // morning is one nobody here knows about. Three months back, which is as
  // far as the parcels in this database go for most accounts.
  try {
    const back = Math.max(7, Number(process.env.CPR_LIST_DAYS) || 120);
    const to = new Date();
    const from = new Date(Date.now() - back * 86400000);
    const d = x => x.toISOString().slice(0, 10);
    await refreshCprs(realmId, acc.id, d(from), d(to));
  } catch (e) {
    // the receipts we already hold are still worth reading in
  }

  let done = 0;
  for (;;) {
    const list = await cprsToLink(realmId, acc.id, 10);
    if (!list.length) break;

    for (const cpr of list) {
      try {
        done += await absorbCpr(realmId, acc.id, cpr);
      } catch (e) {
        // one receipt that will not open does not stop the rest, but it must
        // not be marked done either - it comes round again next time
        break;
      }
      if (Date.now() > until) break;
    }
    if (Date.now() > until) break;
  }
  return done;
}

export async function cprDetail(realmId, accountId, remoteId, createdOn, fresh) {
  const key = accountId + '|' + remoteId;

  if (!fresh) {
    const hit = detail.get(key);
    if (hit && Date.now() - hit.at < HOLD) return hit.value;
  }

  const s = await sessionFor(realmId, accountId);

  // three calls, one wait
  const [summary, orders, adjustments] = await Promise.all([
    fetchSummary(s, remoteId, createdOn),
    fetchTransactions(s, remoteId),
    fetchAdjustments(s, remoteId).catch(() => [])
  ]);

  const value = {
    account: s.label,
    accountId: s.accountId,
    remoteId: String(remoteId),
    summary,
    adjustments,
    orders,
    counts: countUp(orders)
  };

  remember(key, value);
  return value;
}

// the same buckets the portal's own summary uses, worked out from the orders
function countUp(orders) {
  const by = {};

  orders.forEach(o => {
    const k = o.status || 'Unknown';
    if (!by[k]) by[k] = { status: k, orders: 0, amount: 0, fee: 0, tax: 0 };
    by[k].orders += 1;
    by[k].amount += o.amount;
    by[k].fee    += o.fee;
    by[k].tax    += o.tax;
  });

  const r2 = v => Math.round(v * 100) / 100;

  return Object.values(by)
    .map(x => ({ ...x, amount: r2(x.amount), fee: r2(x.fee), tax: r2(x.tax) }))
    .sort((a, b) => b.orders - a.orders);
}
