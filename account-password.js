import express from 'express';
import { checkPassword, hashPassword, passwordComplaint } from './accounts.js';

// Account ownership comes only from the verified session, never a submitted ID.
export function createAccountPasswordRouter({ currentUser, getUser, pool, forgetWho,
  tooManyTries, triesDone, requireBoss, setMemberPassword, demoSub }) {
  const router = express.Router();

  router.post('/api/me/password', async (req, res) => {
    try {
      const sub = currentUser(req);
      if (!sub) return res.status(401).json({ error: 'Sign in first.' });
      if (sub === demoSub) return res.status(403).json({ error: 'The demo password cannot be changed.' });
      const body = req.body || {};
      if (typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 200) {
        return res.status(400).json({ error: 'Type your current password.' });
      }
      if (typeof body.newPassword !== 'string') return res.status(400).json({ error: 'Type a new password.' });
      const weak = passwordComplaint(body.newPassword);
      if (weak) return res.status(400).json({ error: weak });
      if (body.confirmPassword !== body.newPassword) {
        return res.status(400).json({ error: 'The new passwords do not match.' });
      }
      const attempt = 'password-change:' + sub;
      if (tooManyTries(req, attempt)) {
        return res.status(429).json({ error: 'Too many tries. Wait ten minutes and try again.' });
      }
      const user = await getUser(sub);
      const matches = checkPassword(body.currentPassword, user?.pass);
      if (!user || user.disabled) return res.status(403).json({ error: 'This account is unavailable.' });
      if (!matches) return res.status(400).json({ error: 'The current password does not match.' });
      if (body.currentPassword === body.newPassword) {
        return res.status(400).json({ error: 'Choose a different new password.' });
      }
      const result = await pool.query(
        'UPDATE users SET pass = $2 WHERE sub = $1 AND pass = $3 AND disabled = FALSE RETURNING sub',
        [sub, hashPassword(body.newPassword), user.pass]);
      if (!result.rows.length) {
        return res.status(409).json({ error: 'The account changed. Try again with its current password.' });
      }
      forgetWho(sub);
      triesDone(req, attempt);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Could not change the password. Try again.' });
    }
  });

  // Recovery replaces a lost staff-ID password; it never reads the old one back.
  router.post('/api/portal/people/password', async (req, res) => {
    try {
      if (!await requireBoss(req, res)) return;
      const body = req.body || {};
      const sub = typeof body.sub === 'string' ? body.sub : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const weak = passwordComplaint(password);
      if (weak) return res.status(400).json({ error: weak });
      if (body.confirmPassword !== password) {
        return res.status(400).json({ error: 'The new passwords do not match.' });
      }
      const user = await getUser(sub);
      if (!user || user.door !== 'member') return res.status(404).json({ error: 'That is not a user ID.' });
      await setMemberPassword(sub, password);
      forgetWho(sub);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Could not reset the password. Try again.' });
    }
  });

  return router;
}
