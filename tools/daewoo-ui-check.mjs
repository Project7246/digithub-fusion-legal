// Exercise the real page script with synthetic account/report responses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
class Element {
  constructor(){this.children=[];this.value='';this.textContent='';this.dataset={};this.hidden=false;this.disabled=false;this.classList={toggle(){}};}
  appendChild(child){this.children.push(child);if(child.value&&!this.value)this.value=String(child.value);return child;}
  replaceChildren(){this.children=[];}
  setAttribute(){}
}
const ids=['account','from','to','load','sourceNote','message','search','back','head','rows','empty','prev','count','next'];
const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
const tabs=['orders','invoices','charges'].map(tab=>Object.assign(new Element(),{dataset:{tab}}));
const requests=[];let pending=null;
const context=vm.createContext({URLSearchParams,AbortController,Date,console,
  location:{search:'?account=1'},window:{APP:{ready:Promise.resolve({connected:true})}},
  document:{getElementById:id=>elements[id],createElement:()=>new Element(),querySelectorAll:()=>tabs},
  fetch:async(url,options)=>{
    requests.push({url,options});
    if(url==='/api/daewoo/accounts')return {ok:true,json:async()=>({accounts:[{id:1,label:'Fixture one'},{id:2,label:'Fixture two'}]})};
    if(pending)return pending;
    return {ok:true,json:async()=>({source:'Financial Summary',rows:[{booking_id:'0001',BarCode:'00009',status:'Delivered',AmountPaid2:null,amount_cod:'100.00',Service_invoice_no:'<script>fixture</script>'}]})};
  }});
const html=readFileSync('public/daewoo.html','utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
vm.runInContext(script,context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));await tick();
assert.equal(elements.account.value,'1');assert.equal(requests.length,1,'opening page does not load entire portal history');
elements.from.value='2026-01-01';elements.to.value='2026-01-31';elements.load.onclick();await tick();
assert.match(requests[1].url,/account=1/);assert.equal(elements.rows.children.length,1);
const cells=elements.rows.children[0].children;
assert.equal(cells[0].textContent,'0001','preserve leading-zero identifiers');
assert.equal(cells.at(-1).textContent,'Unavailable','null paid figure must not display as zero');
assert.equal(cells[7].textContent,'<script>fixture</script>','upstream text is textContent, not HTML');
let resolve;pending=new Promise(r=>{resolve=r;});elements.load.onclick();await tick();
const inFlight=requests.at(-1);elements.account.value='2';elements.account.onchange();
assert.equal(inFlight.options.signal.aborted,true);
resolve({ok:true,json:async()=>({rows:[{booking_id:'STALE_PRIVATE_ROW'}]})});await tick();
assert.equal(elements.rows.children.length,0,'late previous-account response cannot populate the new account');
pending=null;tabs[1].onclick();assert.equal(elements.rows.children.length,0);
assert.ok(!html.includes('setInterval'),'no always-on report polling');
console.log('Daewoo UI: scoped selection, manual load, literal source text, leading-zero IDs, missing money and stale-response cancellation PASS.');
