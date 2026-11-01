// Synthetic portal responses only; no live database or courier calls.
import assert from 'node:assert/strict';
import { mapPaymentReport, mapPaymentDetail, portalConfig } from '../mnpportal.js';
const row = { accountNo: 'TEST-ACCOUNT', PaymentID: 'TEST-PAYMENT', PaidOn: '2026-10-20',
  RRAmount: 500000, InvoiceAmount: 25000, TaxAmount: 15000, IBFTFee: 100,
  NetPayable: 460000, InstrumentMode: 'IBFT', InstrumentNumber: 'TEST-INSTRUMENT' };
const response = { sts: 0, data: [row], details: { accountNo: 'TEST-ACCOUNT',
  BANK_NAME: 'Sample Bank', BeneficiaryName: 'Synthetic company', BeneficiaryBankAccNo: 'TEST-BANK' } };
const mapped = mapPaymentReport(response, 'TEST-ACCOUNT');
assert.equal(mapped[0].netPayable, '459900.00');
assert.equal(mapped[0].invoiced, '25000.00');
assert.equal(mapped[0].withholding, '15000.00');
assert.equal(mapped[0].bankFee, '100.00');
assert.equal(mapped[0].status, 'CLOSED');
assert.equal(mapped[0].bank, 'Sample Bank');
assert.equal(mapped[0].bankAccount, 'TEST-BANK');
assert.equal(mapPaymentReport({ ...response, data: Array(12).fill(row) }, 'TEST-ACCOUNT').length, 1);
assert.equal(mapPaymentReport({ ...response, data: [{ ...row, InstrumentNumber: '' }] }, 'TEST-ACCOUNT')[0].status, 'PENDING');
assert.throws(() => mapPaymentReport(response, 'OTHER-ACCOUNT'), /account/i);
assert.throws(() => mapPaymentReport({ ...response, data: [{ ...row, TaxAmount: null }] }, 'TEST-ACCOUNT'), /TaxAmount/);
assert.throws(() => mapPaymentReport({ ...response, data: [row, { ...row, NetPayable: 1 }] }, 'TEST-ACCOUNT'), /conflicting/i);
assert.throws(() => mapPaymentReport({ sts: 1, data: [] }, 'TEST-ACCOUNT'), /refused/i);
const detail = mapPaymentDetail({ sts: 0, data: { clientInfo: { accountNo: 'TEST-ACCOUNT' },
  paymentHead: { totalCODAmount: 500000, invoiceAmount: 25000, whTax: 15000, netPayable: 459900 },
  invoiceSummary: { shipmentCharge: 18000, fuel_Charge: 3000, gst: 4000, extraCharges: 0 },
  consignments: [{ consignmentNumber: 'TEST-CN', codAmount: 1000, shippingCharges: 0,
    cnWiseInvoiceAmount: 25, incomeTaxAmount: 20, salesTaxAmount: 20, wthTax: 40 }] } }, 'TEST-ACCOUNT');
assert.equal(detail.summary.net, '459900.00', 'detail net already includes bank fee; never deduct it twice');
assert.equal(detail.orders.length, 1);
assert.equal(detail.orders[0].whIncomeTax, 20);
assert.throws(() => mapPaymentDetail({ sts: 0, data: { clientInfo: { accountNo: 'OTHER' }, consignments: [] } }, 'TEST-ACCOUNT'), /account/i);
const config = portalConfig('j="".concat(d,"//codapi.mnpcourier.com/CustomerPortalAPI/"),b="synthetic-key",u="other"');
assert.equal(config.base, 'https://codapi.mnpcourier.com/CustomerPortalAPI/');
assert.equal(config.key, 'synthetic-key');
assert.throws(() => portalConfig('unexpected bundle'), /client changed/i);
console.log('M&P checks passed: one consolidated payment, net less IBFT once, tax retained, no invoice multiplication, pending status, company account validation, detail mapping and safe client discovery.');
