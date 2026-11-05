// M&P payment covers come from the portal's consolidated instrument report.
// One payment is one row: its net includes withholding, and the portal's
// published IBFT fee is subtracted once. The COD API Payment_Report is a
// consignment report with repeated invoice totals and is not a bank receipt.
// Corrections are saved atomically with a company-scoped audit record.

import { adapterFor } from './adapters.js';
import {
  saveMnpCprs, credsOf, getAccount, linkCprParcels, clearCprStrays,
  cprParcelCounts, mergeCprRaw
} from './couriers.js';
import { paymentDetail } from './mnpportal.js';
import { pool } from './db.js';

const n2 = v => Math.round(Number(v || 0) * 100) / 100;

// One account's payments for a span of days, written down as receipts.
export async function absorbPayouts(realmId, acc, from, to) {
  const a = adapterFor(acc.courier);
  if (!a || typeof a.fetchPayouts !== 'function') return { payments: 0 };

  const list = await a.fetchPayouts(acc.token, from, to, credsOf(acc));

  if (list.some(p => !p.consolidated)) throw new Error('M&P bank payments require consolidated totals');
  const rows = list.map(p => ({
    cprNumber: p.paymentId, remoteId: p.paymentId, status: p.status,
    netAmount: p.netPayable, grossAmount: p.amount, chargeAmount: p.invoiced,
    createdOn: p.paidOn, approvedOn: p.status === 'CLOSED' ? p.paidOn : null,
    paidToName: p.beneficiary || null, paidToBank: p.bank || null,
    paidToAccount: p.bankAccount || null, instrument: p.instrument || null,
    mode: p.mode || null,
    raw: { source: 'mnp-portal-payment-v1', account: p.account,
      paymentSummary: { withholding: p.withholding, bankFee: p.bankFee,
        beforeBankFee: p.beforeBankFee, monthly: p.monthly } }
  }));
  if (!rows.length) return { payments: 0 };
  await saveMnpCprs(realmId, acc.id, rows);
  return { payments: rows.length };
}

/* ============ what is actually inside one of their payments ============

   `absorbPayouts` above writes the cover: one row per payment, with what
   they collected, what they invoiced, what they withheld and what reached
   the bank. It says nothing about which parcels the payment paid for, and
   until 5 Nov 2026 nothing did: that came from the per-parcel tracking call,
   which only ever covers parcels this app already holds and only the
   delivered ones - so a payment of 235,668 showed **four parcels** on the
   receipts screen.

   Their `paymentinstrumentdetailreport` is the whole of it in one call: 298
   consignments on the payment this was read from, each with its COD, its
   invoice line, its income tax and its sales tax, and its own status in
   their word - 273 DELIVERED, 25 RETURNED. That is the same shape as Trax's
   payment screen and it is read the same way: the list is the truth, parcels
   it does not name let the number go, and the counts and the invoice split
   are kept on the cover so the receipt can print the courier's own figures
   instead of adding ours up.                                              */

// How much of one visit this may spend. Their detail call is one call per
// payment - cheaper than Trax's three - but an account with a year of
// payments is still not something to read on every page load.
const PER_RUN = Math.max(1, Number(process.env.MNP_PAYMENTS_PER_RUN) || 6);
const AGAIN = Math.max(5, Number(process.env.MNP_PAYMENT_REREAD_MINUTES) || 360) * 60000;
const readAt = new Map();

