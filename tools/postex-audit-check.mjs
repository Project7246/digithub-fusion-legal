import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { listPortalCprs } from '../couriers.js';
import { pool } from '../db.js';
import { fetchOrders } from '../postex.js';
import { pickupOrders } from '../dashdata.js';

const originalFetch = globalThis.fetch;
const originalQuery = pool.query;
try {
  globalThis.fetch = async () => { throw new Error('provider unavailable'); };
  await assert.rejects(fetchOrders('fixture', '2026-10-27', '2026-11-02'), /provider unavailable/);
  pool.query = async (sql, args) => {
    assert.match(sql, /realm_id = \$1/);
    assert.match(sql, /account_id = \$2/);
    assert.deepEqual(args, ['fixture-company', 5, '2026-10-27']);
    return { rows: [{ tracking: 'fixture', amount: '1000.25', fee: '100.10', tax: '16.02',
      picked_on: '2026-10-27', total_count: '2001', total_amount: '2001500.25' }] };
  };
  const result = await pickupOrders('fixture-company', { account: 5, day: '2026-10-27' });
  assert.equal(result.parcels, 2001);
  assert.equal(result.amount, 2001500.25);
  assert.equal(result.capped, true);
  assert.equal(result.orders[0].fee, 100.10);
  assert.equal(result.orders[0].tax, 16.02);
  assert.equal(result.orders[0].pickedOn, '2026-10-27');
  pool.query = async () => ({ rows: [] });
  const empty = await pickupOrders('fixture-company', { account: 5, day: '2026-10-27' });
  assert.equal(empty.parcels, 0);
  assert.equal(empty.amount, 0);
  assert.equal(empty.capped, false);
  pool.query = async (sql, args) => {
    assert.match(sql, /c.created_on < \(\$4::date \+ 1\)/);
    assert.deepEqual(args, ['fixture-company', 5, '2026-05-03', '2026-11-02']);
    return { rows: Array.from({length: 26}, (_, i) => ({cpr_number:'CPR-'+i, net_amount:'900.25'})) };
  };
  assert.equal((await listPortalCprs('fixture-company', {account:5, from:'2026-05-03', to:'2026-11-02'})).length, 26);
  const html = readFileSync(new URL('../public/receipts.html', import.meta.url), 'utf8');
  assert.match(html, /querySelectorAll\('\.cbar button\[data-days\]'/);
  assert.doesNotMatch(html, /querySelectorAll\('\.bar button\[data-days\]'/);
  const source = html.slice(html.indexOf('  function renderOurs(list){'), html.indexOf('  function loadAccounts()'));
  const nodes = Object.fromEntries(['cards','ours'].map(k => [k, {innerHTML:'', querySelectorAll:()=>[]} ]));
  const ctx = { $:k=>nodes[k], scopeAccount:{label:'Fixture'}, courier:'postex', location:{search:''},
    URLSearchParams, esc:String, cname:String, n0:String, full:String };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.renderOurs(Array.from({length:26}, (_,i)=>({cpr:'CPR-'+i,net:900.25,amount:1000,charges:99.75,orders:1})));
  assert.match(nodes.cards.innerHTML, />26<\/div>/);
  assert.match(nodes.cards.innerHTML, /23406.5/);
  assert.equal((nodes.ours.innerHTML.match(/class="click rrow"/g)||[]).length,26);
  ctx.renderOurs([]);
  assert.equal(nodes.cards.innerHTML,'');
  console.log('PostEx API failure and pickup detail checks passed (synthetic data only).');
} finally {
  globalThis.fetch = originalFetch;
  pool.query = originalQuery;
  await pool.end();
}
