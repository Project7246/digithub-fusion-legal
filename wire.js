// Talking to a courier whose guide we only half have.
//
// PostEx was written against its own documentation and still needed two
// spellings of the same date parameter before it would answer. Trax and M&P are
// worse: their guides are handed out account by account, and the endpoint that
// works on one merchant's key is a 404 on another's. So instead of one address
// built on a guess, each adapter hands this file a short list of the shapes the
// call could take and the first one the courier actually answers is the one
// kept - in memory, per key, so the hunt happens once and not on every sweep.
//
// Nothing here knows what a courier is. It is the plumbing: ask, read whatever
// came back, remember what worked, and when nothing works say exactly what each
// attempt was told, because "Trax said no" is not something anybody can act on.

const TIMEOUT = Math.max(5, Number(process.env.COURIER_TIMEOUT_SECONDS) || 25) * 1000;

export function qs(base, path, params) {
  // Joined by hand rather than through new URL(path, base): that drops the
  // base's own path as soon as the second argument starts with a slash, and
  // every one of these bases ends in /api.
  const full = new URL(String(base).replace(/\/+$/, '') + String(path || ''));
  Object.keys(params || {}).forEach(k => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') full.searchParams.set(k, v);
  });
  return full.toString();
}

// Node says "fetch failed" and puts the only useful part in `cause`, two
// levels down. That cost an afternoon once: a courier's API was unreachable
// from the server's own datacentre and the screen said nothing but "Trax said
// nothing: fetch failed", which reads like a bug in here.
export function codeOf(e) {
  let c = e;
  for (let i = 0; i < 5 && c; i++) {
    if (c.code) return String(c.code);
    // a host with both an IPv6 and an IPv4 address fails twice, and Node hands
    // back an AggregateError whose own code is empty - the codes are inside it
    if (Array.isArray(c.errors) && c.errors.length) {
      const found = c.errors.map(x => x && x.code).filter(Boolean)[0];
      if (found) return String(found);
    }
    c = c.cause;
  }
  return e && e.name === 'AbortError' ? 'ETIMEDOUT' : '';
}

// What each of those codes means, in words somebody can act on.
const MEANS = {
  ENOTFOUND:    'that address does not resolve - the name is wrong, or this ' +
                'server cannot look it up',
  EAI_AGAIN:    'the name could not be looked up just now - a DNS wobble',
  ECONNREFUSED: 'the door is shut - something is listening there and said no',
  ETIMEDOUT:    'no answer at all. The courier is down, or this server cannot ' +
                'reach their network - which is what it looks like when an app ' +
                'hosted in one country calls a server that only answers inside ' +
                'another',
  EHOSTUNREACH: 'there is no route from this server to that one',
  ENETUNREACH:  'there is no route from this server to that network',
  ECONNRESET:   'the connection was cut while we were on it',
  UND_ERR_CONNECT_TIMEOUT:
                'no answer at all - see ETIMEDOUT above: this is usually a ' +
                'server that cannot reach the courier’s network',
  CERT_HAS_EXPIRED: 'their certificate has expired',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'their certificate cannot be verified'
};

export function plainly(e) {
  const code = codeOf(e);
  if (code && MEANS[code]) return code + ' - ' + MEANS[code];
  if (code) return code;
  return (e && e.message) || 'the call failed';
}

/* ---------- going the long way round ---------- */
//
// sonic.pk answers from a PTCL address inside Pakistan, and this app is hosted
// in Bangalore. Those two networks do not reliably see each other, so the call
// times out from the server while the same call from a laptop in Karachi is
// instant - nothing in the app can fix that, because it is the route.
//
// A relay is the way through: a small worker on a network that can see both,
// which takes `<relay>/<the whole target URL>` and passes it on. Set
// COURIER_RELAY and COURIER_RELAY_KEY and only the hosts in COURIER_RELAY_HOSTS
// go that way - everything else, Cloudflare-hosted like PostEx and M&P, keeps
// going straight out. tools/courier-relay.js is the worker.
const RELAY = String(process.env.COURIER_RELAY || '').replace(/\/+$/, '');
const RELAY_KEY = process.env.COURIER_RELAY_KEY || '';
const RELAY_HOSTS = String(process.env.COURIER_RELAY_HOSTS ||
  'sonic.pk,app.sonic.pk,www.sonic.pk')
  .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);

export function relayed(url) {
  if (!RELAY) return null;
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
  return RELAY_HOSTS.includes(host) ? RELAY + '/' + url : null;
}

export function relayState() {
  return { on: !!RELAY, hosts: RELAY_HOSTS, keyed: !!RELAY_KEY };
}

export async function call({ url, method, headers, body }) {
  const through = relayed(url);
  if (through) {
    url = through;
    headers = Object.assign({}, headers || {},
                            RELAY_KEY ? { 'X-Relay-Key': RELAY_KEY } : {});
  }

  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), TIMEOUT);

  try {
    const r = await fetch(url, {
      method: method || 'GET',
      headers: Object.assign({ 'Accept': 'application/json' }, headers || {}),
      body: body === undefined || body === null ? undefined :
            (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: ctl.signal
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }

    return { ok: r.ok, status: r.status, json, text: text.slice(0, 600) };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: plainly(e), cause: codeOf(e) };
  } finally {
    clearTimeout(bell);
  }
}

