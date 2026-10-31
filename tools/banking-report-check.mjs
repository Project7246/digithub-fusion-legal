// Synthetic fixtures, stubbed SQL and stubbed CSV fetch only. No real database
// or courier is contacted, and no production data is read or written.
import assert from 'node:assert/strict';
import express from 'express';
import XLSX from 'xlsx';
import { pool } from '../db.js';
import { buildReport } from '../banking-cprs.js';
import { readSpendSheet, postDeposits } from '../banking.js';
import { createBankingRouter } from '../banking-router.js';

const banks = [{ id: 1, name: 'Sample Bank', title: 'Synthetic Trading', active: true,
  opening: '100000.00', openingOn: '2026-07-01', openingKnown: true,
  sheetUrl: 'https://fixture.invalid/expenses.csv' }];
const covers = [
  { account_id: 1, cpr_number: 'CPR-TEST', courier: 'mnp', label: 'Sample account',
    status: 'Transferred', net_amount: '870000.00', gross_amount: '1000000.00',
    charge_amount: '130000.00', linked_orders: 1, created_day: '2026-08-01', paid_day: '2026-08-02' },
  { account_id: 2, cpr_number: 'CPR-TEST', courier: 'mnp', label: 'Second sample account',
    status: 'Pending', net_amount: '430000.00', linked_orders: 0, created_day: '2026-08-03' },
  { account_id: 1, cpr_number: 'BEFORE', courier: 'mnp', label: 'Sample account',
    status: 'CLOSED', net_amount: '90000.00', linked_orders: 0,
    created_day: '2026-06-01', paid_day: '2026-06-02' }
];
const oldQuery = pool.query;
const oldFetch = globalThis.fetch;
const calls = [];
pool.query = async (sql, args) => {
  calls.push({ sql, args });
  assert.match(sql, /\bSELECT\b/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i);
  assert.equal(args[0], args[0] === 'other-company' ? 'other-company' : 'fixture-company');
  if (args[0] === 'other-company') return { rows: [] };
  if (sql.includes('WITH parcel_dates')) return { rows: covers };
  if (sql.includes('FROM bank_links')) return { rows: [
    { id: 1, account_id: 1, bank_id: 1, from_day: '2026-01-01' },
    { id: 2, account_id: 2, bank_id: 1, from_day: '2026-01-01' }
  ] };
  if (sql.includes('FROM bank_moves')) return { rows: [
    { id: 4, bank_id: 1, account_id: 1, day: '2026-08-02', amount: '1000000.00',
      kind: 'courier', source: 'courier', ref: 'CPR-TEST' },
    { id: 5, bank_id: 1, day: '2026-08-03', amount: '-20000.00',
      kind: 'spend', source: 'sheet', ref: 'old-sheet-copy' }
  ] };
  if (sql.includes('FROM banks')) return { rows: [{ id: 1, name: 'Sample Bank',
    opening: '100000.00', opening_on: new Date(2026, 6, 1) }] };
  if (sql.includes('FROM courier_orders')) {
    if (args[1] === 2) return { rows: [] };
    assert.equal(args[1], 1);
    assert.equal(args[2], 'CPR-TEST');
    return { rows: [{ tracking: 'TEST-001', order_ref: '=not-a-formula', amount: '1000000.00',
      fee: '120000.00', tax: '10000.00', status: 'Delivered' }] };
  }
  throw new Error('Unexpected fixture query');
};
let csv = 'Date,Amount,Description\n03/08/2026,20000,"Fuel, sample city"\n';
globalThis.fetch = async () => new Response(csv, { status: 200 });
const settings = { banks, year: { year: 2027, from: '2026-07-01', to: '2027-06-30' },
  today: '2026-10-31', parseSheet: readSpendSheet, fresh: true };
