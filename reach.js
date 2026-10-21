// Can this server reach that courier at all?
//
// "Trax said nothing: fetch failed" reads like a bug in Fusion, and it was not
// one: the app is hosted in Bangalore, sonic.pk answers from a PTCL address in
// Pakistan, and those two networks do not always see each other. The same key
// and the same code work from a laptop in Karachi, so nothing in the app can
// tell you what is wrong - only the server can, from where it stands.
//
// So this walks the four steps a call takes and says which one broke:
//
//   dns   does the name turn into an address here
//   tcp   does a socket open to it
//   tls   does the handshake finish (https only)
//   http  does the server answer a plain GET
//
// A failure at dns is a name or a resolver; at tcp or tls with nothing coming
// back it is almost always the route between the two countries; at http it is
// the courier's own server and the problem is ours to fix in their adapter.

import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

const STEP_MS = Math.max(2000, Number(process.env.REACH_TIMEOUT_MS) || 8000);

function ms(t0) { return Math.round(Number(process.hrtime.bigint() - t0) / 1e6); }
const now = () => process.hrtime.bigint();

async function step(run) {
  const t0 = now();
  try {
    const out = await run();
    return Object.assign({ ok: true, ms: ms(t0) }, out || {});
  } catch (e) {
    return {
      ok: false,
      ms: ms(t0),
      code: (e && e.code) || (e && e.name === 'Error' ? '' : (e && e.name)) || '',
      error: (e && e.message) || 'it failed'
    };
  }
}

function lookup(host) {
  return new Promise((res, rej) => {
    const bell = setTimeout(() => rej(Object.assign(new Error('the lookup timed out'),
                                                    { code: 'ETIMEDOUT' })), STEP_MS);
    dns.lookup(host, { all: true }, (err, list) => {
      clearTimeout(bell);
      if (err) return rej(err);
      res({ ips: (list || []).map(x => x.address) });
    });
  });
}

function connect(host, port) {
  return new Promise((res, rej) => {
    const s = net.connect({ host, port });
    const done = fn => { s.removeAllListeners(); s.destroy(); fn(); };
    s.setTimeout(STEP_MS);
    s.on('connect', () => {
      const ip = s.remoteAddress;
      done(() => res({ ip }));
    });
    s.on('timeout', () => done(() => rej(Object.assign(
      new Error('nothing answered on port ' + port), { code: 'ETIMEDOUT' }))));
    s.on('error', e => done(() => rej(e)));
  });
}

function handshake(host, port) {
  return new Promise((res, rej) => {
    const s = tls.connect({ host, port, servername: host, timeout: STEP_MS });
    const done = fn => { s.removeAllListeners(); s.destroy(); fn(); };
    s.on('secureConnect', () => {
      const cert = s.getPeerCertificate() || {};
      done(() => res({
        authorized: s.authorized,
        why: s.authorizationError ? String(s.authorizationError) : '',
        issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || '',
        expires: cert.valid_to || ''
      }));
    });
    s.on('timeout', () => done(() => rej(Object.assign(
      new Error('the handshake never finished'), { code: 'ETIMEDOUT' }))));
    s.on('error', e => done(() => rej(e)));
  });
}

async function plainGet(url) {
  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), STEP_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'manual' });
    const text = await r.text().catch(() => '');
    return { status: r.status, bytes: text.length, first: text.slice(0, 120) };
  } finally {
    clearTimeout(bell);
  }
}

// One courier's base URL, walked. `label` is only for the answer.
export async function reach(base, label) {
  let url;
  try { url = new URL(String(base)); }
  catch (e) { return { label, base, error: 'That is not a URL: ' + base }; }

  const host = url.hostname;
  const https = url.protocol === 'https:';
  const port = Number(url.port) || (https ? 443 : 80);

  const out = { label, base: String(base), host, port, https };

  out.dns = await step(() => lookup(host));
  if (out.dns.ok) {
    out.tcp = await step(() => connect(host, port));
    if (out.tcp.ok && https) out.tls = await step(() => handshake(host, port));
    if (out.tcp.ok && (!https || out.tls.ok)) out.http = await step(() => plainGet(url.toString()));
  }

  out.verdict = verdictOf(out);
  return out;
}

function verdictOf(o) {
  if (!o.dns || !o.dns.ok) {
    return {
      where: 'dns',
      say: 'This server cannot turn ' + o.host + ' into an address' +
           (o.dns && o.dns.code ? ' (' + o.dns.code + ')' : '') +
           '. Either the name is wrong or this server has no working resolver.'
    };
  }

  const ips = (o.dns.ips || []).join(', ');

  if (!o.tcp || !o.tcp.ok) {
    const code = (o.tcp && o.tcp.code) || '';
    if (code === 'ECONNREFUSED') {
      return {
        where: 'tcp',
        say: o.host + ' (' + ips + ') is there and refused port ' + o.port +
             '. That is their server saying no, not a blocked route.'
      };
    }
    return {
      where: 'tcp',
      say: 'The name resolves to ' + ips + ' but nothing answers on port ' +
           o.port + ' from this server. The usual reason is the route itself: ' +
           'this app runs in one country and that address answers inside ' +
           'another. The same call from a computer on the courier’s own ' +
           'network works, which is why the key looks fine and the app looks ' +
           'broken. Either move the app to a region that can reach them, or ' +
           'put a relay in front - COURIER_RELAY in the environment.'
    };
  }

  if (o.tls && !o.tls.ok) {
    return {
      where: 'tls',
      say: 'The socket opens to ' + ips + ' but the TLS handshake does not ' +
           'finish' + (o.tls.code ? ' (' + o.tls.code + ')' : '') +
           '. Their certificate, or something in between rewriting the traffic.'
    };
  }
  if (o.tls && o.tls.ok && o.tls.authorized === false) {
    return {
      where: 'tls',
      say: 'Their certificate does not verify: ' + (o.tls.why || 'unknown') + '.'
    };
  }

  if (!o.http || !o.http.ok) {
    return {
      where: 'http',
      say: 'The connection is fine but the plain GET did not come back' +
           (o.http && o.http.code ? ' (' + o.http.code + ')' : '') + '.'
    };
  }

  return {
    where: 'ok',
    say: 'This server reaches ' + o.host + ' (' + ips + ') and it answered ' +
         o.http.status + ' in ' + o.http.ms + ' ms. Whatever is wrong is the ' +
         'key or the endpoint, not the network.'
  };
}

// Every address one courier uses - M&P have a second host for their public
// tracking screen, and it is on a different network from their API, so one
// being reachable says nothing about the other.
export async function reachCourier(adapter) {
  const bases = [];
  if (adapter.base) bases.push({ base: adapter.base, label: adapter.name + ' API' });
  (adapter.extraBases || []).forEach(b => bases.push(b));

  if (!bases.length) return { courier: adapter.key, checks: [], error: 'No address to check' };

  const checks = [];
  for (const b of bases) checks.push(await reach(b.base, b.label));

  return {
    courier: adapter.key,
    name: adapter.name,
    checks,
    ok: checks.every(c => c.verdict && c.verdict.where === 'ok')
  };
}