export async function absorbPaymentParcels(realmId, acc, opts = {}) {
  const account = await getAccount(realmId, acc.id);
  if (!account || account.courier !== 'mnp') return { covers: 0, linked: 0 };

  const credentials = credsOf(account);
  const accountNo = credentials.account || credentials.accountNo;
  if (!accountNo) return { covers: 0, linked: 0, note: 'this account is not validated yet' };

  const covers = await pool.query(
    `SELECT cpr_number, created_on, (raw->'counts'->>'total')::int AS known
       FROM courier_cprs
      WHERE realm_id = $1 AND account_id = $2 AND courier = 'mnp'
      ORDER BY created_on DESC NULLS LAST
      LIMIT 200`,
    [realmId, Number(acc.id)]
  );
  if (!covers.rows.length) return { covers: 0, linked: 0 };

  const held = await cprParcelCounts(realmId, acc.id,
    covers.rows.map(r => r.cpr_number));

  const say = typeof opts.say === 'function' ? opts.say : () => {};
  const lists = new Map();
  let read = 0;

  for (const c of covers.rows) {
    if (opts.stop && opts.stop()) break;

    const cpr = String(c.cpr_number);
    const want = Number(c.known || 0);
    const have = held.get(cpr) || 0;
    const key = acc.id + '|' + cpr;

    if (!opts.force) {
      if (want && have === want) continue;               // already whole
      if (Date.now() - (readAt.get(key) || 0) < AGAIN) continue;
      if (read >= PER_RUN) break;
    }

    let detail;
    try {
      detail = await paymentDetail(accountNo, cpr);
    } catch (e) {
      say('Payment ' + cpr + ': ' + e.message);
      continue;
    }

    const trackings = (detail.orders || [])
      .map(o => String(o.tracking || '').trim()).filter(Boolean);
    if (!trackings.length) continue;

    lists.set(cpr, { trackings, cover: c });
    readAt.set(key, Date.now());
    read += 1;

    // The courier's own counts and its own invoice split, kept on the cover.
    // Merged rather than written over it: the payment list owns the money
    // columns on that row and this call must not be able to disturb them.
    await mergeCprRaw(realmId, acc.id, cpr, {
      counts: detail.counts || {},
      invoiceSummary: detail.summary || {}
    });
  }

  let linked = 0;
  for (const [cpr, item] of lists) {
    linked += await linkCprParcels(realmId, acc.id, cpr, item.trackings,
      item.cover.created_on ? String(item.cover.created_on).slice(0, 10) : null);
  }

  let cleared = 0;
  for (const [cpr, item] of lists) {
    cleared += await clearCprStrays(realmId, acc.id, cpr, item.trackings);
  }

  // **No orphan clearing here, unlike Trax.** Trax's payment screen hands
  // over every payment the account has ever had, so a number with no cover
  // is provably invented. M&P's payments are asked for a span of days at a
  // time (`absorbPayouts`), so a payment older than anything this app has
  // fetched has no cover and is still perfectly real - clearing on that
  // would throw away a receipt number the courier itself gave us.
  return { covers: covers.rows.length, read, linked, cleared };
}

export async function mnpReceiptDetail(realmId, accountId, paymentId) {
  const account = await getAccount(realmId, accountId);
  if (!account || account.courier !== 'mnp') throw new Error('No such M&P account in this company');
  const credentials = credsOf(account);
  const accountNo = credentials.account || credentials.accountNo;
  if (!accountNo) throw new Error('Validate this M&P account before reading receipt detail');
  return paymentDetail(accountNo, paymentId);
}

/* ==================== has the bank changed? ==================== */

// What the courier last said about where it pays, per account - read from the
// receipts themselves, so it is the courier's own word and not a setting.
export async function bankSaid(realmId, accountId) {
  const where = ['c.realm_id = $1', `COALESCE(c.paid_to_account,'') <> ''`];
  const args = [realmId];
  if (accountId) { args.push(Number(accountId)); where.push(`c.account_id = $${args.length}`); }

  const r = await pool.query(
    `SELECT DISTINCT ON (c.account_id)
            c.account_id, a.label, a.courier,
            c.paid_to_name, c.paid_to_bank, c.paid_to_account,
            c.created_on, c.cpr_number
       FROM courier_cprs c
       JOIN courier_accounts a ON a.id = c.account_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.account_id, c.created_on DESC NULLS LAST`,
    args
  );

  return r.rows.map(x => ({
    accountId: x.account_id,
    label: x.label,
    courier: x.courier,
    name: x.paid_to_name || '',
    bank: x.paid_to_bank || '',
    account: x.paid_to_account || '',
    on: x.created_on ? String(x.created_on).slice(0, 10) : null,
    payment: x.cpr_number
  }));
}

// Everywhere the courier's own word and the bank on file disagree.
//
// The comparison is on the account number with everything but its letters and
// digits taken out: an IBAN is written with spaces as often as without, and
// two spellings of one account is not a change of bank.
function plainly(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function bankDrift(realmId) {
  const said = await bankSaid(realmId);
  if (!said.length) return [];

  const r = await pool.query(
    `SELECT DISTINCT ON (l.account_id)
            l.account_id, l.bank_id, l.from_date,
            b.name, b.iban, b.account_no
       FROM bank_links l
       JOIN banks b ON b.id = l.bank_id
      WHERE l.realm_id = $1 AND l.from_date <= CURRENT_DATE
      ORDER BY l.account_id, l.from_date DESC, l.id DESC`,
    [realmId]
  );

  const have = new Map();
  r.rows.forEach(x => have.set(Number(x.account_id), x));

  return said.map(s => {
    const mine = have.get(s.accountId) || null;
    const theirs = plainly(s.account);
    const ours = mine ? [plainly(mine.iban), plainly(mine.account_no)].filter(Boolean) : [];
    const matches = ours.some(x => x && (x === theirs || x.endsWith(theirs) || theirs.endsWith(x)));

    return {
      ...s,
      bankId: mine ? mine.bank_id : null,
      bankName: mine ? mine.name : '',
      // three states, and they are different questions: no bank set at all,
      // the courier paying somewhere else, or everything agreeing
      state: !mine ? 'unset' : (matches ? 'same' : 'different')
    };
  }).filter(x => x.state !== 'same');
}
