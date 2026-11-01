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
  globalThis.checkUi = { S, reportView, receiptListView, openReceipt, entriesView, spendingView };
})();`), sandbox);
const ui = sandbox.checkUi;
ui.S.report = { year: { from: '2026-07-01', to: '2027-06-30' },
  banks: [{ id: 1, title: 'Synthetic <Trading>', name: 'Sample Bank', active: true,
    accountNo: 'PRIVATE-ACCOUNT-123', opening: '100000.00', inYear: '870000.00', outYear: '20000.00',
    fromCouriersYear: '870000.00', receivable: '430000.00', balance: '950000.00',
    receivedCprs: 1, receivableCprs: 1 }],
  totals: { opening: '100000.00', inYear: '870000.00', outYear: '20000.00', received: '870000.00',
    receivable: '430000.00', balance: '950000.00', receivedCprs: 1, receivableCprs: 1 },
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
assert.match(view, /<tfoot>/);
assert.match(view, /aria-label="View received CPR \(1\)"/);
assert.doesNotMatch(view, /class="bkactions"/);
assert.doesNotMatch(view, /PRIVATE-ACCOUNT-123/);
assert.ok(view.indexOf('id="bankCprList"') > view.indexOf('</table>'));
ui.S.bankView = 'activity';
assert.match(ui.reportView(), /<h2>Recent activity/);
assert.doesNotMatch(ui.reportView(), /<table class="plain bkbanks"/);
ui.S.bankView = 'accounts';
assert.match(ui.entriesView(), /Fiscal opening In \/ Out/);
assert.match(ui.entriesView(), /id="aType"/);
ui.S.spendingRows=[{on:'2026-10-21',amount:'-200.00',details:Array.from({length:16},(_,i)=>({value:i===2?'Receiver':i===6?'Sender':i===13?'Account head':i===15?'Combined remarks':''}))},
  {on:'2026-09-21',amount:'-100.00',details:[]}];
ui.S.spendingMonth='2026-10';
assert.match(ui.spendingView(),/Combined remarks/);
assert.match(ui.spendingView(),/Account head/);
assert.match(ui.spendingView(),/200\.00/);
assert.doesNotMatch(ui.spendingView(),/2026-09-21/);
ui.S.selectedBank = 1; ui.S.receiptFilter = 'receivable';
assert.match(ui.receiptListView(), /PENDING-1/);
assert.doesNotMatch(ui.receiptListView(), /R&lt;&amp;1/);
ui.S.report.receipts.push({bankId:1,accountId:2,cpr:'NEGATIVE-1',state:'receivable',included:true,nonCash:true,net:'-500.00'});
assert.match(ui.receiptListView(), /class="n neg">-500\.00/);
assert.match(ui.receiptListView(), /Courier due; no bank movement/);
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
ui.S.report.totals.coverage = { balance: { included: 1, total: 2, complete: false } };
view = ui.reportView();
assert.match(view, /1 of 2 accounts · available total/);
assert.match(view, /950,000\.00<sup class="bk-star"/);
assert.match(view, /<tfoot>[\s\S]*950,000\.00<sup class="bk-star"/);
console.log('Banking UI checks passed: compact amount actions, all column totals, partial-total disclosure, separate activity view, CPR lists, escaped content, popup and Excel action. Visual browser QA is separate.');
