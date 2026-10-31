import express from 'express';
import { receiptDetail } from './banking-cprs.js';
import { receiptWorkbook } from './banking-workbook.js';

export function createBankingRouter({ requireBoss, requireCompany }) {
  const router = express.Router();
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
