import { Router } from 'express';
import { openDaewooPortal } from './daewoo.js';
import { validateRange } from './daewoo-portal.js';
import { prepareDaewooLock } from './daewoo-locks.js';
import { bankingAccess } from './banking-access.js';

export function createDaewooBankingRouter({requireBanking,requireCompany,listAccounts,getAccount,credsOf,store,listLinks,openPortal=openDaewooPortal}){
  const router=Router();
  const wrap=work=>async(req,res)=>{
    const who=await requireBanking(req,res);if(!who)return;
    const realm=await requireCompany(req,res);if(!realm)return;
    res.set('Cache-Control','no-store');
    try{await work(req,res,realm,who);}catch(error){
      const code=error.code||(/^(?:Daewoo settlement: |Daewoo: )([A-Z_]+)$/.exec(error.message)||[])[1]||error.message;
      res.status(400).json({error:/^[A-Z_]{3,60}$/.test(code)?code:'MATCHING_REQUEST_FAILED'});
    }
  };
  async function accountFor(realm,input){
    if(!/^\d+$/.test(String(input.account||'')))throw new Error('ACCOUNT_REQUIRED');
    const account=await getAccount(realm,Number(input.account));
    if(!account||account.courier!=='daewoo'||account.active===false)throw new Error('DAEWOO_ACCOUNT_NOT_FOUND');
    return account;
  }
  async function sources(realm,input,work){
    validateRange(input.from,input.to);const account=await accountFor(realm,input);
    const {client,customerId}=await openPortal(account.token,credsOf(account));
    try{
      const covers=await client.covers(input.from,input.to,customerId);
      return await work({realmId:realm,accountId:String(account.id),customerId},covers);
    }finally{client.close();}
  }
  router.get('/accounts',wrap(async(_req,res,realm,who)=>{
    const accounts=(await listAccounts(realm)).filter(a=>a.courier==='daewoo'&&a.active!==false).map(a=>({id:a.id,label:a.label}));
    res.json({accounts,canWrite:bankingAccess(who).write});
  }));
  router.get('/locks',wrap(async(req,res,realm)=>{
    const account=await accountFor(realm,req.query);
    res.json({locks:await store.list(realm,account.id),links:await listLinks(realm,account.id)});
  }));
  router.get('/sources',wrap(async(req,res,realm)=>{
    const rows=await sources(realm,req.query,async(_scope,covers)=>covers);
    res.json({covers:rows});
  }));
  router.post('/preview',wrap(async(req,res,realm)=>{
    const preview=await sources(realm,req.body,async(scope,covers)=>prepareDaewooLock(scope,covers,req.body,(await store.list(realm,scope.accountId)).filter(lock=>lock.state!=='reversed')));
    res.json({preview});
  }));
  router.post('/lock',wrap(async(req,res,realm,who)=>{
    const lock=await sources(realm,req.body,async(scope,covers)=>store.lock(scope,covers,req.body,who.actor));
    res.json({lock});
  }));
  router.post('/confirm',wrap(async(req,res,realm,who)=>{
    const account=await accountFor(realm,req.body);
    const links=await listLinks(realm,account.id);
    if(!links.some(l=>l.from<=req.body.on))throw new Error('BANK_LINK_REQUIRED_FOR_PAYMENT_DATE');
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});
    const lock=await store.transition(realm,account.id,req.body.id,'bank-receipt',req.body,who.actor,today);
    res.json({lock});
  }));
  router.post('/reverse',wrap(async(req,res,realm,who)=>{
    const account=await accountFor(realm,req.body);
    res.json({lock:await store.transition(realm,account.id,req.body.id,'reverse',req.body,who.actor)});
  }));
  return router;
}
