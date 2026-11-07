import assert from 'node:assert/strict';
import { createCourierAccountRouter } from '../courier-account-router.js';
let allowed=true,duplicate=false,calls=0;
const router=createCourierAccountRouter({requireAdmin:async(_req,res)=>{if(allowed)return 'fixture-realm';res.status(403).json({error:'denied'});},database:{query:async(sql,args)=>{
  calls++;assert.equal(sql,'UPDATE courier_accounts SET label=$3 WHERE realm_id=$1 AND id=$2 RETURNING id,label');
  assert.equal(args[0],'fixture-realm');if(duplicate)throw Object.assign(new Error('private'),{code:'23505'});
  return {rows:args[1]==='1'?[{id:1,label:args[2]}]:[]};
}}});
async function run(body){const res={status(n){this.code=n;return this;},json(v){this.body=v;}};await router.stack[0].route.stack[0].handle({body},res);return res;}
assert.equal((await run({id:1,label:'  Corrected fixture  '})).body.account.label,'Corrected fixture');
assert.equal((await run({id:2,label:'Foreign fixture'})).code,404);
assert.equal((await run({id:1,label:''})).code,400);assert.equal(calls,2);
duplicate=true;assert.equal((await run({id:1,label:'Duplicate fixture'})).code,409);
allowed=false;assert.equal((await run({id:1,label:'Denied fixture'})).code,403);assert.equal(calls,3);
console.log('Courier account rename: admin-only, realm scoped, label-only update, validation and duplicate protection PASS.');
