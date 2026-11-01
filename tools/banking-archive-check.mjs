// Synthetic SQL and receipt fixtures only. No production DB or portal contact.
import assert from 'node:assert/strict';
import { packDetail, unpackDetail, mergeReceipts, retainCovers, retainDetail, loadDetail, archiveCsv, initBankingArchive } from '../banking-archive.js';
import { pool } from '../db.js';
import { receiptDetail } from '../banking-cprs.js';
const detail={receipt:{accountId:1,cpr:'TEST',courier:'postex',net:'90.00',status:'Processed',password:'must not persist'},
  summary:{gross:'100.00',net:'90.00',charges:'10.00'},orders:[{tracking:'ONE',amount:'100.00',fee:'10.00',token:'must not persist'}],adjustments:[],warning:''};
const packed=packDetail(detail);
assert.equal(unpackDetail(packed.bytes).orders[0].tracking,'ONE');
assert.doesNotMatch(JSON.stringify(unpackDetail(packed.bytes)),/must not persist/);
assert.equal(mergeReceipts([detail.receipt],[])[0].archived,true,'disconnected account retains its Banking receipt');
assert.equal(mergeReceipts([detail.receipt],[{...detail.receipt,net:'95.00'}])[0].net,'95.00','live updates win without duplicating CPR');
assert.equal(mergeReceipts([detail.receipt],[{accountId:1,cpr:'TEST',net:null,status:''}])[0].net,'90.00','missing source data cannot erase retained money');
const oldConnect=pool.connect,oldQuery=pool.query;let calls=[],fail=false;
pool.connect=async()=>({release(){},async query(sql,args=[]){calls.push({sql,args});
  assert.ok(!args.length||args[0]==='fixture'||sql.includes('advisory'));
  if(sql.includes('INSERT INTO banking_receipt_archive'))return {rows:[{account_id:1,cpr_number:'TEST'}]};
  if(sql.includes('SELECT account_id,cpr_number,cover'))return {rows:[]};
  if(sql.includes('banking_entry_audit')&&fail)throw Error('audit failed');
  return {rows:[]};
}});
try{
  await retainCovers('fixture',[detail.receipt]);
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert.ok(calls.some(c=>c.sql.includes('IS DISTINCT FROM')),'unchanged covers are not rewritten');
  calls=[];fail=true;await assert.rejects(retainCovers('fixture',[detail.receipt]),/audit failed/);
  assert.equal(calls.at(-1).sql,'ROLLBACK');fail=false;
  calls=[];await retainDetail('fixture',detail,true);
  assert.ok(calls.some(c=>c.sql.includes('detail_complete')&&c.sql.includes('detail_orders')));
  pool.query=async(sql,args)=>{assert.equal(args[0],'fixture');return {rows:[{detail:packed.bytes,detail_saved_at:'2026-11-02',detail_complete:true}]};};
  assert.equal((await loadDetail('fixture',1,'TEST')).value.summary.net,'90.00');
  pool.query=async(sql,args)=>{assert.equal(args[0],'fixture');return {rows:args[1]===0?[{account_id:1,cpr_number:'TEST',cover:detail.receipt}]:[]};};
  let csv='';for await(const chunk of archiveCsv('fixture'))csv+=chunk;
  assert.match(csv,/accountId,account,courier,cpr,status/);assert.match(csv,/"90.00"/);
  calls=[];await initBankingArchive();
  const migration=calls.find(c=>c.sql.includes('CREATE TABLE banking_receipt_archive'))?.sql;
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);assert.doesNotMatch(migration,/REFERENCES courier_accounts/);
  pool.query=async(sql,args)=>{
    assert.equal(args[0],'fixture');
    if(sql.includes('WITH parcel_dates'))return {rows:[]};
    if(sql.includes('SELECT cover,detail_complete'))return {rows:[{cover:detail.receipt,detail_complete:true}]};
    if(sql.includes('SELECT detail,detail_saved_at'))return {rows:[{detail:packed.bytes,detail_saved_at:'2026-11-02',detail_complete:true}]};
    throw Error('Unexpected offline query: '+sql.slice(0,60));
  };
  const offline=await receiptDetail('fixture',1,'TEST');
  assert.equal(offline.summary.net,'90.00');assert.equal(offline.orders.length,1);
  assert.equal(offline.archive.complete,true,'complete Banking working opens after source account removal without contacting provider');
  console.log('Banking archive checks passed: offline receipt retention, deduplication, sanitized compressed detail, company scope, atomic audit/rollback and saved export data.');
}finally{pool.connect=oldConnect;pool.query=oldQuery;}
