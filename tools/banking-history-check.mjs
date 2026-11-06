// Synthetic fixtures only; no production database is contacted.
import assert from 'node:assert/strict';
import { columnBreakdown, paymentWorkbook, correctTransaction, removeFiscalSetup, moveFiscalSetup, historyTransactions, fiscalHistory, historyWorkbook } from '../banking-history.js';
import { pool } from '../db.js';
import express from 'express';
import { createBankingRouter } from '../banking-router.js';
import XLSX from 'xlsx';
const logBook=XLSX.read(historyWorkbook({transactions:[{id:1,type:'in',entries:[{bankId:1,on:'2026-10-12',amount:'25.00',note:'Sample'}]}]},'entry',[{id:1,name:'Sample Bank'}]),{type:'buffer'});
const logValues=XLSX.utils.sheet_to_json(logBook.Sheets['Banking log'],{header:1});
assert.equal(logValues[1][3],'Sample Bank');assert.equal(logValues[1][5],25);
const fiscalRows=[{id:2,bank_id:1,fiscal_year:2027,opening_in:'0.00',opening_out:'0.00',previous_id:1,in_day:'2026-10-13',out_day:'2026-10-13'},
  {id:1,bank_id:1,fiscal_year:2027,opening_in:'58055.43',opening_out:'0.00',in_day:'2026-10-13',out_day:'2026-10-13'}];
assert.equal(fiscalHistory(fiscalRows,[]).length,0,'legacy cleared opening and superseded original both disappear');
assert.equal(fiscalHistory(fiscalRows,[{action:'save-setup',new_value:[{setupId:2}]}]).length,2,'explicit edit to zero retains change history');
assert.equal(fiscalHistory(fiscalRows,[{action:'remove-setup',new_value:[{setupId:1,clearedSetupId:2}]}]).length,0);
const movedHistory=fiscalHistory(fiscalRows,[{action:'save-setup',new_value:[{setupId:2}]},
  {action:'move-setup',new_value:[{clearedSetupId:2}]}]);
assert.equal(movedHistory.length,0,'moved-away source chain disappears from visible history');
assert.equal(fiscalHistory([{...fiscalRows[0],opening_in:'25.00'},fiscalRows[1]],[]).length,2,'edit history remains for active amounts');
const entry=(id,time)=>({id,action:'in',actor:'owner',transaction_time:time,new_value:[{id,bankId:1,amount:'10.00'}]});
const legacyAudits=[entry(1,'one'),entry(2,'two'),entry(3,'three'),entry(4,'four'),
  ...[1,2,3].map(id=>({id:10+id,action:'reverse:'+id,actor:'owner',transaction_time:'delete-'+id,new_value:[{id:20+id}]})),
  {id:14,action:'reverse:4',actor:'owner',transaction_time:'edit-exact-microseconds',new_value:[{id:24}]},
  entry(15,'edit-exact-microseconds')];
const visible=historyTransactions(legacyAudits,[]);
assert.deepEqual(visible.map(t=>t.id),[4,15],'three earlier removals disappear, earlier edit and its replacement remain');
assert.equal(visible[0].reversed,true);
const removedChain=[...legacyAudits,{id:16,action:'reverse:15',transaction_time:'later-delete',actor:'owner',
  new_value:[{id:26,operation:'remove'}]}];
assert.equal(historyTransactions(removedChain,[]).length,0,
  'removing the latest edited version also hides every earlier Updated version');
assert.equal(historyTransactions([entry(1,'one'),{id:2,action:'reverse:1',new_value:[{operation:'remove'}]}],[]).length,0);
assert.equal(historyTransactions([entry(1,'one'),{id:2,action:'reverse:1',new_value:[{operation:'edit'}]}],[]).length,1);
const report={year:{year:2027,from:'2026-07-01',to:'2027-06-30'},banks:[{id:1,opening:'100.00',openingOn:'2026-10-20',
  openingIn:'500.00',openingOut:'400.00',fiscalYear:2027,inYear:'550.00',outYear:'420.00'}],moves:[
  {bankId:1,on:'2026-10-21',amount:'50.00',source:'hand',note:'Deposit'},
  {bankId:1,on:'2026-10-21',amount:'-20.00',source:'sheet',note:'Expense'},
  {bankId:1,on:'2026-10-21',amount:'-500.00',source:'courier',affectsBalance:false}]};
