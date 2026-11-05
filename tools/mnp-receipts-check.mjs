// M&P receipts - what a payment says it holds and how its invoice was made.
//
// Synthetic rows only; no live database and no courier call. The shape is
// their two screens': the Payment Instrument Report row (RRAmount,
// InvoiceAmount, MON_FIX, TaxAmount, IBFTFee, NetPayable) and the detail
// report behind it (paymentHead, invoiceSummary, osansa, consignments).
//
// Why this check exists. M&P do not deduct the way Trax do - **they bill** -
// so a receipt that shows one figure called "charges" says nothing about
// what was actually charged. Their invoice is a shipment charge, a fuel
// charge, GST on those, extra charges and an OSA/NSA line with a GST of its
// own; beside it they withhold income tax and sales tax, which their payment
// row adds into one number and their consignment lines split. And until
// 5 Nov 2026 nothing read `MON_FIX` at all, nor counted the consignments in
// a payment - which is how a payment of 235,668 showed four parcels.

import assert from 'node:assert/strict';
import { mapPaymentReport, mapPaymentDetail } from '../mnpportal.js';

const ACCOUNT = 'TEST-ACCOUNT';

/* ---------- the payment row, as their report sends one ---------- */

const row = {
  accountNo: ACCOUNT, PaymentID: 'TEST-PAYMENT', PaidOn: '2026-10-03',
  RRAmount: 500000, InvoiceAmount: 28000, MON_FIX: 0, TaxAmount: 20000,
  IBFTFee: 100, NetPayable: 452000,
  InstrumentMode: 'IBFT', InstrumentNumber: 'TEST-INSTRUMENT'
};
const response = { sts: 0, data: [row], details: { accountNo: ACCOUNT,
  BANK_NAME: 'Sample Bank', BeneficiaryName: 'Synthetic company',
  BeneficiaryBankAccNo: 'TEST-BANK' } };

const paid = mapPaymentReport(response, ACCOUNT)[0];

assert.equal(paid.amount, '500000.00', 'RRAmount is the COD they collected');
assert.equal(paid.invoiced, '28000.00');
assert.equal(paid.withholding, '20000.00');
assert.equal(paid.bankFee, '100.00');
assert.equal(paid.beforeBankFee, '452000.00', 'their NetPayable is before the IBFT fee');
assert.equal(paid.netPayable, '451900.00', 'and the fee comes off once, here');
assert.equal(paid.monthly, '0.00', 'MON_FIX is read even when it is nought');

// Collected less their invoice less their withheld tax is their own net.
assert.equal(500000 - 28000 - 20000, Number(paid.beforeBankFee));

// **The nought that had to be read.** MON_FIX is nought on every payment
// seen, which is exactly why leaving it out was a trap: the day it is not,
// a receipt that does not carry it stops tying to their own net with
// nothing on the screen to say which figure moved.
const withMonthly = mapPaymentReport({ ...response,
  data: [{ ...row, MON_FIX: 2000, NetPayable: 450000 }] }, ACCOUNT)[0];
assert.equal(withMonthly.monthly, '2000.00');
assert.equal(withMonthly.beforeBankFee, '450000.00');
assert.equal(500000 - 28000 - 2000 - 20000, Number(withMonthly.beforeBankFee),
  'their four deductions come to their own net payable');

// A row that leaves the column out entirely is nought, not a refusal: it is
// their screen, and screens change.
assert.equal(mapPaymentReport({ ...response,
  data: [{ ...row, MON_FIX: undefined }] }, ACCOUNT)[0].monthly, '0.00');

/* ---------- the detail behind it ---------- */

const cn = (number, status, cod, invoice, incomeTax, salesTax) => ({
  consignmentNumber: number, orderRefNo: '#' + number, bookingDate: '30 Sep 2026',
  destination: 'ISB', codAmount: cod, cnStatus: status, shippingCharges: 65,
  rrDate: '01 Oct 2026', cnWiseInvoiceAmount: invoice, taxAbleAmount: cod,
  incomeTaxAmount: incomeTax, salesTaxAmount: salesTax,
  wthTax: incomeTax + salesTax
});

