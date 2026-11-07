// Real dashboard script, synthetic reports only; no browser/DB/production calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(){this.children=[];this.value='';this.textContent='';this.dataset={};this.hidden=false;this.disabled=false;this.selectedIndex=0;this.classList={toggle(){},add(){},remove(){}};}
 get options(){return this.children;}
 appendChild(c){this.children.push(c);if(c.value&&!this.value)this.value=String(c.value);return c;}
 replaceChildren(){this.children=[];}
 setAttribute(){}
}
const ids=['account','from','to','load','sourceNote','message','search','back','head','rows','empty','prev','count','next','mainTabs','subTabs','cards','tableTitle','coverage','btnPick','picker','ttl'];
const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
const mainTabs=['parcels','finance','receipts'].map(main=>Object.assign(new Element(),{dataset:{main}}));
const dayTabs=[0,6,29,89].map(days=>Object.assign(new Element(),{dataset:{days}}));
const requests=[];let pending=null;
function report(account){return {orders:[{booking_id:account==='2'?'0002':'0001',BarCode:'00009',status:'Delivered',fusionStatusGroup:'delivered',amount_cod:'100.00',Service_invoice_no:'<script>fixture</script>'}],covers:[{invoice_no:'COD-1',TotalCODAmount:'100.00',TotalServiceCharges:'0.00',TotalReimbursementAmount:'100.00'}],settlements:null};}
const context=vm.createContext({URLSearchParams,AbortController,Date,console,location:{search:'?account=1'},
 window:{APP:{ready:Promise.resolve({connected:true})}},document:{getElementById:id=>elements[id],createElement:()=>new Element(),querySelectorAll:s=>s==='[data-main]'?mainTabs:s==='[data-days]'?dayTabs:[]},
 fetch:async(url,options)=>{
  requests.push({url,options});
  if(url==='/api/daewoo/accounts')return {ok:true,json:async()=>({accounts:[{id:1,label:'Fixture one'},{id:2,label:'Fixture two'}]})};
  if(pending){const value=pending;pending=null;return value;}
  if(url.includes('/detail'))return {ok:true,json:async()=>({rows:[{booking_id:'0001',RST_Amt:null,RWHT_Amt:'0.00'}]})};
  return {ok:true,json:async()=>report(new URLSearchParams(url.split('?')[1]).get('account'))};
 }});
vm.runInContext(readFileSync('public/daewoo-dashboard.js','utf8'),context);
const tick=()=>new Promise(r=>setImmediate(r));await tick();
assert.equal(elements.account.value,'1');assert.equal(requests.length,2,'one finite default-period load, no polling');
assert.match(requests[1].url,/dashboard\?account=1/);
assert.equal(elements.rows.children[0].children[0].textContent,'0001');
assert.ok(!elements.head.children[0].children.some(c=>/\bCOD\b|charges|\bpaid\b/i.test(c.textContent)),'Parcels carries no money');
mainTabs[1].onclick();
assert.ok(elements.rows.children.some(r=>r.children[1].textContent==='Unavailable'),'unmatched net is unavailable, not zero');
elements.subTabs.children.find(b=>b.textContent==='Delivery / tax invoices').onclick();
assert.equal(elements.rows.children[0].children[1].textContent,'<script>fixture</script>','source text is never innerHTML');
mainTabs[2].onclick();elements.rows.children[0].children[0].children[0].onclick();await tick();
assert.equal(elements.rows.children[0].children[4].textContent,'Unavailable');
assert.equal(elements.rows.children[0].children[5].textContent,'0.00','known zero tax stays distinct from missing');
mainTabs[0].onclick();let resolve;pending=new Promise(r=>{resolve=r;});elements.load.onclick();await tick();
const inFlight=requests.at(-1);elements.account.value='2';elements.account.selectedIndex=1;elements.account.onchange();await tick();
assert.equal(inFlight.options.signal.aborted,true);resolve({ok:true,json:async()=>({orders:[{booking_id:'STALE_PRIVATE_ROW'}],covers:[]})});await tick();
assert.equal(elements.rows.children[0].children[0].textContent,'0002');assert.equal(elements.ttl.textContent,'Fixture two');
const html=readFileSync('public/daewoo.html','utf8'),standard=readFileSync('public/courier-dash.html','utf8');
assert.ok(html.includes('/courier-dashboard.css')&&standard.includes('/courier-dashboard.css'),'one actual shared courier stylesheet');
assert.ok(!html.includes('<select')&&!html.includes('Manage account'),'sidebar is the account selector, no duplicate controls');
assert.match(requests.find(r=>r.url.includes('refresh=1')).url,/dashboard/,'manual refresh bypasses short portal cache');
for(const label of ['Parcels','Finance','Receipts'])assert.ok(html.includes('>'+label+'</button>'));
assert.ok(!readFileSync('public/daewoo-dashboard.js','utf8').includes('setInterval'));
console.log('Daewoo dashboard: shared courier stylesheet/tabs, no-money Parcels, missing vs zero, source escaping, finite reads and stale scope cancellation PASS.');
