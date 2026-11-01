import express from 'express';
import { receiptDetail } from './banking-cprs.js';
import { receiptWorkbook } from './banking-workbook.js';
import { saveBankingSetup, recordBankEntry, bankingSetups } from './banking-setup.js';
import { listBanks, saveBank, todayText, readSpendSheet, report as bankReport, taxYear } from './banking.js';
import { pool } from './db.js';
import { liveSpend } from './banking-cprs.js';
import { bankingHistory, correctTransaction, removeFiscalSetup, columnBreakdown, paymentWorkbook } from './banking-history.js';

export function createBankingRouter({ requireBoss, requireCompany }) {
  const router = express.Router();
  router.post('/save',async(req,res)=>{
    const who=await requireBoss(req,res);if(!who)return;
    const realm=await requireCompany(req,res);if(!realm)return;
    let c;
    try{
      c=await pool.connect();
      await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realm]);
      const before=req.body?.id?(await c.query('SELECT * FROM banks WHERE realm_id=$1 AND id=$2 FOR UPDATE',[realm,req.body.id])).rows[0]:null;
      const id=await saveBank(realm,req.body||{},c);
      const after=(await c.query('SELECT * FROM banks WHERE realm_id=$1 AND id=$2',[realm,id])).rows[0];
      await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
        [realm,who.email||'boss','bank-opening',JSON.stringify([{bankId:id,before:before||null,after}])]);
      await c.query('COMMIT');res.json({ok:true,id});
    }catch(e){if(c)await c.query('ROLLBACK');res.status(400).json({error:e.message});}finally{if(c)c.release();}
  });
  router.get('/history',async(req,res)=>{
    if(!await requireBoss(req,res))return;
    const realm=await requireCompany(req,res);if(!realm)return;
    try{res.setHeader('Cache-Control','no-store');res.json(await bankingHistory(realm));}
    catch(e){res.status(400).json({error:e.message});}
  });
  router.post('/correct-transaction',async(req,res)=>{
    const who=await requireBoss(req,res);if(!who)return;
    const realm=await requireCompany(req,res);if(!realm)return;
    try{await correctTransaction(realm,req.body.id,req.body.replacement||null,who.email||'boss');res.json({ok:true});}
    catch(e){res.status(400).json({error:e.message});}
  });
  router.post('/remove-setup',async(req,res)=>{
    const who=await requireBoss(req,res);if(!who)return;
    const realm=await requireCompany(req,res);if(!realm)return;
    try{await removeFiscalSetup(realm,req.body.id,who.email||'boss');res.json({ok:true});}
    catch(e){res.status(400).json({error:e.message});}
  });
  router.get('/breakdown',async(req,res)=>{
    if(!await requireBoss(req,res))return;
    const realm=await requireCompany(req,res);if(!realm)return;
    try{res.setHeader('Cache-Control','no-store');res.json(columnBreakdown(await bankReport(realm,
      {year:req.query.year,allMoves:true}),req.query.bank,req.query.column));}
    catch(e){res.status(400).json({error:e.message});}
  });
  router.post('/setup', async(req,res)=>{
    const who=await requireBoss(req,res); if(!who)return;
    const realm=await requireCompany(req,res);if(!realm)return;
    try {await saveBankingSetup(realm,req.body||{},who.email||'boss');res.json({ok:true});}
    catch(e){res.status(400).json({error:e.message});}
  });
  router.post('/transaction',async(req,res)=>{
    const who=await requireBoss(req,res);if(!who)return;
    const realm=await requireCompany(req,res);if(!realm)return;
    try {res.json({ok:true,entries:await recordBankEntry(realm,req.body||{},who.email||'boss')});}
    catch(e){res.status(400).json({error:e.message});}
  });
  // Preview is read-only: the source workbook and historical imported rows remain untouched.
  router.get('/spending',async(req,res)=>{
    if(!await requireBoss(req,res))return;
    const realm=await requireCompany(req,res);if(!realm)return;
    try {
      const bank=(await listBanks(realm,{all:true})).find(b=>b.id===Number(req.query.bank));
      if(!bank)throw new Error('No such bank');
      const setup=(await bankingSetups(realm,Number(req.query.year))).find(s=>s.bankId===bank.id);
      res.setHeader('Cache-Control','no-store');
      const year=taxYear(req.query.year),today=todayText(),configured={...bank,...setup};
      const rows=(await liveSpend(realm,configured,readSpendSheet,true,today)).filter(r=>r.on>=year.from &&
        r.on<=year.to && r.on<=today && (!bank.openingOn||r.on>=bank.openingOn) &&
        (!setup?.outFrom||r.on>=setup.outFrom) && (!req.query.month||r.on.slice(0,7)===req.query.month));
      if(req.query.download==='xlsx') {
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition',`attachment; filename="Bank-${bank.id}-payments.xlsx"`);
        return res.send(paymentWorkbook(rows));
      }
      res.json({rows,bank:{id:bank.id,name:bank.name,title:bank.title}});
    }catch(e){res.status(400).json({error:e.message});}
  });
  router.get('/cpr', async (req, res) => {
    if (!await requireBoss(req, res)) return;
    const realmId = await requireCompany(req, res);
    if (!realmId) return;
    const account = Number(req.query.account);
    const ref = String(req.query.ref || '').trim();
    if (!Number.isSafeInteger(account) || account <= 0 || !ref || ref.length > 256) {
      return res.status(400).json({ error: 'A courier account and CPR reference are required' });
    }
    try {
      res.setHeader('Cache-Control', 'no-store');
      const detail = await receiptDetail(realmId, account, ref);
      if (req.query.download === 'xlsx') {
        const safe = ref.replace(/[^a-zA-Z0-9_.-]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="CPR-${account}-${safe}.xlsx"`);
        return res.send(receiptWorkbook(detail));
      }
      res.json(detail);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  return router;
}
