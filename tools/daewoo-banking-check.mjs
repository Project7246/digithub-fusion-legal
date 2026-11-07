import assert from 'node:assert/strict';
import { createDaewooBankingRouter } from '../daewoo-banking-router.js';
import { bankingAccess } from '../banking-access.js';
let who={role:'admin',allowed:true},foreign=false,opened=0,closed=0,writes=0,history=[];
const router=createDaewooBankingRouter({
  requireBanking:async(req,res)=>{const access=bankingAccess(who);if(!access[req.method==='GET'?'read':'write']){res.status(403).json({error:'denied'});return null;}return {...who,actor:'fixture-actor'};},
  requireCompany:async()=> 'realm-a',
  listAccounts:async()=>[{id:1,label:'Fixture',courier:'daewoo',token:'PRIVATE'},{id:2,courier:'postex'}],
  getAccount:async(realm,id)=>{assert.equal(realm,'realm-a');return foreign?null:{id,courier:'daewoo',token:'fixture-user'};},
  credsOf:()=>({portalPassword:'fixture-private'}),
  openPortal:async()=>{opened++;return {customerId:'001',client:{covers:async()=>[{invoice_no:'cod-1',TotalCODAmount:'100.00'}],close(){closed++;}}};},
  listLinks:async()=>[{from:'2026-01-01',bankId:1}],
  store:{list:async()=>history,lock:async(scope,_covers,_input,actor)=>{assert.equal(scope.realmId,'realm-a');assert.equal(actor,'fixture-actor');writes++;return {state:'locked'};},
    transition:async(realm,account,_id,action)=>{assert.equal(realm,'realm-a');assert.equal(account,1);writes++;return {state:action};}}
});
async function call(path,method='GET',input={}){
  const res={code:200,status(n){this.code=n;return this;},set(){},json(body){this.body=body;}};
  await router.stack.find(l=>l.route?.path===path).route.stack[0].handle({method,query:input,body:input},res);return res;
}
let response=await call('/accounts');assert.equal(response.body.canWrite,true);assert.deepEqual(response.body.accounts,[{id:1,label:'Fixture'}]);
const input={account:1,from:'2026-01-01',to:'2026-01-31',paymentRef:'fixture',on:'2026-01-02',expectedNet:'90.00',confirmedSource:true,
 documents:[{kind:'cod',ref:'cod-1',total:'100.00',allocated:'100.00'},{kind:'delivery',ref:'charge-1',total:'10.00',allocated:'10.00'}]};
response=await call('/preview','POST',input);assert.equal(response.body.preview.net,'90.00');assert.equal(writes,0);
history=[{state:'reversed',documents:null,payment:null}];
response=await call('/preview','POST',input);assert.equal(response.body.preview.net,'90.00');assert.equal(writes,0);history=[];
response=await call('/lock','POST',input);assert.equal(response.body.lock.state,'locked');assert.equal(writes,1);
response=await call('/confirm','POST',{account:1,id:1,on:'2025-01-01'});assert.equal(response.body.error,'BANK_LINK_REQUIRED_FOR_PAYMENT_DATE');assert.equal(writes,1);
foreign=true;response=await call('/sources','GET',input);assert.equal(response.code,400);assert.equal(writes,1);foreign=false;
who={role:'viewer',allowed:true};response=await call('/accounts');assert.equal(response.body.canWrite,false);
response=await call('/lock','POST',input);assert.equal(response.code,403);assert.equal(writes,1);
who={role:'custom',allowed:true,rights:[]};response=await call('/locks','GET',input);assert.equal(response.code,403);
assert.equal(opened,closed);
console.log('Daewoo Banking: independent read/manage permissions, tenant/account scope, preview read-only, bank date link and private session cleanup PASS.');
