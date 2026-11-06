import { mayApp, seesMoney, read } from './access.js';

export function bankingAccess(who) {
  if (!who || who.allowed === false || who.disabled || who.role === 'none') return { read:false, write:false };
  const person = { ...who, hideMoney:who.hideMoney ?? who.hide_money };
  const money = seesMoney(person, 'banking');
  return { read:money && mayApp(person, 'bankingreports'), write:money && mayApp(person, 'banking') };
}

export function createBankingGuard({ currentUser, whoIs }) {
  return async function requireBanking(req, res) {
    const sub = currentUser(req);
    if (!sub) { res.status(401).json({error:'Sign in first.'}); return null; }
    try {
      const who = await whoIs(sub);
      const access = bankingAccess(who);
      const write = !['GET','HEAD'].includes(req.method);
      if (!(write ? access.write : access.read)) {
        res.status(403).json({error:write ? 'Banking management access is required.' : 'Banking report access is required.'});
        return null;
      }
      return { ...who, actor:sub };
    } catch {
      res.status(500).json({error:'Could not verify Banking access.'}); return null;
    }
  };
}

// Called by the account module inside its existing transaction. Banking owns
// this audit table; no account hashes, passwords or personal names are recorded.
export async function recordBankingAccess(client, { actor, sub, realms, before, after }) {
  const oldAccess = bankingAccess(before), newAccess = bankingAccess(after);
  if (oldAccess.read === newAccess.read && oldAccess.write === newAccess.write) return;
  if (!actor) throw new Error('An actor is required to change Banking access.');
  const snapshot = person => ({ role:person?.role || 'none',
    allowed:person?.allowed !== false, rights:read(person?.rights), hideMoney:!!(person?.hideMoney ?? person?.hide_money) });
  for (const realm of new Set((realms || []).filter(Boolean))) {
    await client.query("SELECT set_config('app.realm_id',$1,true)", [realm]);
    await client.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realm, actor, 'access-change', JSON.stringify({ sub, before:oldAccess, after:newAccess,
        oldGrant:snapshot(before), newGrant:snapshot(after) })]);
  }
}
