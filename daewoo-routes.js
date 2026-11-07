import { Router } from 'express';
import { readableApps, seesMoney } from './access.js';
import { validateRange } from './daewoo-portal.js';
import { openDaewooPortal } from './daewoo.js';

export function createDaewooRouter({requireCompany,getWho,listAccounts,getAccount,credsOf,openPortal=openDaewooPortal}){
  const router=Router();
  const wrap=work=>async(req,res)=>{
    const realm=await requireCompany(req,res);if(!realm)return;
    const who=await getWho(req);
    if(!readableApps(who,[{key:'couriersync',money:true}]).length||!seesMoney(who,'logistics'))return res.status(403).json({error:'Courier report access required.'});
    res.set('Cache-Control','no-store');
    try{await work(req,res,realm);}catch(error){
      const safe=['DATE_RANGE','CUSTOMER_SELECTION_REQUIRED','AUTH_REJECTED','SESSION_EXPIRED','ACCESS_REJECTED','RESPONSE_TOO_LARGE','INVOICE_SCOPE_MISMATCH','CUSTOMER_SCOPE_MISMATCH'];
      const code=safe.find(c=>error.code===c||error.message==='Daewoo: '+c);
      res.status(400).json({error:'Daewoo: '+(code||'REPORT_READ_FAILED')});
    }
  };
  router.get('/accounts',wrap(async(_req,res,realm)=>{
    const rows=await listAccounts(realm);
    res.json({accounts:rows.filter(a=>a.courier==='daewoo'&&a.active!==false).map(a=>({id:a.id,label:a.label}))});
  }));
  const read=kind=>wrap(async(req,res,realm)=>{
    const q=req.query;
    validateRange(q.from,q.to);
    if(!/^\d+$/.test(String(q.account||''))||Number(q.account)<1)return res.status(400).json({error:'Select a Daewoo account.'});
    const account=await getAccount(realm,Number(q.account));
    if(!account||account.courier!=='daewoo'||account.active===false)return res.status(404).json({error:'Daewoo account not found.'});
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
  return router;
}