let appServer;
try {
  const first = await buildReport('fixture-company', settings);
  assert.equal(first.banks[0].balance, '950000.00');
  assert.equal(first.banks[0].inYear, '870000.00');
  assert.equal(first.banks[0].outYear, '20000.00');
  assert.equal(first.banks[0].receivable, '430000.00');
  assert.equal(first.banks[0].receivedCprs, 1);
  assert.equal(first.banks[0].receivableCprs, 1);
  assert.equal(first.moves.filter(m => m.kind === 'courier').length, 2);
  assert.equal(first.moves.find(m => m.state === 'receivable').affectsBalance, false);
  assert.equal(first.receipts.find(r => r.cpr === 'BEFORE').included, false);
  covers.push({ account_id: 1, cpr_number: 'MISSING-COVER', courier: 'mnp', label: 'Sample account',
    status: '', net_amount: null, linked_orders: 2, paid_day: '2026-08-03' });
  const uncertain = await buildReport('fixture-company', settings);
  assert.equal(uncertain.banks[0].balance, null, 'missing courier net/status cannot masquerade as a verified balance');
  assert.equal(uncertain.unplaced.find(r => r.cpr === 'MISSING-COVER').why, 'Net amount not supplied');
  covers.pop();
  assert.equal(await postDeposits('fixture-company'), 1, 'legacy refresh does not write money');

  covers[1].status = 'Processed'; covers[1].paid_day = '2026-08-04';
  const paid = await buildReport('fixture-company', settings);
  assert.equal(paid.banks[0].receivable, '0.00');
  assert.equal(paid.banks[0].balance, '1380000.00');
  covers[1].status = 'Pending'; covers[1].paid_day = null;

  csv += '04/08/2026,5000,Second expense\n';
  const newExpense = await buildReport('fixture-company', settings);
  assert.equal(newExpense.banks[0].outYear, '25000.00');
  assert.equal(newExpense.banks[0].balance, '945000.00');
  csv = 'Date,Amount,Description\n04/08/2026,5000,Second expense\n';
  const removedExpense = await buildReport('fixture-company', settings);
  assert.equal(removedExpense.banks[0].balance, '965000.00');
  csv = 'Date,Amount,Description\n';
  const emptyExpense = await buildReport('fixture-company', settings);
  assert.equal(emptyExpense.banks[0].balance, '970000.00', 'a valid sheet with no expenses has zero out');
  csv = 'Date,Amount,Description\nnot-a-date,5000,Must not disappear\n';
  const invalidExpense = await buildReport('fixture-company', settings);
  assert.equal(invalidExpense.banks[0].balance, null, 'unreadable expense rows must not overstate balance');
  csv = 'Date,Amount,Description\n03/08/2026,20000,"Fuel, sample city"\n';
  const twoBanks = await buildReport('fixture-company', { ...settings,
    banks: [banks[0], { ...banks[0], id: 2, opening: '50000.00', title: 'Second synthetic bank' }] });
  assert.equal(twoBanks.banks[1].outYear, '20000.00', 'same expense text in two banks remains two expenses');
  globalThis.fetch = async () => { throw new Error('Synthetic sheet failure'); };
  const failed = await buildReport('fixture-company', settings);
  assert.equal(failed.banks[0].balance, null);
  assert.equal(failed.totals.outYear, null);
  assert.equal(failed.warnings.length, 1);

  const app = express();
  app.use('/api/bank', createBankingRouter({
    requireBoss: async (req, res) => req.get('x-fixture-boss') === 'yes' ||
      (res.status(403).json({ error: 'Boss required' }), false),
    requireCompany: async req => req.get('x-fixture-realm') || 'fixture-company'
  }));
  appServer = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const base = 'http://127.0.0.1:' + appServer.address().port + '/api/bank/cpr';
  const headers = { 'x-fixture-boss': 'yes' };
  assert.equal((await oldFetch(base + '?account=1&ref=CPR-TEST')).status, 403);
  assert.equal((await oldFetch(base + '?account=1&ref=CPR-TEST', {
    headers: { ...headers, 'x-fixture-realm': 'other-company' } })).status, 400);
  const detail = await oldFetch(base + '?account=1&ref=CPR-TEST', { headers });
  const data = await detail.json();
  assert.equal(data.summary.net, '870000.00');
  assert.equal(data.orders.length, 1);
  assert.equal(data.summary.tax, undefined, 'unknown tax must not become zero');
  const pendingDetail = await oldFetch(base + '?account=2&ref=CPR-TEST', { headers });
  assert.equal((await pendingDetail.json()).summary.net, '430000.00', 'same reference on another account has its own net');
  const download = await oldFetch(base + '?account=1&ref=CPR-TEST&download=xlsx', { headers });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /spreadsheetml/);
  const workbook = XLSX.read(Buffer.from(await download.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['CPR summary', 'Orders']);
  const summaryRows = XLSX.utils.sheet_to_json(workbook.Sheets['CPR summary'], { header: 1 });
  assert.equal(summaryRows.find(row => row[0] === 'Net bank amount')[1], 870000);
  assert.equal(workbook.Sheets.Orders.B2.t, 's', 'order references are text, never spreadsheet formulas');
  assert.equal(workbook.Sheets.Orders.B2.f, undefined);

  console.log('Banking report checks passed: authoritative net, pending/received transitions, no duplicate old deposits, dated links, live CSV additions/removals, sheet failure, company isolation, boss guard and Excel workbook.');
} finally {
  globalThis.fetch = oldFetch; pool.query = oldQuery;
  if (appServer) await new Promise(resolve => appServer.close(resolve));
  await pool.end();
}
