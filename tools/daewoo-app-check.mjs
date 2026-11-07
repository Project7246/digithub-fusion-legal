import assert from 'node:assert/strict';
import { createDaewooAdapter, openDaewooPortal } from '../daewoo.js';
import { createDaewooRouter } from '../daewoo-routes.js';
import { adapterFor, courierKinds, deductingCouriers } from '../adapters.js';
let sessions=0,closed=0;
class Portal {
  async login(user,password){assert.equal(user,'fixture-user');assert.equal(password,'fixture-portal-password');sessions++;}
  async customers(){return [{customer_id:'001',customer_name:'Fixture customer'}];}
  close(){closed++;}
  async financialRows(from,to,customer){assert.equal(customer,'001');return [{booking_id:'0005',BarCode:'00009',status:'Delivered',amount_cod:'100.00',AmountPaid2:null,Service_invoice_no:'service-a',Payment_invoice_no:'cod-a'}];}
  async covers(){return [{invoice_no:'cod-a',customer_id:'001',TotalCODAmount:'100.00',TotalServiceCharges:'0.00',TotalReimbursementAmount:'100.00'}];}
  async detail(invoice,customer){assert.equal(customer,'001');return [{booking_id:'0005',invoice_no:invoice,amount_cod:'100.00',RST_Amt:'2.00',RWHT_Amt:'2.00'}];}
}
const extra={apiKey:'fixture-key',apiUser:'fixture-api-user',apiPassword:'fixture-api-password',portalPassword:'fixture-portal-password',customer:'001'};
const adapter=createDaewooAdapter({Portal,fetcher:async(url,opts)=>{
  assert.equal(new URL(url).origin,'https://codapi.daewoo.net.pk');
  assert.equal(new URL(url).searchParams.get('apiKey'),extra.apiKey);assert.equal(opts.redirect,'manual');
  return Response.json({Success:true,Error:false,Data:[{terminal_id:'01',terminal_name:'Fixture terminal'}]});
}});
const check=await adapter.testToken('fixture-user',extra);
assert.equal(check.ok,true);assert.equal(check.learned.customerId,'001');
assert.ok(!JSON.stringify(check).includes('fixture-key'));
assert.equal(adapter.manualOnly,true);assert.equal(adapter.financialPosting,false);
assert.equal(adapter.fetchOrders,undefined,'live reports must not enter parcel-net storage');
assert.equal(adapterFor('daewoo').name,'Daewoo');
assert.equal(courierKinds().find(k=>k.key==='daewoo').reportPath,'/daewoo');
assert.ok(!deductingCouriers().includes('daewoo'));
assert.equal(adapter.fields[0].name,'token');assert.equal(adapter.fields[0].secret,false);
assert.ok(adapter.fields.filter(f=>/Password|Key/.test(f.name)).every(f=>f.secret));
assert.equal((await adapter.fetchAreas('fixture-user',extra))[0].id,'01');
const bad=createDaewooAdapter({Portal,fetcher:async()=>{throw new Error('fixture-key private url');}});
await assert.rejects(bad.testToken('fixture-user',extra),e=>!e.message.includes('fixture-key'));
await assert.rejects(openDaewooPortal('fixture-user',{...extra,customer:'outside'},Portal),/CUSTOMER_SELECTION_REQUIRED/);
assert.equal(sessions,closed,'all private sessions closed after tests');

// Invoke the Express handlers with synthetic scoped services, without a server/DB.
let realm='realm-a',accountRealm,who={role:'viewer',allowed:true},foreign=false;
const router=createDaewooRouter({requireCompany:async()=>realm,
  getWho:async()=>who,listAccounts:async r=>{assert.equal(r,realm);return [{id:1,courier:'daewoo',label:'Fixture',token:'DO_NOT_RETURN',creds:'DO_NOT_RETURN'}];},
  getAccount:async(r,id)=>{accountRealm=r;return foreign?null:{id,courier:'daewoo',token:'fixture-user'};},credsOf:()=>extra,
  openPortal:(token,creds)=>openDaewooPortal(token,creds,Portal)});
async function call(path,query={}){
  const layer=router.stack.find(l=>l.route?.path===path);
  const response={code:200,status(n){this.code=n;return this;},set(){return this;},json(value){this.body=value;return this;}};
  await layer.route.stack[0].handle({query},response);return response;
}
let r=await call('/accounts');assert.equal(r.code,200);assert.deepEqual(r.body.accounts,[{id:1,label:'Fixture'}]);
const q={account:'1',from:'2026-01-01',to:'2026-01-31'};
r=await call('/orders',q);assert.equal(accountRealm,'realm-a');assert.equal(r.body.rows[0].AmountPaid2,null);
assert.equal(r.body.postingAllowed,false);assert.equal(r.body.rows[0].Service_invoice_no,'service-a');
r=await call('/invoices',q);assert.equal(r.body.rows[0].invoice_no,'cod-a');
r=await call('/detail',{...q,invoice:'cod-a'});assert.equal(r.body.rows.length,1);
r=await call('/detail',{...q,invoice:'outside'});assert.equal(r.code,404);
r=await call('/orders',{...q,from:'2026-02-30'});assert.equal(r.code,400);
foreign=true;r=await call('/orders',q);assert.equal(r.code,404);foreign=false;
who={role:'custom',rights:[],allowed:true};r=await call('/orders',q);assert.equal(r.code,403);
who={role:'viewer',allowed:true,hideMoney:true};r=await call('/orders',q);assert.equal(r.code,403);
who={role:'custom',allowed:true,rights:{apps:['couriersync'],money:{logistics:false}}};r=await call('/orders',q);assert.equal(r.code,403);
assert.equal(sessions,closed);
console.log('Daewoo app: encrypted-extra credential contract, connection, private sessions, scoped reports, invoice ownership, missing money, no posting/storage PASS; synthetic only.');
