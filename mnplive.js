// M&P payment covers come from the portal's consolidated instrument report.
// One payment is one row: its net includes withholding, and the portal's
// published IBFT fee is subtracted once. The COD API Payment_Report is a
// consignment report with repeated invoice totals and is not a bank receipt.
// Corrections are saved atomically with a company-scoped audit record.

import { adapterFor } from './adapters.js';
import { saveMnpCprs, credsOf, getAccount } from './couriers.js';
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
        beforeBankFee: p.beforeBankFee } }
  }));
  if (!rows.length) return { payments: 0 };
  await saveMnpCprs(realmId, acc.id, rows);
  return { payments: rows.length };
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
