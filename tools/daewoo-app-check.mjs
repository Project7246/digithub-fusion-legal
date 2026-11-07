import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDaewooAdapter, openDaewooPortal } from '../daewoo.js';
import { mapDaewooOrders } from '../daewoo-map.js';
import { saveDaewooBundle } from '../daewoo-store.js';
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
  async syncBundle(from,to,customer){return {orders:await this.financialRows(from,to,customer),covers:await this.covers(from,to,customer),details:await this.detail('cod-a',customer),customerId:customer,from,to};}
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
assert.equal(adapter.manualOnly,false);assert.equal(adapter.lists,true);assert.equal(adapter.financialPosting,false);
assert.equal(adapter.groupOf('Ready for delivery'),'transit');
assert.equal(adapter.groupOf('RTO Delivered'),'returned');
assert.equal(adapter.groupOf('Unrecognized fixture status'),'other');
const mapped=mapDaewooOrders([{booking_id:'0005',BarCode:'00009',amount_cod:'100.00',amount_wr:null,Payment_invoice_no:'cod-a'}],
  ()=> 'delivered',[{booking_id:'0005',invoice_no:'cod-a',amount_wr:'5.00',RST_Amt:'2.00',RWHT_Amt:'2.00'}])[0];
assert.equal(mapped.amount,'100.00');assert.equal(mapped.fee,'5.00');assert.equal(mapped.tax,'4.00');
const linked=mapDaewooOrders([{booking_id:'0007',BarCode:'00011',invoice_no:'COD-7',Payment_invoice_no:'PAY-7',booking_datetime_f:'07/11/2026'}],
  ()=> 'delivered',[{booking_id:'0007',invoice_no:'COD-7',amount_wr:'8.00',RST_Amt:'20.00',RWHT_Amt:'30.00'}])[0];
assert.equal(linked.tax,'50.00','tax detail links to the COD invoice, not the separate payment invoice');
assert.equal(linked.fee,'8.00');assert.equal(linked.bookedOn,'2026-11-07','Daewoo day-first source dates become usable dashboard dates');
const slashDate=mapDaewooOrders([{booking_id:'0008',BarCode:'00012',booking_datetime_f:'/Date(1794009600000)/'}],()=> 'other')[0];
assert.equal(slashDate.bookedOn,'2026-11-07');
const unknown=mapDaewooOrders([{booking_id:'0006',BarCode:'00010',amount_cod:null,amount_wr:null}],()=> 'other')[0];
assert.equal(unknown.amount,null);assert.equal(unknown.fee,null);assert.equal(unknown.tax,null,'missing source values stay NULL, not zero');
const sql=[],stored=[];
const fakeDb={connect:async()=>({query:async(text,params=[])=>{
  sql.push(text);
  if(text.includes('INSERT INTO courier_orders')){assert.equal(params[7],'100.00');assert.equal(params[11],'2026-11-07');assert.match(text,/EXCLUDED\.courier IN \('postex','daewoo'\)/);}
  if(text.includes('INSERT INTO daewoo_source_reports'))stored.push({kind:params[3],payload:JSON.parse(params[7])});
  return {rows:[]};
},release(){}})};
const persisted=await saveDaewooBundle({realmId:'fixture-realm',accountId:7,customerId:'001',from:'2026-01-01',to:'2026-01-31',
  orders:[{booking_id:'0005',BarCode:'00009',status:'Delivered',amount_cod:'100.00',booking_datetime_f:'07/11/2026',Payment_invoice_no:'cod-a',AmountPaid2:'90.00',Service_invoice_no:'service-a'}],
  covers:[{invoice_no:'cod-a',TotalCODAmount:'100.00'}],
  details:[{booking_id:'0005',invoice_no:'cod-a',amount_wr:'5.00',RST_Amt:'2.00',RWHT_Amt:'2.00'}]},fakeDb);
assert.equal(persisted.orders,1);assert.ok(sql[0]==='BEGIN'&&sql.at(-1)==='COMMIT');
assert.ok(stored.some(x=>x.kind==='cod-cpr')&&stored.some(x=>x.kind==='cod-cpr-detail'));
assert.ok(stored.some(x=>x.kind==='delivery-charge')&&stored.some(x=>x.kind==='tax')&&stored.some(x=>x.kind==='payment-report'));
assert.equal(typeof adapter.fetchOrders,'function','Daewoo parcels are imported through the standard courier adapter');
assert.equal(adapter.reportPath,'/courier-dash');
const sharedDashboard=readFileSync('public/courier-dash.html','utf8');
assert.match(sharedDashboard,/daewooSyncStatus/);assert.match(sharedDashboard,/Syncing reports/);
assert.match(sharedDashboard,/aria-live="polite"/,'the report sync result is announced accessibly');
assert.equal(adapterFor('daewoo').name,'Daewoo');
assert.equal(courierKinds().find(k=>k.key==='daewoo').reportPath,'/courier-dash');
assert.ok(!deductingCouriers().includes('daewoo'));
assert.equal(adapter.fields[0].name,'token');assert.equal(adapter.fields[0].secret,false);
assert.ok(adapter.fields.filter(f=>/Password|Key/.test(f.name)).every(f=>f.secret));
assert.equal((await adapter.fetchAreas('fixture-user',extra))[0].id,'01');
const bad=createDaewooAdapter({Portal,fetcher:async()=>{throw new Error('fixture-key private url');}});
await assert.rejects(bad.testToken('fixture-user',extra),e=>!e.message.includes('fixture-key'));
await assert.rejects(openDaewooPortal('fixture-user',{...extra,customer:'outside'},Portal),/CUSTOMER_SELECTION_REQUIRED/);
assert.equal(sessions,closed,'all private sessions closed after tests');

