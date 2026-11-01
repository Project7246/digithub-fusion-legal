// Synthetic figures only. No database, courier API or production data is used.
import assert from 'node:assert/strict';
import { money, addMoney, receiptState, bankFigures, placeReceipts, reportTotals } from '../banking-money.js';

assert.equal(money('1000000.00'), 100000000n);
assert.equal(addMoney(['0.10', '0.20']), '0.30');
for (const status of ['Confirmed', 'TRANSFERRED', 'Processed', 'CLOSED']) {
  assert.equal(receiptState(status), 'received', status);
}
for (const status of ['Pending', 'Transfer pending', 'Not processed', 'Unconfirmed']) {
  assert.equal(receiptState(status), 'receivable', status);
}
assert.equal(receiptState('Unknown'), 'unknown');
assert.equal(receiptState('Cancelled'), 'excluded');
assert.equal(receiptState('Payment - Processed'), 'received');
assert.equal(receiptState('Transfer failed'), 'unknown');

const placed = placeReceipts([
  { accountId: 1, cpr: 'SAME', status: 'Transferred', paidOn: '2026-08-01', net: '870000.00' },
  { accountId: 2, cpr: 'SAME', status: 'Pending', createdOn: '2026-08-01', net: '430000.00' },
  { accountId: 1, cpr: 'OLD', status: 'Closed', paidOn: '2026-06-30', net: '500.00' },
  { accountId: 1, cpr: 'NO-DATE', status: 'Closed', net: '90.00' }
], [{ id: 1, openingOn: '2026-07-01' }, { id: 2 }], [
  { id: 1, accountId: 1, bankId: 1, from: '2026-01-01' },
  { id: 2, accountId: 1, bankId: 2, from: '2026-09-01' },
  { id: 3, accountId: 2, bankId: 2, from: '2026-01-01' }
], [], '2026-10-31');
assert.equal(placed[0].bankId, 1, 'received CPR uses its historical dated link');
assert.equal(placed[1].bankId, 2, 'pending CPR uses the current bank');
assert.equal(placed[2].included, false, 'opening already includes earlier money');
assert.equal(placed[3].included, false, 'missing payment date must not invent an incoming payment');
assert.notEqual(placed[0].key, placed[1].key, 'same CPR number on different accounts stays separate');

const bank = { opening: '100000.00', openingOn: '2026-07-01' };
const receipts = [
  { state: 'received', on: '2026-08-01', net: '870000.00' },
  { state: 'receivable', on: '2026-08-02', net: '430000.00' },
  { state: 'received', on: '2026-06-30', net: '90000.00' }
];
const moves = [{ on: '2026-08-03', amount: '-20000.00' }];
const year = { from: '2026-07-01', to: '2027-06-30' };
const figures = bankFigures(bank, receipts, moves, year, '2026-10-31');
assert.equal(figures.balance, '950000.00');
assert.equal(figures.inYear, '870000.00');
assert.equal(figures.outYear, '20000.00');
assert.equal(figures.receivable, '430000.00');
assert.equal(bankFigures(bank, receipts.map(r => r.state === 'receivable'
  ? { ...r, state: 'received' } : r), moves, year, '2026-10-31').balance, '1380000.00');
assert.equal(bankFigures({ ...bank, opening: null }, receipts, moves, year,
  '2026-10-31').balance, null);
assert.equal(bankFigures(bank, receipts, [...moves,
  { on: '2026-11-01', amount: '-500.00' }], year, '2026-10-31').balance, '950000.00');
const totals = reportTotals([
  { opening: '100000.00', balance: '950000.00', inYear: '870000.00', outYear: '20000.00',
    fromCouriersYear: '870000.00', receivable: '430000.00', receivedCprs: 1, receivableCprs: 2 },
  { opening: '50000.00', balance: null, balanceIncomplete: true, inYear: '100.00', outYear: '20.00',
    fromCouriersYear: '100.00', receivable: '200.00', receivedCprs: 1, receivableCprs: 1 }
]);
assert.equal(totals.balance, '950000.00', 'one unknown bank must not erase available account totals');
assert.equal(totals.coverage.balance.included, 1);
assert.equal(totals.coverage.balance.total, 2);
assert.equal(totals.coverage.balance.complete, false);
assert.equal(totals.inYear, '870000.00');
assert.equal(totals.outYear, '20020.00');
assert.equal(totals.opening, '150000.00');
assert.equal(totals.receivable, '430200.00');
assert.equal(totals.receivedCprs, 2);
assert.equal(reportTotals([{ balance: null }]).balance, null, 'no known balance must stay unavailable, never zero');
assert.equal(reportTotals([{ balance: '0.00' }]).balance, '0.00', 'a real zero is a valid available total');
console.log('Banking checks passed: exact paisa, CPR states, net receipts, opening cut-off, fiscal totals, pending exclusion, expenses, future dates and unknown opening.');