// Whatever a courier wraps its rows in. PostEx says `dist`, Trax has said
// `data` and `shipments`, M&P has said `result` - and one of them answers with
// the bare array. A single row on its own counts as one row.
const WRAPPERS = [
  'dist', 'data', 'result', 'results', 'rows', 'records', 'items', 'list',
  'shipments', 'shipment', 'orders', 'order', 'payload', 'response', 'details',
  'trackingdetails', 'packetlist', 'cnlist'
];

export function rows(json, depth) {
  if (!json) return null;
  if (Array.isArray(json)) return json;
  if (typeof json !== 'object') return null;
  if ((depth || 0) > 3) return null;

  const lower = {};
  Object.keys(json).forEach(k => { lower[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = json[k]; });

  for (const w of WRAPPERS) {
    const v = lower[w];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const deeper = rows(v, (depth || 0) + 1);
      if (deeper) return deeper;
    }
  }
  return null;
}

// What a courier says when it refuses. Worth digging out: it is the only thing
// that tells a wrong key from a wrong address.
export function why(answer) {
  const j = answer && answer.json;
  if (j && typeof j === 'object') {
    const keys = ['message', 'statusMessage', 'error', 'errors', 'detail',
                  'description', 'msg', 'reason'];
    for (const k of keys) {
      const v = j[k];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
      if (Array.isArray(v) && v.length) return String(v[0]).slice(0, 200);
    }
  }
  return String((answer && answer.text) || '').trim().slice(0, 200) || 'no answer';
}

/* ---------- which shape worked ---------- */
// Kept in memory on purpose. It is not worth a database row: a restart simply
// hunts once more, and a courier that changes its API is found again rather
// than being remembered wrongly for ever.

const winners = new Map();
const keyOf = (courier, job, token) =>
  courier + '|' + job + '|' + String(token || '').slice(-8);

export function remembered(courier, job, token) {
  return winners.get(keyOf(courier, job, token)) || null;
}

// The way a key is handed over is the courier's, not the call's: once one
// endpoint has accepted `Authorization: Bearer`, every other endpoint on that
// courier will too. Remembering it separately is what keeps the hunt short -
// without it, six addresses times five date spellings times four ways of
// signing in is 120 calls before anybody is told anything.
export function knownAuth(courier, token) {
  return winners.get(keyOf(courier, '__auth', token)) || null;
}
export function remember(courier, job, token, shape) {
  winners.set(keyOf(courier, job, token), shape);
}
export function forgetShapes(courier, token) {
  [...winners.keys()].forEach(k => {
    if (k.indexOf(courier + '|') === 0 && (!token || k.endsWith(String(token).slice(-8)))) {
      winners.delete(k);
    }
  });
}

// The hunt itself.
//
// **Nothing uses this any more.** It was written when Trax's and M&P's guides
// could not be had, and both of them are now written against their own
// documents - so it is kept for the next courier that turns up without one,
// and `qs`, `call`, `rows` and `why` above are what the adapters actually use.
//
// `shapes` is the list of ways a call could be made, each one a plain object
// the adapter knows how to turn into a request; `send` makes the call; `good`
// says whether the answer is the one we wanted.
//
// A 401 or 403 is the key being refused, not the address being wrong, so it is
// remembered separately: if every shape is refused, the account's key is the
// thing to complain about, and saying "Trax does not know that address" would
// send somebody looking in the wrong place.
export async function hunt({ courier, job, token, shapes, send, good, limit }) {
  const kept = remembered(courier, job, token);
  const order = kept ? [kept].concat(shapes.filter(s => s !== kept)) : shapes.slice();

  // Two stops, and both of them matter on a sweep that runs unattended.
  //
  // `limit` is how many shapes are worth trying before admitting we do not know
  // this courier's API - 24 of them at up to 25 seconds each is already ten
  // minutes, and trying all 120 would have held a sweep open for the better
  // part of an hour and kept the database awake for every minute of it.
  //
  // `mute` is the courier being down or the name not resolving. Every shape
  // will fail the same way, so three silences in a row end it: the answer is
  // about the courier, not about which address we picked.
  const cap = Math.max(1, limit || 24);
  const tried = [];
  let refused = 0, asked = 0, mute = 0;

  for (const shape of order) {
    if (asked >= cap) break;
    asked++;

    const answer = await send(shape);

    if (answer.status === 0) {
      mute++;
      tried.push({ shape: shape.name || '', said: answer.text || 'no reply' });
      if (mute >= 3) break;
      continue;
    }
    mute = 0;

    if (answer.status === 401 || answer.status === 403) {
      refused++;
      tried.push({ shape: shape.name || '', said: answer.status + ': ' + why(answer) });
      continue;
    }

    const found = answer.ok ? good(answer, shape) : null;
    if (found !== null && found !== undefined && found !== false) {
      remember(courier, job, token, shape);
      if (shape.auth) winners.set(keyOf(courier, '__auth', token), shape.auth);
      return { found, shape, answer };
    }

    tried.push({
      shape: shape.name || '',
      said: (answer.status || 'no reply') + ': ' + why(answer)
    });
  }

  const err = new Error(
    mute >= 3
      ? 'The courier did not answer at all - ' + (tried[0] ? tried[0].said : 'no reply')
      : refused && refused === asked
        ? 'The key was refused. ' + (tried[0] ? tried[0].said : '')
        : 'None of the addresses we know answered. ' +
          tried.slice(0, 4).map(t => (t.shape ? t.shape + ' - ' : '') + t.said).join(' | ')
  );
  err.tried = tried;
  err.refused = refused === asked && refused > 0;
  throw err;
}
