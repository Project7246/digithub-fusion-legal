import express from 'express';
import { receiptDetail } from './banking-cprs.js';
import { receiptWorkbook } from './banking-workbook.js';
import { saveBankingSetup, recordBankEntry, bankingSetups } from './banking-setup.js';
import { listBanks, todayText, readSpendSheet } from './banking.js';
import { liveSpend } from './banking-cprs.js';

export function createBankingRouter({ requireBoss, requireCompany }) {
  const router = express.Router();
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
      res.json({rows:await liveSpend(realm,{...bank,...setup},readSpendSheet,true,todayText())});
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
