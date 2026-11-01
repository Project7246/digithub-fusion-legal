// Stubbed transaction only. No live database or courier is contacted.
import assert from 'node:assert/strict';
import { pool } from '../db.js';
import { saveMnpCprs } from '../couriers.js';
import { recentCprs } from '../dashdata.js';
import { initCprAudit } from '../cpr-audit.js';
const originalConnect = pool.connect;
const originalQuery = pool.query;
const row = { cprNumber: 'TEST-PAYMENT', remoteId: 'TEST-PAYMENT', status: 'CLOSED',
  netAmount: '459900.00', grossAmount: '500000.00', chargeAmount: '25000.00',
  createdOn: '2026-10-20', approvedOn: '2026-10-20',
  raw: { source: 'mnp-portal-payment-v1', paymentSummary: {
    withholding: '15000.00', bankFee: '100.00', beforeBankFee: '460000.00' } } };
const previous = { cpr_number: 'TEST-PAYMENT', net_amount: '150000.00',
  gross_amount: '500000.00', charge_amount: '350000.00', wh_amount: null, status: 'CLOSED', raw: {} };
let failAudit = false;
let calls = [];
let migrationApplied = false;
const client = { release() {}, async query(sql, args) {
  calls.push({ sql, args });
  if (sql.includes('to_regclass')) return { rows: [{ applied: migrationApplied ? 'courier_cpr_audit' : null }] };
  if (sql.includes('FOR UPDATE')) {
    assert.equal(args[0], 'test-realm'); assert.equal(args[1], 7);
    return { rows: [previous] };
  }
  if (sql.includes('INSERT INTO courier_cpr_audit') && failAudit) throw new Error('Synthetic audit failure');
  return { rows: [], rowCount: 1 };
} };
pool.connect = async () => client;
try {
  await initCprAudit();
  const migration = calls.find(c => c.sql.includes('CREATE TABLE courier_cpr_audit'));
  assert.ok(migration);
  assert.match(migration.sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration.sql, /realm_id TEXT NOT NULL/);
  assert.doesNotMatch(migration.sql, /CREATE TABLE IF NOT EXISTS/);
  migrationApplied = true; calls = [];
  await initCprAudit();
  assert.equal(calls.some(c => c.sql.includes('CREATE TABLE courier_cpr_audit')), false);
  calls = [];
  assert.equal(await saveMnpCprs('test-realm', 7, [row]), 1);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(calls.find(c => c.sql.includes("set_config('app.realm_id'")).args[0], 'test-realm');
  const insert = calls.find(c => c.sql.includes('INSERT INTO courier_cprs'));
  assert.doesNotMatch(insert.sql, /qb_payment_id\s*=|received_amount\s*=|dc_journal_id\s*=/);
  const audit = calls.find(c => c.sql.includes('INSERT INTO courier_cpr_audit'));
  const change = JSON.parse(audit.args[2])[0];
  assert.equal(change.old_value.net, '150000.00');
  assert.equal(change.new_value.net, '459900.00');
  assert.equal(change.new_value.bankFee, '100.00');
  Object.assign(previous, { net_amount: row.netAmount, gross_amount: row.grossAmount,
    charge_amount: row.chargeAmount, wh_amount: '15000.00', raw: row.raw,
    created_day: row.createdOn, approved_day: row.approvedOn });
  calls = [];
  await saveMnpCprs('test-realm', 7, [row]);
  assert.equal(calls.some(c => c.sql.includes('INSERT INTO courier_cpr_audit')), false,
    'unchanged money does not create duplicate correction history');
  previous.net_amount = '150000.00';
  calls = []; failAudit = true;
  await assert.rejects(saveMnpCprs('test-realm', 7, [row]), /Synthetic audit failure/);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(calls.some(c => c.sql === 'COMMIT'), false);

  pool.query = async (sql, args) => {
    assert.equal(args[0], 'test-realm');
    return { rows: [{ cpr_number: 'TEST-PAYMENT', account_id: 7, label: 'Synthetic courier',
      courier: 'mnp', amount: '400000.00', fee: '12000.00', tax: '0.00',
      charges: '12000.00', gross_amount: '500000.00', charge_amount: '25000.00',
      cover_wh: '15000.00', bank_fee: '100.00', net_amount: '459900.00',
      payment_source: 'mnp-portal-payment-v1', orders: 20 }] };
  };
  const receipts = await recentCprs('test-realm', {});
  assert.equal(receipts[0].amount, 500000, 'partial parcel list cannot shrink payment gross');
  assert.equal(receipts[0].charges, 40100, 'invoice, withholding and bank fee reconcile');
  assert.equal(receipts[0].fee, 25000);
  assert.equal(receipts[0].tax, 15000);
  assert.equal(receipts[0].bankFee, 100);
  assert.equal(receipts[0].net, 459900);
  console.log('M&P store checks passed: realm scope, atomic correction/audit, rollback, QuickBooks preservation and Logistics totals from consolidated CPR covers.');
} finally { pool.connect = originalConnect; pool.query = originalQuery; await pool.end(); }
