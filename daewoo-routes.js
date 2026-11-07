import { Router } from 'express';
import { readableApps, seesMoney } from './access.js';
import { validateRange } from './daewoo-portal.js';
import { openDaewooPortal } from './daewoo.js';
import { groupFor } from './adapters.js';
import { createHash } from 'node:crypto';
import { createDaewooReportCache } from './daewoo-report-range.js';
import { saveDaewooBundle, readDaewooBundle } from './daewoo-store.js';
import { syncDaewooAccount } from './daewoo-sync.js';

export function createDaewooRouter({requireCompany,getWho,listAccounts,getAccount,credsOf,openPortal=openDaewooPortal,listSettlements=async()=>null,markSynced=async()=>{},saveBundle=saveDaewooBundle,readBundle=readDaewooBundle}){
  const router=Router();
  const cachedReport=createDaewooReportCache();
  const wrap=work=>async(req,res)=>{
    const realm=await requireCompany(req,res);if(!realm)return;
    const who=await getWho(req);
    if(!readableApps(who,[{key:'couriersync',money:true}]).length||!seesMoney(who,'logistics'))return res.status(403).json({error:'Courier report access required.'});
    res.set('Cache-Control','no-store');
    try{await work(req,res,realm);}catch(error){
      const safe=['DATE_RANGE','CUSTOMER_SELECTION_REQUIRED','AUTH_REJECTED','SESSION_EXPIRED','ACCESS_REJECTED','RESPONSE_TOO_LARGE','REPORT_RANGE_TOO_LARGE','SINGLE_DAY_REPORT_TOO_LARGE','INVOICE_SCOPE_MISMATCH','CUSTOMER_SCOPE_MISMATCH','INVOICE_SYNC_LIMIT'];
      const code=safe.find(c=>error.code===c||error.message==='Daewoo: '+c);
      res.status(400).json({error:'Daewoo: '+(code||'REPORT_READ_FAILED')});
    }
  };
  router.get('/accounts',wrap(async(_req,res,realm)=>{
    const rows=await listAccounts(realm);
    res.json({accounts:rows.filter(a=>a.courier==='daewoo'&&a.active!==false).map(a=>({id:a.id,label:a.label}))});
  }));
  router.post('/sync',wrap(async(req,res,realm)=>{
    const {account,from,to}=req.body||{};validateRange(from,to);
    if(!/^\d+$/.test(String(account||''))||Number(account)<1)return res.status(400).json({error:'Select a Daewoo account.'});
    const row=await getAccount(realm,Number(account));
    if(!row||row.courier!=='daewoo'||row.active===false)return res.status(404).json({error:'Daewoo account not found.'});
    const saved=await syncDaewooAccount({realmId:realm,account:row,from,to,credsOf,openPortal,saveBundle});
    await markSynced(realm,row.id,null);
    res.json({ok:true,orders:saved.orders,documents:saved.documents,from,to,
      note:'Source invoices are stored separately; only a confirmed bank receipt counts as money received.'});
  }));
  router.get('/stored',wrap(async(req,res,realm)=>{
    validateRange(req.query.from,req.query.to);
    if(!/^\d+$/.test(String(req.query.account||''))||Number(req.query.account)<1)return res.status(400).json({error:'Select a Daewoo account.'});
    const row=await getAccount(realm,Number(req.query.account));
    if(!row||row.courier!=='daewoo'||row.active===false)return res.status(404).json({error:'Daewoo account not found.'});
    res.json(await readBundle({realmId:realm,accountId:row.id,from:req.query.from,to:req.query.to}));
  }));
  const read=kind=>wrap(async(req,res,realm)=>{
    const q=req.query;
    validateRange(q.from,q.to);
    if(!/^\d+$/.test(String(q.account||''))||Number(q.account)<1)return res.status(400).json({error:'Select a Daewoo account.'});
    const account=await getAccount(realm,Number(q.account));
    if(!account||account.courier!=='daewoo'||account.active===false)return res.status(404).json({error:'Daewoo account not found.'});
    if(kind==='dashboard'){
      const credentials=credsOf(account);
      const fingerprint=createHash('sha256').update(JSON.stringify([account.token,credentials])).digest('hex');
      const key=JSON.stringify([realm,account.id,q.from,q.to,fingerprint]);
      const report=await cachedReport(key,async()=>{
        const {client,customerId}=await openPortal(account.token,credentials);
        try{
        const orders=(await client.financialRows(q.from,q.to,customerId)).map(row=>({...row,fusionStatusGroup:groupFor('daewoo',row.status)}));
        const covers=await client.covers(q.from,q.to,customerId);
          return {orders,covers,customerId,readAt:new Date().toISOString()};
        }finally{client.close();}
      },{refresh:q.refresh==='1'});
      // Settlements remain fresh, even when the read-only portal data is cached.
      const locks=await listSettlements(realm,account.id);
      const settlements=locks===null?null:locks.filter(l=>l.scope.customerId===report.customerId).map(l=>({id:l.id,paymentRef:l.paymentRef,state:l.state,net:l.net,gross:l.gross,deductions:l.deductions,on:l.on,paidOn:l.bankReceipt?.on||null}));
      const {customerId:_,...publicReport}=report;
      return res.json({...publicReport,settlements,postingAllowed:false,source:'Daewoo portal',account:{id:account.id,label:account.label}});
    }
    const {client,customerId}=await openPortal(account.token,credsOf(account));
    try{
      let rows;
      if(kind==='orders')rows=await client.financialRows(q.from,q.to,customerId);
      else{
        rows=await client.covers(q.from,q.to,customerId);
        if(kind==='detail'){
          if(!rows.some(r=>String(r.invoice_no)===String(q.invoice)))return res.status(404).json({error:'Invoice not found in this account and period.'});
          rows=await client.detail(q.invoice,customerId);
        }
      }
      // Source reports only. No writes to parcel-net storage, Banking or QuickBooks.
      res.json({rows,postingAllowed:false,source:kind==='orders'?'Financial Summary':'COD Invoice Summary',
        note:'COD invoices, service/tax invoices and actual payments are separate. Payment allocation is not verified.'});
    }finally{client.close();}
  });
  router.get('/orders',read('orders'));
  router.get('/invoices',read('invoices'));
  router.get('/detail',read('detail'));
  router.get('/dashboard',read('dashboard'));
  return router;
}