// Invoke the Express handlers with synthetic scoped services, without a server/DB.
let realm='realm-a',accountRealm,who={role:'viewer',allowed:true},foreign=false,savedBundle=null,syncMarks=0;
const router=createDaewooRouter({requireCompany:async()=>realm,
  getWho:async()=>who,listAccounts:async r=>{assert.equal(r,realm);return [{id:1,courier:'daewoo',label:'Fixture',token:'DO_NOT_RETURN',creds:'DO_NOT_RETURN'}];},
  getAccount:async(r,id)=>{accountRealm=r;return foreign?null:{id,courier:'daewoo',token:'fixture-user'};},credsOf:()=>extra,
  openPortal:(token,creds)=>openDaewooPortal(token,creds,Portal),markSynced:async()=>{syncMarks++;},
  saveBundle:async bundle=>{savedBundle=bundle;return {orders:bundle.orders.length,documents:4};},
  readBundle:async scope=>({sourceReports:[{kind:'cod-cpr',reference:'cod-a',payload:{invoice_no:'cod-a'}}],scope})});
async function call(path,query={},body={}){
  const layer=router.stack.find(l=>l.route?.path===path);
  const response={code:200,status(n){this.code=n;return this;},set(){return this;},json(value){this.body=value;return this;}};
  await layer.route.stack[0].handle({query,body},response);return response;
}
let r=await call('/accounts');assert.equal(r.code,200);assert.deepEqual(r.body.accounts,[{id:1,label:'Fixture'}]);
const q={account:'1',from:'2026-01-01',to:'2026-01-31'};
r=await call('/orders',q);assert.equal(accountRealm,'realm-a');assert.equal(r.body.rows[0].AmountPaid2,null);
assert.equal(r.body.postingAllowed,false);assert.equal(r.body.rows[0].Service_invoice_no,'service-a');
r=await call('/dashboard',q);assert.equal(r.body.orders[0].fusionStatusGroup,'delivered');
assert.equal(r.body.covers[0].invoice_no,'cod-a');assert.equal(r.body.settlements,null);
const sessionsBeforeCache=sessions;
r=await call('/dashboard',q);assert.equal(r.body.cached,true);assert.equal(sessions,sessionsBeforeCache);
r=await call('/dashboard',{...q,refresh:'1'});assert.equal(r.body.cached,false);assert.equal(sessions,sessionsBeforeCache+1);
realm='realm-b';r=await call('/dashboard',q);assert.equal(r.body.cached,false);realm='realm-a';
foreign=true;r=await call('/dashboard',q);assert.equal(r.code,404,'cached reports still require current account ownership');foreign=false;
r=await call('/invoices',q);assert.equal(r.body.rows[0].invoice_no,'cod-a');
r=await call('/detail',{...q,invoice:'cod-a'});assert.equal(r.body.rows.length,1);
r=await call('/detail',{...q,invoice:'outside'});assert.equal(r.code,404);
r=await call('/sync',{}, {...q});assert.equal(r.code,200);assert.equal(r.body.ok,true);
assert.equal(savedBundle.details[0].RST_Amt,'2.00');assert.equal(savedBundle.orders[0].booking_id,'0005');assert.equal(syncMarks,1);
r=await call('/stored',q);assert.equal(r.body.sourceReports[0].reference,'cod-a');
r=await call('/orders',{...q,from:'2026-02-30'});assert.equal(r.code,400);
foreign=true;r=await call('/orders',q);assert.equal(r.code,404);foreign=false;
who={role:'custom',rights:[],allowed:true};r=await call('/orders',q);assert.equal(r.code,403);
who={role:'viewer',allowed:true,hideMoney:true};r=await call('/orders',q);assert.equal(r.code,403);
who={role:'custom',allowed:true,rights:{apps:['couriersync'],money:{logistics:false}}};r=await call('/orders',q);assert.equal(r.code,403);
assert.equal(sessions,closed);
console.log('Daewoo app: encrypted-extra credential contract, private sessions, scoped reports, transactional sync wiring, stored-source read and no automatic posting PASS; synthetic only.');
