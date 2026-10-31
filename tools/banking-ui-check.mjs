// Execute the actual page script with a small DOM stub and synthetic data.
// This checks rendering/interaction logic, not browser layout or live accounts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('public/banking.html', 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1]).find(code => code.includes('function reportView'));
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', disabled: false,
    open: false, events: {}, addEventListener(type, handler) { this.events[type] = handler; },
    showModal() { this.open = true; }, close() { this.open = false; this.events.close?.(); } });
  return elements.get(id);
};
let requested;
const sandbox = { console, setTimeout, clearTimeout, AbortSignal, URL, Date,
  document: { getElementById: element },
  window: { APP: { ready: new Promise(() => {}) } },
  fetch: async url => { requested = url; return { json: async () => ({
    receipt: { cpr: 'R<&1', courier: 'mnp', account: 'Synthetic account', status: 'Transferred' },
    summary: { gross: '1000000.00', charges: '130000.00', net: '870000.00' },
    orders: [{ tracking: 'TEST-1', orderRef: '<script>test</script>', amount: '1000000.00' }]
  }) }; }
};
vm.runInNewContext(script.replace(/\}\)\(\);\s*$/, `
  globalThis.checkUi = { S, reportView, receiptListView, openReceipt };
})();`), sandbox);
const ui = sandbox.checkUi;
ui.S.report = { year: { from: '2026-07-01', to: '2027-06-30' },
  banks: [{ id: 1, title: 'Synthetic <Trading>', name: 'Sample Bank', active: true,
    opening: '100000.00', inYear: '870000.00', outYear: '20000.00',
    fromCouriersYear: '870000.00', receivable: '430000.00', balance: '950000.00',
    receivedCprs: 1, receivableCprs: 1 }],
  totals: { inYear: '870000.00', outYear: '20000.00', receivable: '430000.00', balance: '950000.00' },
  receipts: [
    { bankId: 1, accountId: 1, cpr: 'R<&1', state: 'received', included: true,
      on: '2026-08-02', net: '870000.00', status: 'Transferred' },
    { bankId: 1, accountId: 2, cpr: 'PENDING-1', state: 'receivable', included: true,
      on: '2026-08-03', net: '430000.00', status: 'Pending' }
  ], moves: [] };
let view = ui.reportView();
assert.match(view, /Synthetic &lt;Trading&gt;/);
assert.match(view, /950,000\.00/);
assert.match(view, /View received CPR \(1\)/);
assert.match(view, /View receivable CPR \(1\)/);
assert.doesNotMatch(view, /data-bank=|class="kids"/);
assert.ok(view.indexOf('id="bankCprList"') > view.indexOf('</table>'));
ui.S.selectedBank = 1; ui.S.receiptFilter = 'receivable';
assert.match(ui.receiptListView(), /PENDING-1/);
assert.doesNotMatch(ui.receiptListView(), /R&lt;&amp;1/);
ui.S.receiptFilter = 'received';
assert.match(ui.receiptListView(), /R&lt;&amp;1/);
assert.doesNotMatch(ui.receiptListView(), /PENDING-1/);
ui.openReceipt(1, 'R<&1');
await new Promise(resolve => setImmediate(resolve));
assert.match(requested, /account=1&ref=R%3C%261/);
assert.equal(element('bkDialog').open, true);
assert.equal(element('bkDownload').disabled, false);
assert.match(element('bkDetailBody').innerHTML, /870,000\.00/);
assert.match(element('bkDetailBody').innerHTML, /&lt;script&gt;test&lt;\/script&gt;/);
console.log('Banking UI checks passed: separate CPR lists, bank rows do not expand, net balance, escaped content, CPR popup and enabled Excel download. Visual browser QA is separate.');
