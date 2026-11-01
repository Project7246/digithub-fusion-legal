// Synthetic clocks/dependencies only: no production database or courier contact.
import assert from 'node:assert/strict';
import { scheduleSlot, runArchiveSlot, claimArchiveSlot } from '../banking-schedule.js';
import { pool } from '../db.js';
const at=s=>new Date(s);
assert.equal(scheduleSlot(at('2026-11-02T09:59:59Z')).due,'2026-11-01T17:00:00.000Z');
assert.equal(scheduleSlot(at('2026-11-02T10:00:00Z')).due,'2026-11-02T10:00:00.000Z');
assert.equal(scheduleSlot(at('2026-11-02T10:00:00Z')).next,'2026-11-02T17:00:00.000Z');
assert.equal(scheduleSlot(at('2026-11-02T17:00:00Z')).next,'2026-11-03T10:00:00.000Z');
assert.equal(scheduleSlot(at('2026-12-31T23:30:00Z')).next,'2027-01-01T10:00:00.000Z');
let seen=[],claimed=new Set(),pending=Array.from({length:25},(_,i)=>({account_id:1,cpr_number:String(i)}));
const deps={now:()=>0,allowed:()=>true,realms:async()=>['A','B'],company:async()=>true,
 claim:async(r,s)=>{const k=r+s;if(claimed.has(k))return false;claimed.add(k);return true;},
 covers:async r=>{seen.push('covers:'+r);return [];},retain:async()=>{},
 candidates:async()=>pending.splice(0,2),detail:async(r,a,c)=>{seen.push('detail:'+r);if(c==='0')throw Error('offline');},
 defer:async()=>seen.push('defer'),finish:async(r,s,v)=>seen.push(v),begin:()=>null,end:()=>{}};
await runArchiveSlot('slot',deps);
assert.ok(seen.includes('covers:A')&&seen.includes('covers:B'),'runs without browser/session');
assert.equal(seen.filter(x=>x==='detail:A').length,20,'bounded per-company detail work');
assert.ok(seen.some(x=>x?.errors===1),'provider failure is isolated and counted');
let count=seen.length;await runArchiveSlot('slot',deps);assert.equal(seen.length,count,'completed slot is not replayed');
seen=[];await runArchiveSlot('held',{...deps,allowed:()=>false});assert.equal(seen.length,0,'budget hold does not wake DB');
seen=[];await runArchiveSlot('deleted',{...deps,realms:async()=>['X'],company:async()=>false});assert.equal(seen.length,0);
const oldConnect=pool.connect;let sqls=[],previous=null,fail=false;
pool.connect=async()=>({release(){},async query(sql,args){sqls.push(sql);
  if(sql.includes('SELECT new_value')){assert.equal(args[0],'fixture');return {rows:previous?[previous]:[]};}
  if(sql.includes('INSERT INTO banking_entry_audit')&&fail)throw Error('audit failed');return {rows:[]};}});
try{
  assert.equal(await claimArchiveSlot('fixture','slot'),true);assert.equal(sqls.at(-1),'COMMIT');
  assert.ok(sqls.some(s=>s.includes('pg_advisory_xact_lock')));
  previous={new_value:{state:'finished'},created_at:new Date(0)};
  assert.equal(await claimArchiveSlot('fixture','slot'),false,'finished survives process restart');
  previous={new_value:{state:'started'},created_at:new Date()};
  assert.equal(await claimArchiveSlot('fixture','slot'),false,'another server cannot claim a live lease');
  previous={new_value:{state:'started'},created_at:new Date(0)};
  assert.equal(await claimArchiveSlot('fixture','slot'),true,'crashed stale run can catch up');
  previous=null;fail=true;await assert.rejects(claimArchiveSlot('fixture','slot'),/audit failed/);
  assert.equal(sqls.at(-1),'ROLLBACK');
}finally{pool.connect=oldConnect;}
console.log('Banking schedule checks passed: Pakistan 15:00/22:00, midnight/year rollover, browser-independent catch-up, duplicate guard, bounded work, failure isolation and budget hold.');
