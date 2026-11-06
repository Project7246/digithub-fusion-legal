// Synthetic accounts only. No server, production connection or real password changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createAccountPasswordRouter } from '../account-password.js';
import { hashPassword, checkPassword } from '../accounts.js';

const oldPassword = 'fixture old', newPassword = ' fixture new <> ';
const member = 'id:synthetic-reader', other = 'id:synthetic-other';
function fixture(options = {}) {
  const accounts = new Map([
    [member, { sub:member, door:'member', pass:hashPassword(oldPassword), disabled:false,
      role:'viewer', rights:['books'], home_realm:'fixture-company' }],
    [other, { sub:other, door:'member', pass:hashPassword('fixture other'), disabled:false }],
    ['pw:fixture@example.test', { sub:'pw:fixture@example.test', door:'password', pass:hashPassword(oldPassword), disabled:false }]
  ]);
  const writes = [], forgotten = [], attempts = [];
  const router = createAccountPasswordRouter({
    currentUser: req => req.sessionSub,
    getUser: async sub => {
      if(options.failRead) throw Error('Sensitive internal details must stay private');
      return accounts.get(sub) ? { ...accounts.get(sub) } : null;
    },
    pool:{ query:async (sql, values) => {
      writes.push({ sql, values });
      if(options.failWrite) throw Error(newPassword);
      const user = accounts.get(values[0]);
      if(options.conflict) user.pass = hashPassword('fixture competing reset');
      if(!user || user.pass !== values[2] || user.disabled) return { rows:[] };
      user.pass = values[1]; return { rows:[{ sub:user.sub }] };
    } },
    forgetWho: sub => forgotten.push(sub),
    tooManyTries: (req, key) => { attempts.push(key); return !!options.throttled; },
    triesDone: (req, key) => attempts.push('clear:' + key),
    requireBoss: async (req, res) => {
      if(req.boss) return true;
      res.status(403).json({ error:'Super-admin only.' }); return false;
    },
    setMemberPassword: async (sub, plain) => {
      writes.push({ reset:sub }); accounts.get(sub).pass = hashPassword(plain);
    }, demoSub:'demo:viewer'
  });
  async function request(path, body, identity = { sessionSub:member }) {
    const route = router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
    const response = { code:200, status(code){ this.code = code; return this; },
      json(body){ this.body = body; return this; } };
    await route({ ...identity, body }, response); return response;
  }
  return { accounts, writes, forgotten, attempts, request };
}
const payload = { currentPassword:oldPassword, newPassword, confirmPassword:newPassword };
for (const [identity, change, expected] of [
  [{}, {}, 401],
  [{ sessionSub:'demo:viewer' }, {}, 403],
  [{ sessionSub:member }, { currentPassword:'wrong fixture' }, 400],
  [{ sessionSub:member }, { confirmPassword:'different fixture' }, 400],
  [{ sessionSub:member }, { currentPassword:'' }, 400],
  [{ sessionSub:member }, { currentPassword:'x'.repeat(201) }, 400],
  [{ sessionSub:member }, { newPassword:'', confirmPassword:'' }, 400],
  [{ sessionSub:member }, { newPassword:'x'.repeat(201), confirmPassword:'x'.repeat(201) }, 400],
  [{ sessionSub:member }, { newPassword:oldPassword, confirmPassword:oldPassword }, 400],
]) {
  const ui = fixture();
  assert.equal((await ui.request('/api/me/password', { ...payload, ...change }, identity)).code, expected);
  assert.equal(ui.writes.length, 0, 'refused changes never write');
}
const owner = fixture();
const untouched = owner.accounts.get(other).pass;
const response = await owner.request('/api/me/password', { ...payload, sub:other, role:'admin' });
assert.equal(response.code, 200, 'report-only user can change their own password');
assert.equal(owner.accounts.get(other).pass, untouched, 'submitted foreign account ID is ignored');
assert.equal(owner.accounts.get(member).role, 'viewer');
assert.deepEqual(owner.accounts.get(member).rights, ['books']);
assert.ok(checkPassword(newPassword, owner.accounts.get(member).pass));
assert.equal(checkPassword(oldPassword, owner.accounts.get(member).pass), false);
assert.match(owner.writes[0].values[1], /^scrypt\$/);
assert.notEqual(owner.writes[0].values[1], newPassword);
assert.deepEqual(owner.forgotten, [member]);
assert.deepEqual(response.body, { ok:true }, 'no password/hash returned');
const email = fixture();
assert.equal((await email.request('/api/me/password', payload,
  { sessionSub:'pw:fixture@example.test' })).code, 200);