assert.equal(columnBreakdown(report,1,'inYear').rows.length,2);
assert.equal(columnBreakdown(report,1,'outYear').total,'420.00');
assert.equal(columnBreakdown(report,1,'outYear').rows.length,2,'negative CPR never becomes Out');
assert.equal(columnBreakdown(report,1,'opening').rows[0].amount,'100.00');
report.banks[0].balanceIncomplete=true;report.banks[0].incomeIncomplete=false;
assert.equal(columnBreakdown(report,1,'inYear').total,'550.00','Year In drilldown remains available when only Out is unknown');
delete report.banks[0].balanceIncomplete;delete report.banks[0].incomeIncomplete;
const wb=XLSX.read(paymentWorkbook([{on:'2026-10-21',amount:'-20.00',details:Array.from({length:16},(_,i)=>({value:
  i===2?'Receiver':i===6?'Sender':i===13?'Expense head':i===15?'Combined remarks':''})),rowUrl:'https://example.invalid/row'}]),{type:'buffer'});
const rows=XLSX.utils.sheet_to_json(wb.Sheets.Payments,{header:1});
assert.equal(rows[1][2],'Receiver');assert.equal(rows[1][3],20);assert.equal(rows.at(-1)[3],20);
assert.ok(rows[1].includes('Combined remarks'));
const originalConnect=pool.connect;
const movedSourceRows=[{id:4,previous_id:3,bank_id:1,fiscal_year:2027,opening_in:'0',opening_out:'0'},
 {id:3,bank_id:1,fiscal_year:2027,opening_in:'100',opening_out:'20'}];
assert.equal(fiscalHistory(movedSourceRows,[{action:'move-setup',new_value:[{clearedSetupId:4,sourceSetupId:3}]}]).length,0,
 'moving a fiscal opening hides the cleared original chain, including superseded rows');