const detail = mapPaymentDetail({ sts: 0, data: {
  clientInfo: { accountNo: ACCOUNT, bank_Name: 'Sample Bank',
                beneficiaryBankAccNo: 'TEST-BANK' },
  paymentHead: { totalCODAmount: 500000, invoiceAmount: 28000,
                 whTax: 20000, netPayable: 451900, claimCreditNoteAmount: 0 },
  invoiceSummary: { shipmentCharge: 20000, fuel_Charge: 3000, gst: 4000,
                    extraCharges: 500, creditNote: 0 },
  osansa: { osansa_Amount: 440, osansa_gst: 60 },
  rts: { rtsAmount: 0 },
  debitNote: { debitNoteCharges: 0 },
  consignments: [
    cn('TEST-CN-1', 'DELIVERED', 1000, 86.71, 5000, 5000),
    cn('TEST-CN-2', 'DELIVERED', 2000, 86.71, 5000, 5000),
    cn('TEST-CN-3', 'RETURNED', 0, 86.71, 0, 0)
  ]
} }, ACCOUNT);

/* ---------- how many parcels, and what became of each ---------- */

assert.equal(detail.counts.total, 3,
  'the consignment list is the payment’s own parcel count - nothing else is');
assert.equal(detail.counts.DELIVERED, 2);
assert.equal(detail.counts.RETURNED, 1);
assert.equal(detail.counts.DELIVERED + detail.counts.RETURNED, detail.counts.total);
assert.equal(detail.orders.length, 3);

// Their own status words, kept as they write them. A receipt is read by
// "how many were delivered and how many came back", and that question is
// answered by the courier, never by our own buckets.
assert.ok(Object.keys(detail.counts).includes('DELIVERED'));

/* ---------- the invoice, in the parts they bill it in ---------- */

const s = detail.summary;
assert.equal(s.shipping, '20000.00');
assert.equal(s.fuel, '3000.00');
assert.equal(s.invoiceGst, '4000.00');
assert.equal(s.extraCharges, '500.00');
assert.equal(s.osaNsa, '440.00', 'OSA/NSA delivery is billed and was on no screen');
assert.equal(s.osaNsaGst, '60.00', 'and it carries a GST of its own');

const billed = Number(s.shipping) + Number(s.fuel) + Number(s.invoiceGst) +
               Number(s.extraCharges) + Number(s.osaNsa) + Number(s.osaNsaGst);
assert.equal(billed, 28000,
  'the named parts come to the invoice their payment row charges');

/* ---------- and the two taxes they withhold ---------- */

assert.equal(s.withholding, '20000.00');
assert.equal(s.incomeTax, 10000, 'income tax, off their own consignment lines');
assert.equal(s.salesTax, 10000, 'and sales tax beside it');
assert.equal(s.incomeTax + s.salesTax, Number(s.withholding),
  'their one withholding figure is these two - showing it as one says ' +
  'nothing about which tax was cut');

// The detail's own net already has the bank fee off it; deducting it again
// is the fault this assertion exists to stop.
assert.equal(s.net, '451900.00');
assert.equal(Number(s.net), Number(paid.netPayable));

/* ---------- and it answers for one account only ---------- */

assert.throws(() => mapPaymentDetail({ sts: 0, data: {
  clientInfo: { accountNo: 'OTHER' }, consignments: [] } }, ACCOUNT), /account/i);

console.log('M&P receipt checks passed: MON_FIX read even at nought and ' +
  'tying to their own net when it is not, the consignment list counted by ' +
  'their own status words, the invoice in the parts they bill it in - ' +
  'OSA/NSA and its GST included - and the one withholding figure split ' +
  'into the income tax and the sales tax behind it.');