const disabled = fixture(); disabled.accounts.get(member).disabled = true;
assert.equal((await disabled.request('/api/me/password', payload)).code, 403);
assert.equal(disabled.writes.length, 0);
assert.equal((await fixture({ throttled:true }).request('/api/me/password', payload)).code, 429);
const concurrent = fixture({ conflict:true });
assert.equal((await concurrent.request('/api/me/password', payload)).code, 409);
assert.ok(checkPassword('fixture competing reset', concurrent.accounts.get(member).pass));
const failed = await fixture({ failWrite:true }).request('/api/me/password', payload);
assert.equal(failed.code, 500); assert.ok(!JSON.stringify(failed.body).includes(newPassword));

for (const [identity, reset, expected] of [
  [{ sessionSub:member }, { sub:other, password:newPassword, confirmPassword:newPassword }, 403],
  [{ boss:true }, { sub:member, password:newPassword, confirmPassword:'mismatch' }, 400],
  [{ boss:true }, { sub:'missing', password:newPassword, confirmPassword:newPassword }, 404],
  [{ boss:true }, { sub:'pw:fixture@example.test', password:newPassword, confirmPassword:newPassword }, 404]
]) {
  const ui = fixture();
  assert.equal((await ui.request('/api/portal/people/password', reset, identity)).code, expected);
  assert.equal(ui.writes.length, 0);
}
const recovery = fixture();
assert.equal((await recovery.request('/api/portal/people/password', {
  sub:member, password:newPassword, confirmPassword:newPassword
}, { boss:true })).code, 200);
assert.ok(checkPassword(newPassword, recovery.accounts.get(member).pass));
assert.equal(recovery.accounts.get(member).role, 'viewer');
assert.equal((await recovery.request('/api/me/password', {
  currentPassword:newPassword, newPassword:'fixture chosen by user', confirmPassword:'fixture chosen by user'
})).code, 200, 'recovered user can replace the admin-provided password');

// Run the actual browser helper: mismatches never send; no secret is echoed;
// successful submission and dialog close clear the password fields.
const elements = new Map();
const element = id => {
  if(!elements.has(id)) elements.set(id, { value:'', textContent:'', disabled:false, events:{},
    addEventListener(type, handler){ this.events[type] = handler; }, focus(){},
    reset(){ for(const [key, field] of elements) if(key.startsWith(id === 'passwordForm' ? 'password' : 'passwordReset')) field.value = ''; },
    showModal(){ this.open = true; }, close(){ this.open = false; this.events.close?.(); } });
  return elements.get(id);
};
const requests = [];
const context = vm.createContext({ document:{ getElementById:element }, window:{},
  fetch:async (url, options) => { requests.push({ url, body:JSON.parse(options.body) });
    return { ok:true, json:async () => ({ ok:true }) }; } });
vm.runInContext(readFileSync('public/account-password.js','utf8'), context);
element('passwordNew').value = newPassword; element('passwordConfirm').value = 'mismatch';
element('passwordForm').events.submit({ preventDefault(){} }); assert.equal(requests.length, 0);
element('passwordCurrent').value = oldPassword;
element('passwordConfirm').value = newPassword;
element('passwordForm').events.submit({ preventDefault(){} });
element('passwordForm').events.submit({ preventDefault(){} });
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 1, 'double submit sends once');
assert.equal(requests[0].url, '/api/me/password');
assert.equal(requests[0].body.sub, undefined);
assert.equal(element('passwordNew').value, '');
assert.equal(element('passwordSay').textContent, 'Password changed.');
context.window.FUSION.openPasswordReset({ sub:member, loginId:'synthetic-reader' });
element('passwordResetNew').value = newPassword; element('passwordResetConfirm').value = newPassword;
element('passwordResetForm').events.submit({ preventDefault(){} });
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests[1].body.sub, member);
assert.equal(element('passwordResetNew').value, '');
assert.ok(!element('passwordResetSay').textContent.includes(newPassword));
element('passwordResetNew').value = 'fixture temporary'; element('passwordResetCancel').events.click();
assert.equal(element('passwordResetNew').value, '');
const settings = readFileSync('public/settings.html', 'utf8');
for(const id of ['passwordCurrent','passwordNew','passwordConfirm']) {
  assert.match(settings, new RegExp('id="' + id + '" type="password"'));
}
const server = readFileSync('server.js','utf8');
const personalExceptions = server.slice(server.indexOf('const USER_MAY_POST'), server.indexOf('const RIGHT_GROUPS'));
assert.ok(personalExceptions.includes("'/api/me/password'"), 'read-only role gate permits personal password changes');
console.log('Passwords: self ownership, current-password proof, scrypt, conflict guard, report-only access, boss recovery and masked forms PASS');