let calls=[],already=false,failAudit=false,stale=false,missing=false,targetOccupied=false;
let server;
pool.connect=async()=>({release(){},async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes('SELECT id,action,new_value'))return {rows:missing?[]:[{id:7,action:'transfer',new_value:[{id:1},{id:2}]}]};
  if(sql.includes('SELECT id FROM banking_entry_audit'))return {rows:already?[{id:9}]:[]};
  if(sql.includes('FROM bank_moves'))return {rows:[{id:1,bank_id:1,on:'2026-10-21',amount:'-100.00',kind:'transfer',other_bank_id:2},
    {id:2,bank_id:2,on:'2026-10-21',amount:'100.00',kind:'transfer',other_bank_id:1}]};
  if(sql.includes('SELECT *,to_char'))return {rows:[{id:5,bank_id:1,fiscal_year:2027,in_day:'2026-10-20',out_day:'2026-10-20'}]};
  if(sql.includes('SELECT id FROM banking_setups'))return {rows:[{id:stale?6:5}]};
  if(sql.includes('SELECT id,opening_in,opening_out'))return {rows:targetOccupied?[{id:8,opening_in:'10.00',opening_out:'0.00'}]:[]};
  if(sql.includes('FROM banks'))return {rows:(Array.isArray(args[1])?args[1]:[args[1]]).map(id=>({id}))};
  if(sql.includes('INSERT INTO banking_entry_audit')&&failAudit)throw Error('synthetic audit failure');
  return {rows:[{id:100+calls.length}]};
}});
try {
  await correctTransaction('fixture',7,{type:'transfer',fromBank:1,toBank:3,on:'2026-10-22',amount:'80.00',note:'Corrected bank'},'owner');
  const inserts=calls.filter(c=>c.sql.includes('INSERT INTO bank_moves'));
  assert.deepEqual(inserts.map(c=>c.args[3]),['100.00','-100.00','-80.00','80.00']);
  assert.equal(calls.filter(c=>c.sql==='BEGIN').length,1,'one transaction covers both-bank reversal and replacement');
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert.ok(calls.some(c=>c.args[2]==='reverse:7'));
  assert.equal(JSON.parse(calls.find(c=>c.args[2]==='reverse:7').args[3])[0].operation,'edit');
  assert.doesNotMatch(calls.map(c=>c.sql).join(' '),/\bUPDATE bank_moves|\bDELETE\b/);
  calls=[];already=true;
  await assert.rejects(correctTransaction('fixture',7,null,'owner'),/already reversed/);
  assert.ok(!calls.some(c=>c.sql.includes('INSERT INTO bank_moves')));already=false;
  calls=[];missing=true;
  await assert.rejects(correctTransaction('other-company',7,null,'owner'),/this company/);missing=false;
  calls=[];failAudit=true;
  await assert.rejects(correctTransaction('fixture',7,null,'owner'),/audit failure/);
  assert.equal(calls.at(-1).sql,'ROLLBACK');failAudit=false;
  calls=[];await removeFiscalSetup('fixture',5,'owner');
  assert.deepEqual(calls.find(c=>c.sql.includes('INSERT INTO banking_setups')).args.slice(3,5),['0.00','0.00']);
  calls=[];stale=true;
  await assert.rejects(removeFiscalSetup('fixture',5,'owner'),/changed/);
  assert.equal(calls.at(-1).sql,'ROLLBACK');
  stale=false;calls=[];
  const moved={sourceBankId:1,bankId:2,fiscalYear:2027,expectedId:5,openingIn:'25.00',openingOut:'5.00',inFrom:'2026-10-20',outFrom:'2026-10-20'};
  await moveFiscalSetup('fixture',moved,'owner');
  const setupWrites=calls.filter(c=>c.sql.includes('INSERT INTO banking_setups'));
  assert.equal(setupWrites.length,2);
  assert.deepEqual(setupWrites[0].args.slice(1,5),[1,2027,'0.00','0.00']);
  assert.deepEqual(setupWrites[1].args.slice(1,5),[2,2027,'25.00','5.00']);
  assert.equal(calls.filter(c=>c.sql==='BEGIN').length,1);assert.equal(calls.at(-1).sql,'COMMIT');
  assert.ok(calls.some(c=>c.args[2]==='move-setup'));
  calls=[];targetOccupied=true;
  await assert.rejects(moveFiscalSetup('fixture',moved,'owner'),/already has fiscal amounts/);
  assert.ok(!calls.some(c=>c.sql.includes('INSERT INTO banking_setups')));targetOccupied=false;
  calls=[];failAudit=true;
  await assert.rejects(moveFiscalSetup('fixture',moved,'owner'),/audit failure/);
  assert.equal(calls.at(-1).sql,'ROLLBACK');failAudit=false;calls=[];
  const app=express();app.use(express.json());
  app.use('/api/bank',createBankingRouter({requireBanking:async()=>({email:'owner'}),requireCompany:async()=> 'fixture'}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url='http://127.0.0.1:'+server.address().port+'/api/bank/save';
  const request={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:1,name:'Fixture Bank',opening:'100.00',openingOn:'2026-10-20'})};
  assert.equal((await fetch(url,request)).status,200);
  assert.ok(calls.some(c=>c.args[2]==='bank-opening'));
  assert.equal(calls.at(-1).sql,'COMMIT');
  calls=[];failAudit=true;
  assert.equal((await fetch(url,request)).status,400);
  assert.equal(calls.at(-1).sql,'ROLLBACK','bank opening cannot change without its old/new audit');
}finally{pool.connect=originalConnect;if(server)await new Promise(resolve=>server.close(resolve));}
console.log('Banking history checks passed: opening and fiscal drilldowns reconcile, negative CPR excluded, payment export preserves details and total.');
