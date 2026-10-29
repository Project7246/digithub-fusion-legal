// M&P's payments, and the bank they went into.
//
// The other two couriers tell us about money as it happens - PostEx on its
// payment call, Trax on a webhook. M&P have no webhook of any kind, so their
// money is **asked for**: `Reports/Payment_Report`, a span of days at a time.
//
// What comes back is one row per payment and a block around it naming the
// account it was sent to:
//
//   row    serial_no, PaymentID, PaidOn, RRAmount, InvoiceAmount, NetPayable,
//          InstrumentMode, InstrumentNumber
//   block  BeneficiaryName, BankName, BeneficiaryBankAccount, AccountNo,
//          BranchName, ZoneName
//
// Two things come out of that, and the second is the point of this file.
//
// **The money.** `NetPayable` is `RRAmount` less `InvoiceAmount` - what
// actually reached the bank - so it is the receipt's net, and the gross and
// the charge are kept beside it rather than being worked back out later.
//
// **The bank.** M&P say on every payment which account they sent it to. So
// when somebody changes the account with the courier, the courier's own next
// payment says so - and Fusion can put that beside the bank it has on file and
// ask whether to follow it, instead of the change being noticed on a statement
// weeks later. That is what `bankSaid()` is for, and the Banking screen reads
// it.

import { adapterFor } from './adapters.js';
import { saveCprs, credsOf } from './couriers.js';
import { pool } from './db.js';

const n2 = v => Math.round(Number(v || 0) * 100) / 100;

// One account's payments for a span of days, written down as receipts.
export async function absorbPayouts(realmId, acc, from, to) {
  const a = adapterFor(acc.courier);
  if (!a || typeof a.fetchPayouts !== 'function') return { payments: 0 };

  const list = await a.fetchPayouts(acc.token, from, to, credsOf(acc));

  // **Their report is per consignment, not per payment.** One October came
  // back with three thousand rows and the receipts under them hold a hundred
  // and fifty parcels apiece - so a row is one parcel's share of a payment,
  // and the payment is what the rows add up to. Keeping one row per payment
  // number put one parcel's figures on a receipt worth a hundred and fifty of
  // them: a receipt of 326,262 collected showed a net of 1,147.
  const byPayment = new Map();
  (list || []).forEach(p => {
    if (!p || !p.paymentId) return;
    const key = String(p.paymentId);
    const sum = byPayment.get(key) || {
      paymentId: key, paidOn: null, amount: 0, invoiced: 0, netPayable: 0,
      mode: '', instrument: '', bank: '', beneficiary: '', bankAccount: '',
      account: '', lines: 0
    };

    sum.amount     += Number(p.amount) || 0;
    sum.invoiced   += Number(p.invoiced) || 0;
    sum.netPayable += Number(p.netPayable) || 0;
    sum.lines      += 1;

    // the earliest day it was paid on - they repeat it on every line
    if (p.paidOn && (!sum.paidOn || p.paidOn < sum.paidOn)) sum.paidOn = p.paidOn;

    // whichever line actually carries each of these: a line that says nothing
    // about the bank does not erase what another line said
    ['mode', 'instrument', 'bank', 'beneficiary', 'bankAccount', 'account']
      .forEach(k => { if (!sum[k] && p[k]) sum[k] = p[k]; });

    byPayment.set(key, sum);
  });

  const rows = [...byPayment.values()].map(p => ({
    cprNumber:  String(p.paymentId),
    remoteId:   String(p.paymentId),
    // A payment that exists is money that moved, which is what CLOSED means
    // everywhere else here - the finance screens read that word and not the
    // courier's own.
    status:     'CLOSED',
    netAmount:  n2(p.netPayable),
    grossAmount: n2(p.amount),
    chargeAmount: n2(p.invoiced),
    createdOn:  p.paidOn || null,
    approvedOn: p.paidOn || null,
    paidToName:    p.beneficiary || null,
    paidToBank:    p.bank || null,
    paidToAccount: p.bankAccount || null,
    instrument:    p.instrument || null,
    mode:          p.mode || null,
    raw: { via: 'payment report', account: p.account || '', lines: p.lines }
  }));

  if (!rows.length) return { payments: 0 };

  await saveCprs(realmId, acc.id, acc.courier, rows);
  return { payments: rows.length };
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
