// M&P's own consolidated payment report. The COD API Payment_Report is a
// consignment report with repeated invoice totals, not the bank payment.
import { call } from './wire.js';
import { money, addMoney } from './banking-money.js';

const PORTAL = 'https://mnpcourier.com/cplight/';
let clientCache = null;
let discovering = null;

export function portalConfig(source) {
  // Read the current public portal client's gateway key at runtime. Never
  // copy a credential into source, logs, environment settings or the database.
  const match = source.match(/\/\/codapi\.mnpcourier\.com\/CustomerPortalAPI\/"\),\w+="([^"]+)"/);
  if (!match) throw new Error('M&P portal client changed; payment source needs review');
  return { base: 'https://codapi.mnpcourier.com/CustomerPortalAPI/', key: match[1] };
}

async function publicText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error('M&P portal client unavailable (HTTP ' + response.status + ')');
  return response.text();
}

async function client() {
  if (clientCache && Date.now() - clientCache.at < 24 * 3600000) return clientCache.value;
  if (discovering) return discovering;
  discovering = (async () => {
    const html = await publicText(PORTAL);
    const path = html.match(/src="([^"]*\/static\/js\/main\.[a-z0-9]+\.chunk\.js)"/i)?.[1];
    if (!path) throw new Error('M&P portal client changed; main script not found');
    const url = new URL(path, PORTAL);
    if (url.origin !== new URL(PORTAL).origin) throw new Error('Unexpected M&P portal script origin');
    const value = portalConfig(await publicText(url.href));
    clientCache = { at: Date.now(), value };
    return value;
  })();
  try { return await discovering; } finally { discovering = null; }
}

async function report(path, body, retry = true) {
  const config = await client();
  const response = await call({ url: config.base + 'api/reports/' + path,
    method: 'POST', headers: { 'Content-Type': 'application/json', key: config.key }, body });
  if ((response.status === 401 || response.status === 403) && retry) {
    clientCache = null;
    return report(path, body, false);
  }
  if (!response.ok || !response.json) throw new Error('M&P consolidated payment report unavailable (HTTP ' + response.status + ')');
  if (response.json.sts !== 0) throw new Error('M&P consolidated payment report refused the request');
  return response.json;
}

function currency(value, field) {
  if (value == null || value === '') throw new Error('M&P payment is missing ' + field);
  money(value); // validate exact decimal paisa before accepting a bank figure
  return addMoney([value]);
}
const day = value => {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

export function mapPaymentReport(response, account) {
  if (response.sts !== 0 || !Array.isArray(response.data)) throw new Error('M&P payment report refused or returned an invalid shape');
  const result = new Map();
  const bank = response.details || {};
  if (bank.accountNo && String(bank.accountNo).trim().toUpperCase() !== String(account).trim().toUpperCase()) {
    throw new Error('M&P payment header account did not match the requested account');
  }
  for (const row of response.data) {
    if (String(row.accountNo || '').trim().toUpperCase() !== String(account).trim().toUpperCase()) {
      throw new Error('M&P payment account did not match the requested account');
    }
    const paymentId = String(row.PaymentID || '').trim();
    const paidOn = day(row.PaidOn);
    if (!paymentId || !paidOn) throw new Error('M&P payment has no reference or payment date');
    const amount = currency(row.RRAmount, 'RRAmount');
    const invoiced = currency(row.InvoiceAmount, 'InvoiceAmount');
    const withholding = currency(row.TaxAmount, 'TaxAmount');
    const bankFee = currency(row.IBFTFee, 'IBFTFee');
    const beforeBankFee = currency(row.NetPayable, 'NetPayable');
    if (money(bankFee) < 0n) throw new Error('M&P returned an invalid IBFT fee');
    const mode = String(row.InstrumentMode || '').trim();
    const instrument = String(row.InstrumentNumber || '').trim();
    const mapped = { paymentId, paidOn, amount, invoiced, withholding, bankFee,
      netPayable: addMoney([beforeBankFee, '-' + bankFee]), beforeBankFee,
      status: instrument && /^IBFT$/i.test(mode) ? 'CLOSED' : 'PENDING',
      mode, instrument, account: String(account), consolidated: true,
      bank: bank.BANK_NAME || '', beneficiary: bank.BeneficiaryName || '',
      bankAccount: bank.BeneficiaryBankAccNo || '' };
    const previous = result.get(paymentId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(mapped)) {
      throw new Error('M&P returned conflicting totals for one payment');
    }
    result.set(paymentId, mapped);
  }
  return [...result.values()];
}

export async function fetchPayouts(account, from, to) {
  if (!account) throw new Error('Validate this M&P account before reading payments');
  if (!day(from) || !day(to)) throw new Error('Payment date range is required');
  return mapPaymentReport(await report('paymentinstrumentreport', {
    StartDate: from, EndDate: to, Account: account, subAccountId: []
  }), account);
}

export function mapPaymentDetail(response, account) {
  const data = response.data;
  if (response.sts !== 0 || !data || !Array.isArray(data.consignments)) throw new Error('M&P payment detail refused or returned an invalid shape');
  if (String(data.clientInfo?.accountNo || '').trim().toUpperCase() !== String(account).trim().toUpperCase()) {
    throw new Error('M&P detail account did not match the requested account');
  }
  const head = data.paymentHead || {};
  const invoice = data.invoiceSummary || {};
  const rounded = value => {
    if (value == null) return null;
    if (!Number.isFinite(Number(value))) throw new Error('M&P invoice detail has an invalid amount');
    return Number(value).toFixed(2);
  };
  return { summary: {
    gross: currency(head.totalCODAmount, 'totalCODAmount'),
    charges: currency(head.invoiceAmount, 'invoiceAmount'),
    // GST is part of the recovered invoice total, not an extra deduction.
    invoiceGst: rounded(invoice.gst), shipping: rounded(invoice.shipmentCharge),
    fuel: rounded(invoice.fuel_Charge), extraCharges: rounded(invoice.extraCharges),
    withholding: currency(head.whTax, 'whTax'),
    net: currency(head.netPayable, 'netPayable')
  }, orders: data.consignments.map(o => ({
    tracking: String(o.consignmentNumber || ''), orderRef: o.orderRefNo || '',
    bookedOn: o.bookingDate || '', deliveredOn: o.rrDate || '', city: o.destination || '',
    status: o.cnStatus || '', amount: o.codAmount, fee: o.shippingCharges,
    invoiceAmount: o.cnWiseInvoiceAmount, taxableAmount: o.taxAbleAmount,
    whIncomeTax: o.incomeTaxAmount, whSalesTax: o.salesTaxAmount,
    withholding: o.wthTax
  })), adjustments: [],
    paidToBank: data.clientInfo.bank_Name || '', paidToAccount: data.clientInfo.beneficiaryBankAccNo || '' };
}

export async function paymentDetail(account, paymentId) {
  return mapPaymentDetail(await report('paymentinstrumentdetailreport', { PaymentID: String(paymentId) }), account);
}
