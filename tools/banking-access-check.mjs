// Synthetic grants only; no production accounts, money entries or DB queries.
import assert from 'node:assert/strict';
import { bankingAccess, createBankingGuard, recordBankingAccess } from '../banking-access.js';
import { mayApp, read, write, readableApps } from '../access.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pool } from '../db.js';
import { setUserAccess, setUserMoney } from '../users.js';
import { createMemberAccount } from '../accounts.js';

const cases = [
  [{ admin:true, role:'admin' }, true, true],
  [{ role:'standard' }, true, true],
  [{ role:'viewer' }, true, false],
  [{ role:'custom', rights:['bankingreports'] }, true, false],
  [{ role:'custom', rights:['banking'] }, true, true],
  [{ role:'custom', rights:write(['bankingreports'], { banking:true }) }, true, false],
  [{ role:'custom', rights:write(['banking'], { banking:false }) }, false, false],
  [{ role:'custom', rights:['books'] }, false, false],
  [{ role:'viewer', hideMoney:true }, false, false],
  [{ role:'none' }, false, false],
  [{ role:'standard', allowed:false }, false, false],
  [{ admin:true, role:'admin', disabled:true }, false, false]
];
for(const [who, canRead, canWrite] of cases) {
  assert.deepEqual(bankingAccess(who), { read:canRead, write:canWrite });
}
assert.ok(mayApp({ role:'custom', rights:['banking'] }, 'bankingreports'));
assert.equal(mayApp({ role:'viewer' }, 'banking'), false);
assert.ok(readableApps({ role:'viewer' }, [{key:'books'}, {key:'bankingreports'}]).includes('books'));
assert.ok(readableApps({ role:'custom', rights:['banking'] }, [{key:'bankingreports'}]).includes('bankingreports'));

for(const [method, who, expected] of [
  ['GET',{role:'viewer'},200], ['POST',{role:'viewer'},403],
  ['GET',{role:'custom',rights:['books']},403],
  ['POST',{role:'custom',rights:['banking']},200],
  ['GET',null,401], ['POST',{role:'standard',disabled:true},403]
]) {
  const guard = createBankingGuard({ currentUser: req => req.sessionSub,
    whoIs:async () => who });
  const response = { code:200, status(code){this.code=code;return this;}, json(body){this.body=body;return this;} };
  const result = await guard({ method, sessionSub:who ? 'id:fixture' : null },response);
  assert.equal(response.code,expected);
  assert.equal(!!result,expected===200);
}

const auditCalls=[];
await recordBankingAccess({ query:async(sql,args)=>{auditCalls.push({sql,args});return {rows:[]};} }, {
  actor:'id:fixture-admin', sub:'id:fixture-reader', realms:['fixture-a','fixture-b'],
  before:{ role:'custom',rights:[] },after:{role:'custom',rights:['bankingreports']}
});
assert.equal(auditCalls.filter(row=>row.sql.includes('INSERT INTO banking_entry_audit')).length,2);
for(const row of auditCalls.filter(row=>row.sql.includes('INSERT INTO banking_entry_audit'))){
  const value=JSON.parse(row.args[3]);
  assert.equal(value.sub,'id:fixture-reader');
  assert.equal(value.before.read,false);assert.equal(value.after.read,true);
  assert.equal(value.after.write,false);
}
const server=readFileSync('server.js','utf8');
const bankBlock=server.slice(server.indexOf('// ==================== banking ===================='),server.indexOf('// ==================== rates:'));
assert.doesNotMatch(bankBlock,/requireBoss/,'no residual super-admin-only Banking guards');
for (const source of [bankBlock,readFileSync('banking-router.js','utf8')]) {
  const routes=[...source.matchAll(/(?:app|router)\.(get|post)\('[^']+'[^]*?(?=\n\s*(?:app|router)\.|$)/g)];
  assert.ok(routes.length);
  for(const [body] of routes){
    assert.match(body,/requireBanking\(req,\s*res\)/,'all Banking routes require the grant');
    assert.match(body,/requireCompany\(req,\s*res\)/,'all Banking routes keep the company boundary');
  }
}
assert.match(server, /key: 'bankingreports', module: 'banking'/);
assert.match(server, /key: 'banking', module: 'banking'/);
assert.match(server, /'\/banking.html': 'bankingreports'/);
assert.doesNotMatch(readFileSync('public/index.html','utf8'),/Being built/);

// The same tile filter is used by section pages and the main launcher.
const ui={window:{APP:{canOpen:key=>key==='bankingreports',may:()=>false}},document:{}};
vm.runInNewContext(readFileSync('public/tiles.js','utf8'),ui);
const section={groups:[{items:[{href:'/banking',need:'bankingreports',label:'Banking'}]}],soon:[{label:'Future'}]};
assert.equal(ui.window.FUSION.availableTiles(section).length,1);
assert.equal(ui.window.FUSION.tilesOf(section).length,1,'future placeholders are absent');
ui.window.APP.canOpen=()=>false;
assert.equal(ui.window.FUSION.availableTiles(section).length,0,'no unauthorized module card');

// No connection is opened: replace the pool with a synthetic transaction client.
const originalConnect=pool.connect;
try {
  let calls=[],failAudit=false;
  const before={sub:'id:fixture',allowed:true,role:'custom',rights:[],home_realm:'fixture-a'};
  const after={...before,rights:['bankingreports']};
  pool.connect=async()=>({release(){calls.push({sql:'RELEASE'});},async query(sql,args){
    calls.push({sql,args});
    if(sql.includes('INSERT INTO banking_entry_audit') && failAudit)throw Error('fixture audit failure');
    if(sql.includes('FOR UPDATE'))return {rows:[before]};
    if(sql.includes('UPDATE users'))return {rows:[after]};
    if(sql.includes('INSERT INTO users'))return {rows:[after]};
    if(sql.includes('FROM user_companies'))return {rows:[{realm_id:'fixture-a'}]};
    return {rows:[]};
  }});
  await setUserAccess(before.sub,{rights:after.rights},{actor:'id:fixture-admin'});
  assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO banking_entry_audit')).length,1);
  assert.ok(calls.findIndex(c=>c.sql.includes('INSERT INTO banking_entry_audit'))<calls.findIndex(c=>c.sql==='COMMIT'));
  calls=[];failAudit=true;
  await assert.rejects(setUserAccess(before.sub,{rights:after.rights},{actor:'id:fixture-admin'}),/fixture audit failure/);
  assert.ok(calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!calls.some(c=>c.sql==='COMMIT'));
  calls=[];failAudit=false;
  await createMemberAccount({loginId:'fixture',password:'fixture-password',realmId:'fixture-a',madeBy:'id:fixture-admin',role:'viewer'});
  assert.ok(calls.some(c=>c.sql.includes('INSERT INTO banking_entry_audit')),'initial Banking grants are audited');
  calls=[];
  await setUserMoney(before.sub,true,{actor:'id:fixture-admin'});
  assert.ok(calls.some(c=>c.sql.includes('hide_money = COALESCE')));
} finally { pool.connect=originalConnect; }
console.log('Banking access: reports/full separation, aliases/v2 grants, money privacy, API guards and scoped audit PASS');
