// Stubbed SQL only. Never contacts a real database.
import assert from 'node:assert/strict';
import { pool } from '../db.js';
import { saveBankingSetup, recordBankEntry, initBankingSetup } from '../banking-setup.js';
const old=pool.connect;
let calls=[],fail=false,owned=true;
pool.connect=async()=>({release(){},async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes('FROM banks')) return {rows:owned?(Array.isArray(args[1])?args[1]:[args[1]]).map(id=>({id})):[]};
  if(sql.includes('to_regclass'))return {rows:[{applied:true}]};
  if(sql.includes('INSERT INTO banking_entry_audit')&&fail)throw new Error('synthetic audit failure');
  return {rows:[{id:calls.length}]};
}});
try {
  const setup={bankId:1,fiscalYear:2027,openingIn:'500000.00',openingOut:'400000.00',
    inFrom:'2026-10-20',outFrom:'2026-10-21',sheetReference:'My bank'};
  await saveBankingSetup('fixture',setup,'owner');
  assert.ok(calls.some(c=>c.sql.includes('previous_id')),'append-only setup history references earlier version');
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert.doesNotMatch(calls.map(c=>c.sql).join(' '),/\bUPDATE\s+banking_setups|\bDELETE\b/);
  await assert.rejects(saveBankingSetup('fixture',{...setup,inFrom:'2026-06-30'},'owner'),/fiscal year/);
  await assert.rejects(saveBankingSetup('fixture',{...setup,openingIn:'-1'},'owner'),/non-negative/);
  calls=[];
  await saveBankingSetup('fixture',{...setup,openingBalance:'100.25',openingBalanceOn:'2026-07-01'},'owner');
  assert.deepEqual(calls.find(c=>c.sql.includes('UPDATE banks')).args.slice(2),['100.25','2026-07-01']);
  assert.ok(calls.some(c=>c.args[2]==='bank-opening'));
  assert.equal(calls.at(-1).sql,'COMMIT');
  await assert.rejects(saveBankingSetup('fixture',{...setup,openingBalance:'100.25',openingBalanceOn:''},'owner'),/valid opening balance date/);
  calls=[];
  await recordBankEntry('fixture',{type:'transfer',fromBank:1,toBank:2,on:'2026-10-20',amount:'100.25',note:'Transfer'},'owner');
  const entries=calls.filter(c=>c.sql.includes('INSERT INTO bank_moves'));
  assert.equal(entries.length,2);
  assert.equal(entries[0].args[3],'-100.25');assert.equal(entries[1].args[3],'100.25');
  assert.ok(calls.some(c=>c.sql.includes('banking_entry_audit')));
  assert.equal(calls.at(-1).sql,'COMMIT');
  calls=[];fail=true;
  await assert.rejects(recordBankEntry('fixture',{type:'out',bankId:1,on:'2026-10-20',amount:'1',note:'Expense'},'owner'),/audit failure/);
  assert.equal(calls.at(-1).sql,'ROLLBACK','a money entry cannot commit without its audit');
  fail=false;owned=false;calls=[];
  await assert.rejects(recordBankEntry('other',{type:'in',bankId:1,on:'2026-10-20',amount:'1',note:'Deposit'},'owner'),/this company/);
  assert.ok(!calls.some(c=>c.sql.includes('INSERT INTO bank_moves')));
  calls=[];await initBankingSetup();
  assert.ok(!calls.some(c=>c.sql.includes('CREATE TABLE')),'already applied migration is never rerun');
  console.log('Banking setup checks passed: append-only history, fiscal validation, exact paired transfer, company ownership, atomic audit and rollback, migration once.');
} finally {pool.connect=old;}
