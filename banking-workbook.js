import XLSX from 'xlsx';

export const SUMMARY_FIELDS = [
  ['gross', 'COD / gross collections'], ['charges', 'Courier charges / recovered invoices'],
  ['tax', 'GST'], ['salesTax', 'Withholding sales tax'],
  ['incomeTax', 'Withholding income tax'], ['withholding', 'Total withholding'],
  ['miscellaneous', 'Miscellaneous charges'], ['carryForward', 'Carry forward'],
  ['adjustment', 'Adjustment'], ['otherDifference', 'Other deductions / reconciliation difference'],
  ['net', 'Net bank amount']
];

export const ORDER_FIELDS = [
  ['tracking', 'Tracking'], ['orderRef', 'Order'], ['status', 'Status'],
  ['city', 'City'], ['bookedOn', 'Booked'], ['deliveredOn', 'Delivered / returned'],
  ['settledOn', 'Paid'], ['amount', 'COD'], ['received', 'Collected'],
  ['fee', 'Courier charges'], ['upfrontCharges', 'Upfront charges'], ['tax', 'GST'],
  ['whSalesTax', 'WH sales tax'], ['whIncomeTax', 'WH income tax'],
  ['upfront', 'Upfront paid'], ['reserve', 'Reserve'], ['net', 'Net'], ['notes', 'Notes']
];

export function receiptWorkbook(detail) {
  const r = detail.receipt;
  const rows = [['CPR', r.cpr], ['Courier', r.courier], ['Account', r.account],
    ['Status', r.status], ['Created', r.createdOn], ['Paid', r.paidOn],
    ['Bank reported by courier', r.paidToBank], ['Account reported by courier', r.paidToAccount],
    ['Instrument', r.instrument], ['Payment mode', r.mode],
    ...SUMMARY_FIELDS.map(([key, label]) => [label,
      detail.summary[key] == null ? 'Not supplied' : Number(detail.summary[key])]),
    ['Available orders', detail.orders.length], ['Expected orders', r.orders ?? 'Not supplied'],
    ['Detail warning', detail.warning || '']];
  const wb = XLSX.utils.book_new();
  const append = (name, values) => {
    const ws = XLSX.utils.aoa_to_sheet(values);
    ws['!cols'] = values[0].map((_, i) => ({ wch: Math.min(48, Math.max(14,
      ...values.map(row => String(row[i] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  append('CPR summary', rows);
  const numeric = new Set(['amount', 'received', 'fee', 'upfrontCharges', 'tax',
    'whSalesTax', 'whIncomeTax', 'upfront', 'reserve', 'net']);
  append('Orders', [ORDER_FIELDS.map(f => f[1]), ...detail.orders.map(o =>
    ORDER_FIELDS.map(([key]) => o[key] == null ? '' : numeric.has(key) ? Number(o[key]) : o[key]))]);
  if (detail.adjustments?.length) {
    const keys = [...new Set(detail.adjustments.flatMap(a => Object.keys(a)))];
    append('Adjustments', [keys, ...detail.adjustments.map(a => keys.map(k =>
      typeof a[k] === 'object' ? JSON.stringify(a[k]) : a[k] ?? ''))]);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
