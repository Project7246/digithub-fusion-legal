// Trax receipts - what a payment says it holds and what it says it deducted.
//
// Synthetic rows only; no live database and no courier call. The figures here
// are invented, but their *shape* is the portal's: a DataTables row where the
// money arrives as "166,169.00" with its thousands marks still on, and where
// each count sits on a `_count` field beside a button that draws the same
// number in HTML.
//
// Why this check exists. Until 5 Nov 2026 a Trax receipt was read two ways at
// once - the payment screen's own list, and a per-parcel call whose `id` is
// not the payment the merchant is paid against - and the second quietly filed
// parcels under payments they were never in. On top of that the screen showed
// two of the five deductions, so what it said a payment came to was not what
// the courier had paid. Both are arithmetic, so both are checkable.

import assert from 'node:assert/strict';
import { mapPayment, paymentTotals, paidOnly } from '../traxportal.js';

/* ---------- a payment, as their Finance > Payments feed sends one ---------- */

const row = {
  id: 1000001,
  id_padded: '1000001',
  status: 'Paid',
  shipper: 'Synthetic Traders',
  bank: 'Sample Bank',
  company_bank: 'Sample Company Bank',
  reference_number: '',
  done_at: '2026-10-12 05:00:13',

  // 900 = 800 delivered + 90 returned + 10 adjusted
  total_shipments: 900,
  delivered_shipments: '<button class="btn btn-sm btn-outline-info align-middle">800</button>',
  delivered_shipments_count: 800,
  returned_shipments: '<button class="btn btn-sm btn-outline-info align-middle">90</button>',
  returned_shipments_count: 90,
  adjusted_shipments: '<button class="btn btn-sm btn-outline-info align-middle">10</button>',
  adjusted_shipments_count: 10,
  arrival_shipments: '<button class="btn btn-sm btn-outline-info align-middle">950</button>',
  arrival_shipments_count: 950,

  // 1,000,000.00 collected, less 100,000 + 16,000 + 20,000 + 20,000 + 100
  total_amount:   '1,000,000.00',
  total_charges:    '100,000.00',
  total_gst:         '16,000.00',
  total_wht:         '20,000.00',
  total_cod_sst:     '20,000.00',
  ibft_charges: 100,
  total_payable:    '843,900.00'
};

const p = mapPayment(row);

/* ---------- the counts ---------- */

assert.equal(p.cprNumber, '1000001');
assert.equal(p.status, 'Paid', 'their own word for the status is kept as they write it');
assert.equal(p.raw.shipments, 900);
assert.equal(p.raw.delivered, 800);
assert.equal(p.raw.returned, 90);
assert.equal(p.raw.adjusted, 10, 'adjusted is the third kind - reading two of three loses it');
assert.equal(p.raw.arrival, 950);
assert.equal(p.raw.delivered + p.raw.returned + p.raw.adjusted, p.raw.shipments,
  'delivered + returned + adjusted is what their total_shipments means');

// The `_count` fields are not among the columns their screen asks for, so the
// button that draws the same figure has to be readable on its own.
const noCounts = { ...row };
delete noCounts.delivered_shipments_count;
delete noCounts.returned_shipments_count;
delete noCounts.adjusted_shipments_count;
delete noCounts.arrival_shipments_count;
const q = mapPayment(noCounts);
assert.equal(q.raw.delivered, 800, 'the count comes out of the button when the field moves');
assert.equal(q.raw.returned, 90);
assert.equal(q.raw.adjusted, 10);
assert.equal(q.raw.arrival, 950);

// A count that genuinely is not there is nought, never NaN - a NaN written
// down is a receipt that can never be compared with anything again.
const empty = mapPayment({ ...row, adjusted_shipments_count: null, adjusted_shipments: '' });
assert.equal(empty.raw.adjusted, 0);

/* ---------- the money ---------- */

assert.equal(p.grossAmount, 1000000, '"1,000,000.00" is a number with its marks on');
assert.equal(p.chargeAmount, 100000);
assert.equal(p.netAmount, 843900, 'total_payable is what reached the bank, IBFT already off');
assert.equal(p.raw.gst, 16000);
assert.equal(p.raw.wht, 20000);
assert.equal(p.raw.codSst, 20000);
assert.equal(p.raw.ibft, 100);

const t = paymentTotals(p);
assert.equal(t.deducted, 156100, 'all five deductions, not two of them');
assert.equal(t.collected - t.deducted, t.net,
  'collected less the five is exactly what they paid - a receipt that does not ' +
  'tie to the courier’s own figure is a receipt that is wrong');
assert.equal(t.over, 0);

// Showing only the charges and the GST is the bug this check is here to stop:
// it leaves the withholding and the COD SST out and overstates what we were
// paid by every rupee of them.
assert.equal(t.collected - t.charges - t.gst - t.ibft - t.net, t.wht + t.sst);

// Their payable is printed to the rupee, so their own rounding must not read
// as money gone missing.
const rounded = paymentTotals(mapPayment({ ...row, total_payable: '843,900' }));
assert.ok(Math.abs(rounded.over) < 1, 'rounding to the rupee is not a gap');

// A payment that really does not add up has to say so rather than be absorbed.
const short = paymentTotals(mapPayment({ ...row, total_payable: '800,000.00' }));
assert.equal(short.over, 43900, 'what their payable leaves unexplained is reported');

/* ---------- which of their words mean the money moved ---------- */

const said = w => paidOnly([{ tracking: 'TEST-1', paidSaid: w }]).length === 1;
assert.ok(said('Paid'));
assert.ok(said('Processed'), 'Processed is a Trax payment that has gone out');
assert.ok(!said('Pending'));
assert.equal(paidOnly([{ tracking: 'TEST-2', paidSaid: '' }]).length, 0,
  'a row that says nothing is never turned into a payment');

console.log('Trax receipt checks passed: three kinds of shipment counted and ' +
  'adding to their own total, counts read from the button when the field ' +
  'moves, money read through its thousands marks, all five deductions tying ' +
  'to the figure they paid, their rounding tolerated and a real gap reported.');
