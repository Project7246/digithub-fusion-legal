import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDaewooLockStore } from '../daewoo-lock-store.js';
const rows=[],audits=[],published=[],queries=[];let backup,realm,failPublish=false;
const c={release(){},async query(sql,args=[]){
  queries.push(sql);
  if(sql==='BEGIN'){backup=structuredClone({rows,audits,published});return {rows:[]};}
  if(sql==='ROLLBACK'){rows.splice(0,rows.length,...backup.rows);audits.splice(0,audits.length,...backup.audits);published.splice(0,published.length,...backup.published);return {rows:[]};}
  if(sql==='COMMIT')return {rows:[]};
  if(sql.includes('set_config')){realm=args[0];return {rows:[]};}
  if(sql.includes('pg_advisory'))return {rows:[]};
  assert.ok(realm,'RLS context must be set before reading/writing');
  if(sql.startsWith('SELECT *'))return {rows:rows.filter(r=>r.realm_id===args[0]&&String(r.account_id)===String(args[1])&&(!sql.includes('id=$3')||String(r.id)===String(args[2]))).map(r=>structuredClone(r))};
  if(sql.startsWith('INSERT INTO daewoo_settlements')){
    assert.equal(args[0],realm);const row={id:rows.length+1,realm_id:realm,account_id:args[1],customer_id:args[2],payment_ref:args[3],state:'locked',snapshot:JSON.parse(args[4]),created_by:args[5],created_at:'2026-01-01T00:00:00Z'};
    rows.push(row);return {rows:[structuredClone(row)]};
  }
  if(sql.startsWith('INSERT INTO daewoo_settlement_audit')){assert.equal(args[0],realm);audits.push(args);return {rows:[]};}
  if(sql.startsWith('UPDATE')){assert.ok(sql.includes('realm_id=$1 AND account_id=$2 AND id=$3'));const row=rows.find(r=>r.realm_id===realm&&String(r.account_id)===String(args[1])&&String(r.id)===String(args[2]));row.state=args[3];row.bank_receipt=args[4]?JSON.parse(args[4]):null;return {rows:[structuredClone(row)]};}
  throw new Error('Unexpected fixture query');
}};
const store=createDaewooLockStore({database:{connect:async()=>c},publish:async(r,a,k,covers,transaction)=>{
  assert.equal(transaction,c);assert.equal(k,'daewoo');if(failPublish)throw new Error('fixture failure');published.push({realm:r,account:a,covers});
}});
const scope={realmId:'realm-a',accountId:'1',customerId:'customer-a'};
const covers=[{invoice_no:'cod-1',TotalCODAmount:'100.00'}];
const input={paymentRef:'ref-1',on:'2026-01-01',expectedNet:'90.00',confirmedSource:true,documents:[
  {ref:'cod-1',kind:'cod',total:'100.00',allocated:'100.00'},
  {ref:'charge-1',kind:'delivery',total:'10.00',allocated:'10.00'}]};
const lock=await store.lock(scope,covers,input,'fixture-actor');assert.equal(lock.state,'locked');assert.equal(published[0].covers[0].netAmount,'90.00');assert.equal(audits[0][3],'lock');
assert.equal((await store.list('realm-b',1)).length,0);
await assert.rejects(store.lock(scope,covers,input,'fixture-actor'),/ALREADY_LOCKED/);
await assert.rejects(store.transition('realm-b',1,lock.id,'bank-receipt',{amount:'90.00',on:'2026-01-02',reference:'bank-ref'},'fixture-actor','2026-01-03'),/LOCK_NOT_FOUND/);
const paid=await store.transition('realm-a',1,lock.id,'bank-receipt',{amount:'90.00',on:'2026-01-02',reference:'bank-ref'},'fixture-actor','2026-01-03');
assert.equal(paid.state,'received');assert.equal(audits.at(-1)[3],'bank-receipt');assert.equal(published.at(-1).covers[0].status,'paid');
await assert.rejects(store.transition('realm-a',1,lock.id,'bank-receipt',{},'fixture-actor','2026-01-03'),/ALREADY_FINAL/);
const reversed=await store.transition('realm-a',1,lock.id,'reverse',{reason:'Fixture correction'},'fixture-actor');
assert.equal(reversed.state,'reversed');assert.equal(published.at(-1).covers[0].status,'cancelled');assert.equal(rows[0].snapshot.net,'90.00','original locked figures never edited');
failPublish=true;await assert.rejects(store.lock(scope,covers,{...input,paymentRef:'ref-2'},'fixture-actor'),/fixture failure/);
assert.equal(rows.length,1,'lock insert rolls back if publishing the Banking cover fails');
assert.ok(queries.some(q=>q.includes('pg_advisory_xact_lock')));
const schema=readFileSync('migrations/006_daewoo_settlements.sql','utf8');
assert.equal((schema.match(/FORCE ROW LEVEL SECURITY/g)||[]).length,2);
assert.ok(schema.includes("current_setting('app.realm_id',true)"));
console.log('Daewoo lock store: realm isolation, RLS context, serialization, immutable amounts, audit, reversal and atomic cover rollback PASS; fake database only.');
